"""Local web page for trying prompts: type a prompt, see the model's answer.

Run from the project root, then open http://127.0.0.1:8000 in your browser:
    python code/playground.py            # or: python code/playground.py 8080

Calls go through openai_client, so each one is logged (prompt, answer, tokens, cost)
to code/logs/openai_calls.jsonl, just like the test_prior scripts.
The server only listens on 127.0.0.1, so your API key is not reachable from other machines.
"""

import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from openai_client import DEFAULT_MODEL, LOG_FILE, PRICES, ask, ask_with_reasoning, get_client, total_cost

PAGE = Path(__file__).parent / "playground.html"
HISTORY_SIZE = 50

# Models that do not answer text prompts through the Responses API (images, audio, embeddings, ...).
NON_TEXT = re.compile(
    r"audio|image|realtime|live|tts|transcribe|whisper|embedding|moderation|sora|dall-e|search|"
    r"instruct|^babbage|^davinci"
)
# Dated snapshots such as "gpt-4o-2024-08-06"; hidden from the list but still accepted if typed.
SNAPSHOT = re.compile(r"-\d{4}-\d{2}-\d{2}$|-\d{4}$")

_models: list[str] | None = None


def available_models() -> list[str]:
    """Text models this API key can use, fetched from OpenAI once, plus every model in PRICES."""
    global _models
    if _models is None:
        try:
            ids = {m.id for m in get_client().models.list()}
            ids = {i for i in ids if not NON_TEXT.search(i) and not SNAPSHOT.search(i)}
        except Exception as e:
            print(f"[playground] could not list models from OpenAI ({e}); using PRICES only", file=sys.stderr)
            return sorted(PRICES)
        _models = sorted(ids | set(PRICES))
    return _models


def recent_calls(n: int = HISTORY_SIZE, query: str = "") -> list[dict]:
    """The last n logged calls, newest first. With a query, only calls whose case name contains it
    (case-insensitive), searched over the whole log rather than just the last n."""
    if not LOG_FILE.exists():
        return []
    lines = [line for line in LOG_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
    q = query.strip().lower()
    out = []
    for line in reversed(lines):
        call = json.loads(line)
        if q and q not in (call.get("name") or "").lower():
            continue
        out.append(call)
        if len(out) >= n:
            break
    return out


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path in ("/", "/index.html"):
            self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        elif url.path == "/api/info":
            self._json(200, {"default_model": DEFAULT_MODEL, "models": available_models(), "total_cost": total_cost()})
        elif url.path == "/api/history":
            query = parse_qs(url.query).get("q", [""])[0]
            self._json(200, {"calls": recent_calls(query=query)})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/ask":
            return self._json(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            prompt = (body.get("prompt") or "").strip()
            if not prompt:
                return self._json(400, {"error": "The prompt is empty."})
            system = (body.get("system") or "").strip() or None
            model = (body.get("model") or "").strip() or DEFAULT_MODEL
            web_search = bool(body.get("web_search"))
            name = (body.get("name") or "").strip() or None
            effort = (body.get("effort") or "").strip() or None

            if body.get("reasoning"):
                answer, reasoning = ask_with_reasoning(prompt, system=system, model=model, web_search=web_search, name=name, effort=effort)
            else:
                temperature = body.get("temperature")
                answer = ask(prompt, system=system, model=model, temperature=temperature, web_search=web_search, name=name, effort=effort)
                reasoning = ""
            # The call was just appended to the log; return it so the page shows tokens and cost.
            last = recent_calls(1)
            self._json(200, {"answer": answer, "reasoning": reasoning, "call": last[0] if last else None})
        except Exception as e:  # show API errors (bad model name, missing key, ...) in the page
            self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def _json(self, status: int, data: dict) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json")

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[playground] {fmt % args}\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Prompt playground running at http://127.0.0.1:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
