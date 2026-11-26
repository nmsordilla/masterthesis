"""Save the playground and its logged calls as one HTML file you can open anywhere, offline.

    python code/export_playground.py              # every logged call
    python code/export_playground.py "Run"        # only calls whose case name contains "Run"

Writes code/exports/playground_<date>.html (gitignored: it contains your log). Copy that single
file to another computer and double-click it: no Python, server, API key or internet needed.
It is read-only: browse, filter, render Markdown/math and copy results, but not send prompts.

The Markdown/math libraries (and KaTeX's fonts) are downloaded once from cdnjs while exporting
and embedded in the file. If that download fails, the file falls back to loading them online.
"""

import base64
import json
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

from openai_client import LOG_FILE
from playground import load_trials

HERE = Path(__file__).parent
PAGE = HERE / "playground.html"
OUT_DIR = HERE / "exports"
CDN = "https://cdnjs.cloudflare.com/ajax/libs/"


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


def inline_assets(html: str) -> tuple[str, bool]:
    """Replace the cdnjs <script>/<link> tags with their contents. Returns (html, all_inlined)."""
    ok = True

    def script(m):
        nonlocal ok
        try:
            js = fetch(m.group(1)).decode("utf-8").replace("</script", "<\\/script")
            return f"<script>{js}</script>"
        except Exception as e:
            print(f"Could not download {m.group(1)} ({e}); the export will load it online.", file=sys.stderr)
            ok = False
            return m.group(0)

    def stylesheet(m):
        nonlocal ok
        url = m.group(1)
        try:
            css = fetch(url).decode("utf-8")
            base = url.rsplit("/", 1)[0] + "/"

            def font(f):  # embed only woff2, the format every current browser uses
                data = base64.b64encode(fetch(base + f.group(1))).decode()
                return f"url(data:font/woff2;base64,{data})"

            css = re.sub(r"url\((fonts/[^)]+\.woff2)\)", font, css)
            css = re.sub(r",\s*url\(fonts/[^)]+\.(?:woff|ttf)\)\s*format\(\"(?:woff|truetype)\"\)", "", css)
            return f"<style>{css}</style>"
        except Exception as e:
            print(f"Could not download {url} ({e}); the export will load it online.", file=sys.stderr)
            ok = False
            return m.group(0)

    html = re.sub(rf'<script src="({re.escape(CDN)}[^"]+)"></script>', script, html)
    html = re.sub(rf'<link rel="stylesheet" href="({re.escape(CDN)}[^"]+)">', stylesheet, html)
    return html, ok


def main() -> None:
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    calls = [json.loads(line) for line in LOG_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
    if query:
        calls = [c for c in calls if query.lower() in (c.get("name") or "").lower()]
    if not calls:
        sys.exit(f"No logged calls{f' named like {query!r}' if query else ''} to export.")
    calls.reverse()  # newest first, as in the playground

    now = datetime.now()
    total = sum(c.get("cost_usd") or 0.0 for c in calls)
    note = (f"Read-only export from {now:%Y-%m-%d %H:%M} · {len(calls)} calls"
            f"{f' matching “{query}”' if query else ''} · ${total:.4f} spent on these calls")

    # Stand-in for the playground server: answers the page's /api requests from the embedded calls.
    trials = load_trials()
    for t in trials:  # run counts per series, as the server reports them
        counts = {}
        for c in calls:
            if c.get("trial_id") == t["id"]:
                counts[c.get("series") or ""] = counts.get(c.get("series") or "", 0) + 1
        t["series_counts"], t["runs"] = counts, sum(counts.values())
    trials = [t for t in trials if t["runs"]]  # only trials with calls in this export
    data = json.dumps({"calls": calls, "trials": trials, "note": note, "total": total}, ensure_ascii=False).replace("</", "<\\/")
    stub = f"""<script>
  window.EXPORT = {data};
  window.fetch = async (url) => {{
    const u = new URL(url, "http://export.local/");
    const reply = (body, ok = true) => ({{ ok, statusText: "", json: async () => body }});
    if (u.pathname === "/api/info") return reply({{ default_model: "", models: [], total_cost: EXPORT.total }});
    if (u.pathname === "/api/trials") return reply({{ trials: EXPORT.trials }});
    if (u.pathname === "/api/history") {{
      const q = (u.searchParams.get("q") || "").trim().toLowerCase();
      const trial = u.searchParams.get("trial"), known = new Set(EXPORT.trials.map((t) => t.id));
      let calls = EXPORT.calls;
      if (trial) calls = calls.filter((c) => c.trial_id === trial);
      else if (trial === "") calls = calls.filter((c) => !known.has(c.trial_id));
      return reply({{ calls: q ? calls.filter((c) => (c.name || "").toLowerCase().includes(q)) : calls }});
    }}
    return reply({{ error: "This is a read-only export; sending prompts needs the playground server." }}, false);
  }};
</script>
"""
    html = PAGE.read_text(encoding="utf-8")
    html, offline = inline_assets(html)
    marker = "<script>\n  const $ ="
    html = html.replace("\r\n", "\n")
    assert html.count(marker) == 1, "playground.html changed; update the marker in export_playground.py"
    html = html.replace(marker, stub + marker)
    html = html.replace("<title>LLM Bayesian Priors</title>", f"<title>LLM Bayesian Priors export {now:%Y-%m-%d}</title>")

    OUT_DIR.mkdir(exist_ok=True)
    slug = re.sub(r"[^A-Za-z0-9]+", "-", query).strip("-")
    out = OUT_DIR / f"playground_{now:%Y-%m-%d_%H%M}{'_' + slug if slug else ''}.html"
    out.write_text(html, encoding="utf-8")
    print(f"Exported {len(calls)} calls to {out} ({out.stat().st_size / 1e6:.1f} MB)")
    if not offline:
        print("Some libraries could not be embedded: Markdown/math will need internet; otherwise raw text is shown.")


if __name__ == "__main__":
    main()
