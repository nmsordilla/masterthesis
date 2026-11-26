"""LLM Bayesian Priors: a local web page for eliciting priors for clinical trials from LLMs.

Run from the project root, then open http://127.0.0.1:8000 in your browser:
    python code/playground.py            # or: python code/playground.py 8080

Work is organised by clinical trial. Create a trial (name, NCT number, optionally its reported
result for comparison), then start runs for it: one or many, with minutes between runs. Each run
belongs to a series (e.g. "Claude v2") and is numbered within it: "<trial> <series> run1", ...
Trials are saved in code/trials.json. A trial's protocol and/or SAP can be uploaded once; one model call
then writes a structured trial summary from them (saved with the trial, editable) that runs can put in the prompt
instead of, or as well as, the trial name and NCT number.

Calls go through openai_client, so each one is logged (prompt, answer, tokens, cost) to
code/logs/openai_calls.jsonl with its trial_id, series and run number. Attached files are sent with
the prompt; the log keeps their names, sizes and SHA-256 hashes, not their contents.
Repeated runs are done here in the server, one after another; they keep going if you close or
reload the page, but stop when the server stops (or the computer sleeps).
The server only listens on 127.0.0.1, so your API key is not reachable from other machines.
"""

import base64
import json
import re
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from openai_client import DEFAULT_MODEL, LOG_FILE, PRICES, ask, ask_with_reasoning, get_client, total_cost

HERE = Path(__file__).parent
PAGE = HERE / "playground.html"
TRIALS_FILE = HERE / "trials.json"
HISTORY_SIZE = 50
MAX_UPLOAD_MB = 50  # OpenAI's limit for all files in one request
MAX_RUNS = 200
STOP_AFTER_ERRORS = 3  # a batch stops after this many failed runs in a row (e.g. a wrong key)

# Models that do not answer text prompts through the Responses API (images, audio, embeddings, ...).
NON_TEXT = re.compile(
    r"audio|image|realtime|live|tts|transcribe|whisper|embedding|moderation|sora|dall-e|search|"
    r"instruct|^babbage|^davinci"
)
# Dated snapshots such as "gpt-4o-2024-08-06"; hidden from the list but still accepted if typed.
SNAPSHOT = re.compile(r"-\d{4}-\d{2}-\d{2}$|-\d{4}$")

_models: list[str] | None = None
lock = threading.Lock()  # trials.json writes and run numbering


def claude_models() -> list[str]:
    """Claude models from claude_client.PRICES, or none if the anthropic package is not installed."""
    try:
        from claude_client import PRICES as CLAUDE_PRICES
    except ImportError as e:
        print(f"[playground] Claude models not listed ({e}); pip install anthropic", file=sys.stderr)
        return []
    return list(CLAUDE_PRICES)


def gemini_models() -> list[str]:
    """Gemini models from gemini_client.PRICES, or none if the google-genai package is not installed."""
    try:
        from gemini_client import PRICES as GEMINI_PRICES
    except ImportError as e:
        print(f"[playground] Gemini models not listed ({e}); pip install google-genai", file=sys.stderr)
        return []
    return list(GEMINI_PRICES)


def available_models() -> list[str]:
    """Text models this OpenAI key can use (fetched once) plus every model in PRICES, then Claude and Gemini."""
    global _models
    if _models is None:
        try:
            ids = {m.id for m in get_client().models.list()}
            ids = {i for i in ids if not NON_TEXT.search(i) and not SNAPSHOT.search(i)}
        except Exception as e:
            print(f"[playground] could not list models from OpenAI ({e}); using PRICES only", file=sys.stderr)
            return sorted(PRICES) + claude_models() + gemini_models()
        _models = sorted(ids | set(PRICES)) + claude_models() + gemini_models()
    return _models


# ---------------------------------------------------------------- log

def all_calls() -> list[dict]:
    """Every logged call, oldest first."""
    if not LOG_FILE.exists():
        return []
    return [json.loads(line) for line in LOG_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]


def recent_calls(n: int = HISTORY_SIZE, query: str = "", trial: str | None = None) -> list[dict]:
    """Logged calls, newest first.
    trial=None: the last n calls (with a query: whose case name contains it, over the whole log).
    trial="<id>": every call of that trial.  trial="": calls that belong to no saved trial."""
    calls = all_calls()
    calls.reverse()
    if trial:
        return [c for c in calls if c.get("trial_id") == trial]
    if trial == "":
        known = {t["id"] for t in load_trials()}
        calls = [c for c in calls if c.get("trial_id") not in known and c.get("purpose") not in ("result_lookup", "summary_extraction")]
    q = query.strip().lower()
    if q:
        calls = [c for c in calls if q in (c.get("name") or "").lower()]
    return calls[:n]


DELETED_FILE = LOG_FILE.with_name("deleted_calls.jsonl")


def delete_call(key: str) -> dict:
    """Move one call (by response_id, or timestamp for calls without one) out of the log into
    deleted_calls.jsonl, with the time it was deleted. Nothing is lost: move the line back to undo."""
    if not key or not LOG_FILE.exists():
        raise ValueError("No such call.")
    lines = LOG_FILE.read_text(encoding="utf-8").splitlines()
    keep, removed = [], None
    for line in lines:
        if line.strip() and removed is None:
            c = json.loads(line)
            if (c.get("response_id") or c.get("timestamp")) == key:
                removed = c
                continue
        keep.append(line)
    if removed is None:
        raise ValueError("No such call in the log (already deleted?).")
    removed["deleted_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with DELETED_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(removed, ensure_ascii=False) + "\n")
    tmp = LOG_FILE.with_suffix(".tmp")
    tmp.write_text("".join(l + "\n" for l in keep), encoding="utf-8", newline="\n")
    tmp.replace(LOG_FILE)
    return removed


# ---------------------------------------------------------------- trials

def load_trials() -> list[dict]:
    if not TRIALS_FILE.exists():
        return []
    return json.loads(TRIALS_FILE.read_text(encoding="utf-8")).get("trials", [])


def save_trials(trials: list[dict]) -> None:
    TRIALS_FILE.write_text(json.dumps({"trials": trials}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "trial"


def number(value) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def upsert_trial(body: dict) -> dict:
    """Create a trial, or update it when body has the id of an existing one."""
    name = (body.get("name") or "").strip()
    if not name:
        raise ValueError("The trial needs a name.")
    result = body.get("result") or {}
    estimate, lower, upper = number(result.get("estimate")), number(result.get("lower")), number(result.get("upper"))
    if (lower is None) != (upper is None):
        raise ValueError("Give both ends of the reported interval, or neither.")
    if estimate is not None and lower is not None and not lower <= estimate <= upper:
        raise ValueError("The reported estimate should lie inside its interval.")
    trial = {
        "name": name,
        "nct": (body.get("nct") or "").strip().upper(),
        "notes": (body.get("notes") or "").strip(),
        "result": {
            "measure": (result.get("measure") or "HR").strip(),
            "estimate": estimate, "lower": lower, "upper": upper,
            "source": (result.get("source") or "").strip(),
        } if estimate is not None else None,
        "documents": clean_documents(body.get("documents")),  # protocol / SAP, converted once
        "summary": clean_summary(body.get("summary")),  # the trial summary extracted from them
    }
    with lock:
        trials = load_trials()
        existing = next((t for t in trials if t["id"] == body.get("id")), None)
        if existing:
            existing.update(trial)
            trial = existing
        else:
            ids = {t["id"] for t in trials}
            base = slug(name)
            trial["id"] = base if base not in ids else next(f"{base}-{i}" for i in range(2, 1000) if f"{base}-{i}" not in ids)
            trial["created"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            trials.append(trial)
        save_trials(trials)
    return trial


def delete_trial(trial_id: str) -> None:
    """Remove a trial from trials.json. Its logged calls stay in the log (under 'calls without a trial')."""
    with lock:
        save_trials([t for t in load_trials() if t["id"] != trial_id])


def trials_with_counts() -> list[dict]:
    """Saved trials, each with how many runs it has per series."""
    counts: dict[str, dict[str, int]] = {}
    for c in all_calls():
        if c.get("trial_id"):
            series = counts.setdefault(c["trial_id"], {})
            series[c.get("series") or ""] = series.get(c.get("series") or "", 0) + 1
    return [{**t, "series_counts": counts.get(t["id"], {}), "runs": sum(counts.get(t["id"], {}).values())}
            for t in load_trials()]


# ---------------------------------------------------------------- looking up a trial's reported result

CTGOV_URL = "https://clinicaltrials.gov/api/v2/studies/{nct}"
MEASURES = {"HR", "RR", "OR", "rate_ratio", "mean_difference"}
LOOKUP_SYSTEM = """You look up the published primary result of a clinical trial, for comparison with priors elicited \
before the trial reported. Use web search to find the primary publication or conference presentation; prefer the \
peer-reviewed primary paper over abstracts, and the primary analysis over later updates. A ClinicalTrials.gov registry \
summary may be given; use it to identify the trial and its primary endpoint, and use any results posted there.

Report the effect for the primary endpoint on its natural scale (e.g. HR 0.75, not log HR), as experimental arm versus \
control (invert it if the paper reports control versus experimental). If the trial has several primary comparisons \
(co-primary endpoints, separately analysed cohorts, several experimental arms), give one entry for each. Never guess a \
number: if you cannot find it, leave the result list empty and say so in "comment".

Return only a single valid JSON object, with no Markdown code fences and no text outside it:
{
  "trial_identifier": "string (trial name and NCT number)",
  "summary": "string (one line: population; experimental vs control; primary endpoint)",
  "primary_results": [
    {"label": "string (which comparison, e.g. 'dMMR cohort, PFS')", "measure": "HR | RR | OR | rate_ratio | mean_difference",
     "estimate": number, "lower": number or null, "upper": number or null, "ci_level": number or null,
     "source": "string (first author et al., journal or meeting, year)", "url": "string or null"}
  ],
  "comment": "string (caveats: e.g. no published result, interim analysis, CI level other than 95%)"
}"""


def ctgov_summary(nct: str) -> dict:
    """The parts of a ClinicalTrials.gov record that identify the trial, plus any primary results posted there."""
    import urllib.request
    req = urllib.request.Request(CTGOV_URL.format(nct=nct), headers={"Accept": "application/json", "User-Agent": "llm-priors-playground"})
    with urllib.request.urlopen(req, timeout=20) as r:
        study = json.load(r)
    p = study.get("protocolSection", {})
    ident, status, design = p.get("identificationModule", {}), p.get("statusModule", {}), p.get("designModule", {})
    summary = {
        "nct": ident.get("nctId"), "acronym": ident.get("acronym"), "title": ident.get("officialTitle") or ident.get("briefTitle"),
        "status": status.get("overallStatus"), "start": (status.get("startDateStruct") or {}).get("date"),
        "conditions": p.get("conditionsModule", {}).get("conditions"), "phases": design.get("phases"),
        "enrollment": (design.get("enrollmentInfo") or {}).get("count"),
        "arms": [{"label": a.get("label"), "type": a.get("type"), "interventions": a.get("interventionNames")}
                 for a in p.get("armsInterventionsModule", {}).get("armGroups", [])],
        "primary_outcomes": p.get("outcomesModule", {}).get("primaryOutcomes"),
        "has_posted_results": study.get("hasResults", False),
        "references": [{"citation": x.get("citation"), "pmid": x.get("pmid"), "type": x.get("type")}
                       for x in p.get("referencesModule", {}).get("references", [])][:15],
    }
    posted = []
    for m in study.get("resultsSection", {}).get("outcomeMeasuresModule", {}).get("outcomeMeasures", []):
        if m.get("type") != "PRIMARY":
            continue
        for a in m.get("analyses", []):
            posted.append({"outcome": m.get("title"), "groups": a.get("groupIds"), "param": a.get("paramType"),
                           "value": a.get("paramValue"), "ci_pct": a.get("ciPctValue"),
                           "lower": a.get("ciLowerLimit"), "upper": a.get("ciUpperLimit"), "p": a.get("pValue")})
    if posted:
        summary["posted_primary_analyses"] = posted
    return summary


def parse_json_answer(text: str) -> dict:
    """The JSON object in a model's answer, tolerating code fences or text around it."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("The model did not return JSON: " + text[:300])
    return json.loads(text[start:end + 1])


def lookup_result(body: dict) -> dict:
    """Find a trial's reported primary result: ClinicalTrials.gov record + one model call with web search.
    The call is logged (and costed) with purpose "result_lookup" and no trial_id, so it never counts as a run."""
    nct = (body.get("nct") or "").strip().upper()
    name = (body.get("name") or "").strip()
    if not nct and not name:
        raise ValueError("Give the trial name or NCT number first.")
    registry, registry_error = None, None
    if nct:
        try:
            registry = ctgov_summary(nct)
        except Exception as e:  # not fatal: the model can still search for it
            registry_error = f"{type(e).__name__}: {e}"
    prompt = f"The trial is {name or nct}" + (f" ({nct})" if nct and name else "") + "."
    if registry:
        prompt += "\n\nClinicalTrials.gov registry summary:\n" + json.dumps(registry, indent=1, ensure_ascii=False)
    model = (body.get("model") or "").strip() or DEFAULT_MODEL
    answer = ask(prompt, system=LOOKUP_SYSTEM, model=model, web_search=True, name=f"{name or nct} result lookup",
                 meta={"purpose": "result_lookup", "lookup_nct": nct or None, "trial": name or None})
    # a batch may be appending to the log meanwhile, so find this call rather than taking the last line
    last = next((c for c in recent_calls(20) if c.get("purpose") == "result_lookup"), None)
    return lookup_response(answer, registry, registry_error, model, last)


def lookup_response(answer: str, registry: dict | None, registry_error: str | None, model: str, call: dict | None) -> dict:
    """What the page shows for a lookup: the model's answer, cleaned, plus the registry facts."""
    found = parse_json_answer(answer)
    results = []
    for r in found.get("primary_results") or []:
        try:
            est, lo, up = number(r.get("estimate")), number(r.get("lower")), number(r.get("upper"))
        except (TypeError, ValueError):
            continue
        if est is None:
            continue
        measure = r.get("measure") if r.get("measure") in MEASURES else "HR"
        results.append({"label": r.get("label") or "", "measure": measure, "estimate": est, "lower": lo, "upper": up,
                        "ci_level": r.get("ci_level"), "source": r.get("source") or "", "url": r.get("url")})
    return {
        "summary": found.get("summary") or "", "comment": found.get("comment") or "", "results": results,
        "registry": {"title": registry.get("title"), "acronym": registry.get("acronym"), "status": registry.get("status"),
                     "has_posted_results": registry.get("has_posted_results")} if registry else None,
        "registry_error": registry_error, "model": model, "cost": call.get("cost_usd") if call else None,
        "timestamp": call.get("timestamp") if call else None,
    }


REGISTRY_MARK = "\n\nClinicalTrials.gov registry summary:\n"


def saved_lookup(nct: str, name: str) -> dict | None:
    """The latest logged lookup for this trial (by NCT number, else by name), as lookup_result returns it."""
    nct, name = (nct or "").strip().upper(), (name or "").strip().lower()
    for c in recent_calls(10**9):
        if c.get("purpose") != "result_lookup":
            continue
        if (nct and (c.get("lookup_nct") or "").upper() == nct) or (not nct and name and (c.get("trial") or "").lower() == name):
            prompt = c.get("prompt") or ""
            registry = None
            if REGISTRY_MARK in prompt:  # the registry summary was sent with the prompt; read it back from there
                try:
                    registry = json.loads(prompt.split(REGISTRY_MARK, 1)[1])
                except ValueError:
                    pass
            try:
                return lookup_response(c.get("answer") or "", registry, None, c.get("model_requested") or "", c)
            except ValueError:  # that answer was not JSON; try an older lookup
                continue
    return None


# ---------------------------------------------------------------- protocol / SAP: upload once, summarise once
#
# A trial's protocol and SAP are uploaded once and converted to Markdown (code/extracted/). One model call then
# writes a structured trial summary from them, which is saved in trials.json and can be edited. Runs put that
# summary in the prompt, so a trial the models have never seen (not in their training data) can still be
# described to them, and every run and model gets exactly the same text.

DOC_KINDS = {"protocol", "sap", "other"}
DOC_TEXT = {".md", ".txt"}
SUMMARY_FIELDS = [  # (key in the model's JSON, heading in the summary text)
    ("population", "Population"),
    ("eligibility", "Key eligibility criteria"),
    ("experimental_arm", "Experimental arm"),
    ("control_arm", "Control arm"),
    ("primary_endpoint", "Primary endpoint"),
    ("secondary_endpoints", "Key secondary endpoints"),
    ("design", "Design"),
    ("sample_size_and_analysis", "Sample size and primary analysis"),
]
EXTRACT_SYSTEM = """You extract the design of a clinical trial from its protocol and/or statistical analysis plan (SAP). \
Your summary will be given to other models that are asked for a prior distribution of the trial's treatment effect \
before the trial reports, so it must describe the trial as planned and must not reveal or hint at its results.

Rules:
- Use only what the documents say. If something is not in them, write "Not stated".
- Refer to the study as "the trial". Do not give its name or acronym, NCT/EudraCT numbers, sponsor protocol numbers, \
investigator names or other identifiers in the summary fields; put the identifiers only in "identifiers".
- Name drugs by generic name (or development code if there is none), with dose, route and schedule.
- Keep the sample-size assumptions (assumed effect size, control-arm rate or median, alpha, power) out of \
"sample_size_and_analysis"; put them only in "power_assumption".
- Do not include any results, including interim or blinded-pooled data. If the documents contain or hint at results \
(e.g. an amendment made after an interim analysis, a data monitoring committee recommendation, a changed sample size \
or endpoint), describe that only in "results_warning".
- If documents disagree (e.g. protocol amendments, SAP versions), use the latest version and note the difference \
in "notes".
- Be specific and concise: short paragraphs or semicolon-separated lists, no Markdown headings.

Return only a single valid JSON object, with no Markdown code fences and no text outside it:
{
  "population": "string (condition, stage, line of therapy, key biomarker or risk group)",
  "eligibility": "string (main inclusion and exclusion criteria)",
  "experimental_arm": "string",
  "control_arm": "string",
  "primary_endpoint": "string (definition, how and by whom it is assessed, effect measure, e.g. HR)",
  "secondary_endpoints": "string",
  "design": "string (phase, randomisation ratio, blinding, stratification factors, crossover, countries/regions if stated)",
  "sample_size_and_analysis": "string (planned patients and events, follow-up, interim analyses and stopping rules, \
primary analysis method and population; no assumed effect size)",
  "power_assumption": "string (assumed effect size, control-arm assumption, alpha, power; or 'Not stated')",
  "identifiers": "string (trial name/acronym, NCT and other numbers, sponsor)",
  "document_versions": "string (document type, version and date of each document read)",
  "results_warning": "string or null",
  "notes": "string or null"
}"""


def save_document(body: dict) -> dict:
    """Convert an uploaded protocol/SAP (PDF, Markdown or text) to Markdown in code/extracted/ and describe it.
    The page keeps the description and saves it with the trial; the extraction reads the Markdown from disk."""
    import hashlib
    from pdf_to_md import EXTRACTED_DIR, pdf_to_markdown

    filename = Path(body.get("name") or "").name
    kind = body.get("kind") if body.get("kind") in DOC_KINDS else "other"
    data = base64.b64decode(body.get("data") or "")
    if not filename or not data:
        raise ValueError("No file received.")
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise ValueError(f"{filename} is larger than {MAX_UPLOAD_MB} MB.")
    ext = Path(filename).suffix.lower()
    digest = hashlib.sha256(data).hexdigest()
    if ext == ".pdf":
        text, saved = pdf_to_markdown(filename, data)
    elif ext in DOC_TEXT:
        text = data.decode("utf-8", errors="replace")
        saved = EXTRACTED_DIR / f"{Path(filename).stem}_{digest[:12]}.md"
        EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)
        saved.write_text(text, encoding="utf-8")
    else:
        raise ValueError(f"{filename}: upload the protocol or SAP as PDF (or Markdown/text).")
    return {"kind": kind, "filename": filename, "bytes": len(data), "sha256": digest,
            "markdown_file": saved.name, "chars": len(text),
            "uploaded": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def document_text(doc: dict) -> str:
    """The Markdown of an uploaded document, from code/extracted/."""
    from pdf_to_md import EXTRACTED_DIR

    path = EXTRACTED_DIR / Path(doc.get("markdown_file") or "").name  # a bare file name, never a path
    if not doc.get("markdown_file") or not path.is_file():
        raise ValueError(f"{doc.get('filename')}: its converted text is missing from code/extracted/. Upload it again.")
    return path.read_text(encoding="utf-8")


def clean_documents(docs) -> list[dict]:
    keys = ("kind", "filename", "bytes", "sha256", "markdown_file", "chars", "uploaded")
    return [{k: d.get(k) for k in keys} for d in docs or [] if isinstance(d, dict) and d.get("sha256")]


def summary_text(found: dict) -> str:
    """The summary as it goes into the prompt: one '<heading>: <text>' paragraph per field."""
    return "\n\n".join(f"{heading}: {str(found.get(key) or 'Not stated').strip()}" for key, heading in SUMMARY_FIELDS)


def extract_summary(body: dict) -> dict:
    """One model call that writes the trial summary from the uploaded documents. Logged and costed with purpose
    "summary_extraction" and no trial_id, so it never counts as a run."""
    docs = clean_documents(body.get("documents"))
    if not docs:
        raise ValueError("Upload the protocol and/or SAP first.")
    files = [(f"{d['kind']}_{Path(d['filename']).stem}.md", document_text(d).encode("utf-8")) for d in docs]
    model = (body.get("model") or "").strip() or DEFAULT_MODEL
    name = (body.get("name") or "").strip() or "trial"
    answer = ask("Extract the trial design from the attached documents, following the instructions.",
                 system=EXTRACT_SYSTEM, model=model, effort=(body.get("effort") or "").strip() or None,
                 files=files, name=f"{name} summary extraction",
                 meta={"purpose": "summary_extraction", "trial": name, "documents": [d["sha256"] for d in docs]})
    found = parse_json_answer(answer)
    call = next((c for c in recent_calls(20) if c.get("purpose") == "summary_extraction"), None)
    return {
        "text": summary_text(found),
        "power": str(found.get("power_assumption") or "").strip(),
        "identifiers": str(found.get("identifiers") or "").strip(),
        "document_versions": str(found.get("document_versions") or "").strip(),
        "results_warning": str(found.get("results_warning") or "").strip() or None,
        "notes": str(found.get("notes") or "").strip() or None,
        "documents": [d["sha256"] for d in docs],
        "model": model, "cost": call.get("cost_usd") if call else None,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "edited": False,
    }


def clean_summary(s) -> dict | None:
    """The trial summary as saved in trials.json (None if there is no text)."""
    if not isinstance(s, dict) or not (s.get("text") or "").strip():
        return None
    keys = ("identifiers", "document_versions", "results_warning", "notes", "documents", "model", "cost", "created", "edited")
    return {"text": s["text"].strip(), "power": (s.get("power") or "").strip(), **{k: s.get(k) for k in keys}}


def next_run_number(trial_id: str, series: str) -> int:
    """One past the highest run number logged for this trial and series."""
    runs = [c.get("run") or 0 for c in all_calls()
            if c.get("trial_id") == trial_id and (c.get("series") or "") == series]
    return max(runs, default=0) + 1


# ---------------------------------------------------------------- calls

def parse_request(body: dict) -> dict:
    """The settings of one call from the page's JSON body. Raises ValueError on bad input."""
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("The prompt is empty.")
    trial = next((t for t in load_trials() if t["id"] == body.get("trial_id")), None)
    if trial is None:
        raise ValueError("Choose or create a clinical trial first.")
    files = [(f["name"], base64.b64decode(f["data"])) for f in body.get("files") or []]
    if sum(len(data) for _, data in files) > MAX_UPLOAD_MB * 1024 * 1024:
        raise ValueError(f"The attached files are larger than {MAX_UPLOAD_MB} MB in total.")
    return {
        "prompt": prompt,
        "system": (body.get("system") or "").strip() or None,
        "model": (body.get("model") or "").strip() or DEFAULT_MODEL,
        "web_search": bool(body.get("web_search")),
        "trial": trial,
        "series": (body.get("series") or "").strip(),
        "effort": (body.get("effort") or "").strip() or None,
        "files": files or None,
        "reasoning": bool(body.get("reasoning")),
        "temperature": body.get("temperature"),
        "prompt_parts": body.get("prompt_parts") if isinstance(body.get("prompt_parts"), dict) else None,
    }


def run_name(req: dict, run: int) -> str:
    return " ".join(x for x in (req["trial"]["name"], req["series"], f"run{run}") if x)


def run_one(req: dict, run: int) -> tuple[str, str]:
    """Send one run with these settings; it is logged by ask() / ask_with_reasoning()."""
    trial = req["trial"]
    meta = {"trial_id": trial["id"], "trial": trial["name"], "nct": trial.get("nct") or None,
            "series": req["series"], "run": run}
    if req["prompt_parts"]:  # what the prompt was built from (trial name, summary, power assumption)
        meta["prompt_parts"] = req["prompt_parts"]
    common = dict(system=req["system"], model=req["model"], web_search=req["web_search"], name=run_name(req, run),
                  effort=req["effort"], files=req["files"], meta=meta)
    if req["reasoning"]:
        return ask_with_reasoning(req["prompt"], **common)
    return ask(req["prompt"], temperature=req["temperature"], **common), ""


class Batch:
    """Runs of one prompt for one trial and series, in a background thread. One batch at a time."""

    def __init__(self, req: dict, runs: int, interval_min: float):
        self.req, self.runs, self.interval = req, runs, interval_min * 60
        self.first = next_run_number(req["trial"]["id"], req["series"])
        self.done = self.failed = 0
        self.errors: list[str] = []
        self.current: str | None = None
        self.next_at: float | None = None
        self.state = "running"  # running | finished | stopped | failed
        self.stop_event = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        in_a_row = 0
        for i in range(self.runs):
            if self.stop_event.is_set():
                self.state = "stopped"
                return
            run = self.first + i
            self.current, self.next_at = run_name(self.req, run), None
            try:
                run_one(self.req, run)
                self.done += 1
                in_a_row = 0
            except Exception as e:
                self.failed += 1
                in_a_row += 1
                self.errors.append(f"{self.current}: {type(e).__name__}: {e}")
                print(f"[playground] {self.errors[-1]}", file=sys.stderr)
                if in_a_row >= STOP_AFTER_ERRORS:
                    self.state, self.current = "failed", None
                    return
            self.current = None
            if i < self.runs - 1 and self.interval > 0:
                self.next_at = time.time() + self.interval  # the gap counts from the end of a run
                if self.stop_event.wait(self.interval):
                    self.state, self.next_at = "stopped", None
                    return
        self.state, self.next_at = "finished", None

    def status(self) -> dict:
        return {
            "state": self.state, "runs": self.runs, "done": self.done, "failed": self.failed,
            "trial_id": self.req["trial"]["id"], "trial": self.req["trial"]["name"], "series": self.req["series"],
            "first_run": self.first, "last_run": self.first + self.runs - 1,
            "first_name": run_name(self.req, self.first), "last_name": run_name(self.req, self.first + self.runs - 1),
            "current": self.current, "next_at": self.next_at, "errors": self.errors[-5:],
            "interval_min": self.interval / 60, "model": self.req["model"],
        }


batch: Batch | None = None


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query, keep_blank_values=True)  # "trial=" means: calls without a trial
        if url.path in ("/", "/index.html"):
            self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        elif url.path == "/api/info":
            self._json(200, {
                "default_model": DEFAULT_MODEL, "models": available_models(),
                "total_cost": total_cost(),  # includes deleted runs: they were still paid for
                # lets the page detect a server started before these features existed
                "uploads": True, "batch": True, "trials": True, "delete_calls": True, "lookup": True,
                "summary": True,
            })
        elif url.path == "/api/trials":
            self._json(200, {"trials": trials_with_counts()})
        elif url.path == "/api/batch":
            self._json(200, {"batch": batch.status() if batch else None})
        elif url.path == "/api/history":
            trial = query["trial"][0] if "trial" in query else None
            self._json(200, {"calls": recent_calls(query=query.get("q", [""])[0], trial=trial)})
        elif url.path == "/api/trials/lookup":  # the latest saved lookup of a trial, or null
            self._json(200, {"lookup": saved_lookup(query.get("nct", [""])[0], query.get("name", [""])[0])})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        routes = {
            "/api/ask": self._ask, "/api/batch": self._start_batch, "/api/batch/stop": self._stop_batch,
            "/api/trials": self._save_trial, "/api/trials/delete": self._delete_trial,
            "/api/calls/delete": self._delete_call, "/api/trials/lookup": self._lookup_result,
            "/api/documents": lambda b: self._json(200, {"document": save_document(b)}),
            "/api/summary/extract": lambda b: self._json(200, {"summary": extract_summary(b)}),
        }
        if self.path not in routes:
            return self._json(404, {"error": "not found"})
        try:
            routes[self.path](self._body())
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # show API errors (bad model name, missing key, ...) in the page
            self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def _ask(self, body: dict) -> None:
        req = parse_request(body)
        if batch and batch.state == "running":
            raise ValueError("A batch is running. Wait for it or stop it first.")
        with lock:  # reserve the run number
            run = next_run_number(req["trial"]["id"], req["series"])
        answer, reasoning = run_one(req, run)
        # The call was just appended to the log; return it so the page shows tokens and cost.
        last = recent_calls(1)
        self._json(200, {"answer": answer, "reasoning": reasoning, "call": last[0] if last else None})

    def _start_batch(self, body: dict) -> None:
        global batch
        req = parse_request(body)
        try:
            runs = int(body.get("runs") or 0)
            interval = float(body.get("interval_minutes") or 0)
        except (TypeError, ValueError):
            raise ValueError("Runs and minutes between runs must be numbers.")
        if not 1 <= runs <= MAX_RUNS:
            raise ValueError(f"Runs must be between 1 and {MAX_RUNS}.")
        if interval < 0:
            raise ValueError("The interval cannot be negative.")
        with lock:
            if batch and batch.state == "running":
                return self._json(409, {"error": "A batch is already running. Stop it first."})
            batch = Batch(req, runs, interval)
        self._json(200, {"batch": batch.status()})

    def _stop_batch(self, body: dict) -> None:
        if batch and batch.state == "running":
            batch.stop_event.set()
        self._json(200, {"batch": batch.status() if batch else None})

    def _save_trial(self, body: dict) -> None:
        self._json(200, {"trial": upsert_trial(body)})

    def _lookup_result(self, body: dict) -> None:
        self._json(200, lookup_result(body))

    def _delete_trial(self, body: dict) -> None:
        if batch and batch.state == "running" and batch.req["trial"]["id"] == body.get("id"):
            raise ValueError("A batch for this trial is running. Stop it first.")
        delete_trial(body.get("id") or "")
        self._json(200, {"ok": True})

    def _delete_call(self, body: dict) -> None:
        with lock:
            if batch and batch.state == "running":  # the batch appends to the log; don't rewrite it meanwhile
                raise ValueError("A batch is running. Delete runs after it finishes or is stopped.")
            c = delete_call(body.get("key") or "")
        self._json(200, {"deleted": c.get("name") or c.get("timestamp")})

    def _body(self) -> dict:
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")

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
    print(f"LLM Bayesian Priors running at http://127.0.0.1:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
