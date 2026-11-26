"""Gemini (Google) models for ask() / ask_with_reasoning().

You do not call this module directly: pass a Gemini model name to the usual functions and
they are routed here, e.g.
    from openai_client import ask
    ask("...", model="gemini-3.8-flash", files=["protocol.pdf"])

Setup: pip install google-genai, and put GEMINI_API_KEY=... in the project's .env
(create a key at https://aistudio.google.com/apikey).

Calls are logged to the same logs/openai_calls.jsonl as the OpenAI and Claude calls, with the
same fields (plus "provider" and "stop_reason"), so the playground, total cost and the prior
display work for all of them.

Differences from the OpenAI models:
  - Reasoning effort is Gemini's thinking level: "minimal", "low", "medium", "high" (not every
    model accepts every level; gemini-3.8-flash rejects "minimal"). Blank = the model's default.
  - Temperature is accepted. Google recommends leaving it at the default (1.0) for Gemini 3+.
  - Web search is "Grounding with Google Search". Each search query is billed separately
    (SEARCH_PRICE); the 5,000 free queries a month are not subtracted here, so the logged cost
    is an upper bound while you are within the free allowance.
  - The thinking summary ("reasoning") is Gemini's thought summary, not the raw reasoning.
"""

import hashlib
import json
import os
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

from google import genai
from google.genai import types

from openai_client import ENV_FILE, LOG_FILE, TEXT_EXTENSIONS, _read_file, total_cost

# USD per 1M tokens: (input, cached input read, output). Gemini Developer API, paid tier,
# standard (not batch), checked 2026-11-23 at https://ai.google.dev/gemini-api/docs/pricing —
# update when prices change. Output includes thinking tokens. Each model has a list of
# (date the price applies from, prices); introductory prices end on the dates shown.
PRICES = {
    "gemini-4-carbon": [("2000-01-01", (2.00, 0.10, 10.00)), ("2026-12-01", (4.00, 0.20, 20.00))],
    "gemini-4-argon": [("2000-01-01", (2.00, 0.10, 10.00)), ("2026-12-01", (4.00, 0.20, 20.00))],
    "gemini-4-neon": [("2000-01-01", (3.00, 0.15, 15.00))],
    "gemini-4-hydrogen": [("2000-01-01", (1.50, 0.075, 7.50))],
    "gemini-3.8-flash": [("2000-01-01", (0.75, 0.075, 3.75)), ("2027-01-01", (1.50, 0.15, 7.50))],
    "gemini-3.6-flash": [("2000-01-01", (0.75, 0.075, 3.75)), ("2027-01-01", (1.50, 0.15, 7.50))],
    "gemini-3.5-flash-lite": [("2000-01-01", (0.30, 0.03, 2.50))],
    "gemini-3.1-flash-lite": [("2000-01-01", (0.25, 0.025, 1.50))],
}
# Not listed: gemini-3.1-pro-preview and gemini-3-flash-preview (priced, but the API returned
# "not found" for them on 2026-11-23); gemini-3.5-flash and gemini-3.7-flash (available, but
# not on the pricing page). Add them here with their prices to use them.

# USD per Google Search query ($14 per 1,000 for Gemini 3 and newer, after 5,000 free a month).
SEARCH_PRICE = 0.014

LEVELS = {"minimal", "low", "medium", "high"}

_client = None


def get_client() -> genai.Client:
    """Create the Gemini client once; it reads GEMINI_API_KEY from the environment (.env)."""
    global _client
    if _client is None:
        key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not key:
            raise RuntimeError(f"GEMINI_API_KEY is not set. Paste it into {ENV_FILE} as GEMINI_API_KEY=...")
        _client = genai.Client(api_key=key)
    return _client


def build_contents(prompt: str, files: list | None) -> tuple[list[types.Part], list[dict]]:
    """User message parts (files first, then the prompt) and a log entry per file."""
    parts, info = [], []
    for item in files or []:
        filename, data = _read_file(item)
        ext = Path(filename).suffix.lower()
        entry = {"filename": filename, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        if ext == ".pdf":
            from pdf_to_md import pdf_to_markdown

            text, saved = pdf_to_markdown(filename, data)
            name = f"{Path(filename).stem}.md"
            entry.update(sent_as="markdown", markdown_chars=len(text), markdown_file=saved.name)
        elif ext in TEXT_EXTENSIONS:
            text, name = data.decode("utf-8", errors="replace"), filename
            entry.update(sent_as="text")
        else:
            raise ValueError(f"{filename}: Gemini models here accept PDFs and text files only. Save it as PDF and attach that.")
        parts.append(types.Part.from_text(text=f'<file name="{name}">\n{text}\n</file>'))
        info.append(entry)
    parts.append(types.Part.from_text(text=prompt))
    return parts, info


def call_gemini(prompt, system, model, temperature, summary, web_search, log, name=None, effort=None,
                files=None, meta=None) -> tuple[str, str]:
    """Send one prompt to a Gemini model; returns (answer, thought_summary). See the module docstring."""
    if effort and effort not in LEVELS:
        raise ValueError(f'Reasoning effort "{effort}" is not available for Gemini; use one of: minimal, low, medium, high.')
    parts, file_info = build_contents(prompt, files)
    config = {}
    if system:
        config["system_instruction"] = system
    if temperature is not None:
        config["temperature"] = temperature
    if summary or effort:
        config["thinking_config"] = types.ThinkingConfig(
            include_thoughts=bool(summary), **({"thinking_level": effort.upper()} if effort else {}))
    if web_search:
        config["tools"] = [types.Tool(google_search=types.GoogleSearch())]

    start = time.perf_counter()
    response = get_client().models.generate_content(
        model=model, contents=[types.Content(role="user", parts=parts)],
        config=types.GenerateContentConfig(**config))
    seconds = time.perf_counter() - start

    candidate = (response.candidates or [None])[0]
    content_parts = (candidate.content.parts if candidate and candidate.content else None) or []
    answer = "".join(p.text for p in content_parts if p.text and not p.thought)
    reasoning = "\n\n".join(p.text for p in content_parts if p.text and p.thought)
    if not answer and candidate is None:  # blocked before generation, e.g. by a safety filter
        feedback = getattr(response, "prompt_feedback", None)
        answer = f"[Gemini returned no answer: {getattr(feedback, 'block_reason', None) or 'no reason given'}]"

    if log:
        _log_call(model, config, response, candidate, answer, reasoning, seconds, name, prompt, file_info, effort,
                  temperature, meta)
    return answer, reasoning


def price_for(model: str, day: date | None = None):
    """Prices on the given day (default today), by the longest matching model name."""
    matches = [m for m in PRICES if model == m or model.startswith(m + "-")]
    if not matches:
        return None
    today = (day or date.today()).isoformat()
    return [p for since, p in PRICES[max(matches, key=len)] if since <= today][-1]


def web_search_details(candidate) -> dict:
    """What Gemini searched for and which pages it saw and cited (same fields as the other logs).
    Gemini gives each page as a Google redirect link; its title is the site's domain."""
    g = getattr(candidate, "grounding_metadata", None)
    chunks = [c.web for c in (getattr(g, "grounding_chunks", None) or []) if getattr(c, "web", None)]
    cited_idx = {i for s in (getattr(g, "grounding_supports", None) or []) for i in (s.grounding_chunk_indices or [])}
    queries = list(getattr(g, "web_search_queries", None) or [])
    return {
        "web_search_calls": len(queries),
        "web_search_queries": queries,
        "web_sources_consulted": list(dict.fromkeys(c.uri for c in chunks if c.uri)),
        "web_sources_cited": [{"url": chunks[i].uri, "title": chunks[i].title} for i in sorted(cited_idx) if i < len(chunks)],
    }


def _log_call(model, config, response, candidate, answer, reasoning, seconds, name, prompt, files, effort,
              temperature, meta=None) -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    u = response.usage_metadata
    prompt_tokens = (getattr(u, "prompt_token_count", 0) or 0) + (getattr(u, "tool_use_prompt_token_count", 0) or 0)
    cached = getattr(u, "cached_content_token_count", 0) or 0
    thoughts = getattr(u, "thoughts_token_count", 0) or 0
    output = (getattr(u, "candidates_token_count", 0) or 0) + thoughts
    price = price_for(model)
    cost = None
    if price is None:
        print(f"[gemini_client] No price for model '{model}'; add it to PRICES to track cost.", file=sys.stderr)
    else:
        p_in, p_read, p_out = price
        cost = ((prompt_tokens - cached) * p_in + cached * p_read + output * p_out) / 1_000_000
    web = web_search_details(candidate) if "tools" in config else {}
    search_cost = web.get("web_search_calls", 0) * SEARCH_PRICE
    if search_cost:
        cost = (cost or 0.0) + search_cost
    finish = getattr(candidate, "finish_reason", None)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider": "google",
        "name": (name or "").strip() or None,
        **(meta or {}),  # e.g. trial_id, series, run
        "model_requested": model,
        "model_returned": getattr(response, "model_version", None),
        "response_id": getattr(response, "response_id", None),
        "temperature": temperature,
        "reasoning_effort_requested": effort,
        "reasoning_effort": effort,  # None = the model's default level, which the API does not report
        "system": config.get("system_instruction"),
        "prompt": prompt,
        "files": files or None,
        "answer": answer,
        "reasoning_summary": reasoning or None,
        "stop_reason": getattr(finish, "name", None) or (str(finish) if finish else None),
        "web_search": "tools" in config,
        **web,
        **({"web_search_cost_usd": round(search_cost, 6)} if web else {}),
        "input_tokens": prompt_tokens,  # includes search results read by the model
        "cached_input_tokens": cached,
        "output_tokens": output,  # includes thinking tokens, as in the other records
        "reasoning_tokens": thoughts,
        "cost_usd": round(cost, 6) if cost is not None else None,
        "total_cost_usd": round(total_cost() + (cost or 0.0), 6),
        "seconds": round(seconds, 2),
    }
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
