"""Claude (Anthropic) models for ask() / ask_with_reasoning().

You do not call this module directly: pass a Claude model name to the usual functions and
they are routed here, e.g.
    from openai_client import ask
    ask("...", model="claude-opus-5-5", files=["protocol.pdf"])

Setup: pip install anthropic, and put ANTHROPIC_API_KEY=sk-ant-... in the project's .env.

Calls are logged to the same logs/openai_calls.jsonl as the OpenAI calls, with the same fields
(plus "provider", "stop_reason" and "fallback_used"), so the playground, total cost and the
prior display work for both.

Differences from the OpenAI models:
  - Reasoning effort: "low", "medium", "high", "xhigh", "max" (no "none"/"minimal").
    Claude Opus 5.5 and Haiku 5.5 default to "medium", the others to "high".
  - Temperature is not accepted by current Claude models.
  - Attached files and the system prompt are cached between calls (5 minutes), so repeated runs
    with the same protocol/SAP pay ~5-10% of the input price for them after the first call.
  - Refusal fallback: if Claude Opus 5.5 (and some other models) declines a request for safety
    reasons, the API answers with another Claude model instead. This is logged as
    fallback_used=true and model_returned shows which model answered. Pass fallback=False to
    turn it off.
"""

import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import anthropic

from openai_client import LOG_FILE, TEXT_EXTENSIONS, WEB_SEARCH_PRICE, _read_file, total_cost

# USD per 1M tokens: (input, cached input read, output). Anthropic first-party API prices,
# checked 2026-11-22 — update when prices change. Output includes thinking tokens.
# Writing to the cache costs CACHE_WRITE_FACTOR × the input price.
# Haiku 5.5 costs more for prompts over 100K tokens ($0.50 / $2.50); not modelled here.
PRICES = {
    "claude-fable-5-2": (8.00, 0.20, 40.00),
    "claude-fable-5-1": (10.00, 0.25, 50.00),
    "claude-fable-5": (10.00, 1.00, 50.00),
    "claude-opus-5-5": (4.00, 0.20, 20.00),
    "claude-opus-5": (5.00, 0.50, 25.00),
    "claude-opus-4-8": (5.00, 0.50, 25.00),
    "claude-opus-4-7": (5.00, 0.50, 25.00),
    "claude-opus-4-6": (5.00, 0.50, 25.00),
    "claude-sonnet-5-5": (2.00, 0.10, 10.00),
    "claude-sonnet-5": (2.00, 0.20, 10.00),
    "claude-sonnet-4-6": (3.00, 0.30, 15.00),
    "claude-haiku-5-5": (0.10, 0.01, 0.50),
    "claude-haiku-4-5": (1.00, 0.10, 5.00),
}
CACHE_WRITE_FACTOR = 1.25  # 5-minute cache

DEFAULT_EFFORT = {"claude-opus-5-5": "medium", "claude-haiku-5-5": "medium"}  # others: "high"
EFFORTS = {"low", "medium", "high", "xhigh", "max"}

# Models with the server-side refusal fallback, and those with the newer web search tool.
FALLBACK_MODELS = {"claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}
NEW_WEB_SEARCH_MODELS = {
    "claude-fable-5-2", "claude-fable-5-1", "claude-fable-5", "claude-opus-5-5", "claude-opus-5",
    "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5-5", "claude-sonnet-5",
    "claude-sonnet-4-6",
}
NO_ADAPTIVE_THINKING = {"claude-haiku-4-5"}  # older model: answers without thinking here

MAX_TOKENS = 64000
MAX_CONTINUATIONS = 5  # a web search turn can pause; resume it at most this many times

_client = None


def get_client() -> anthropic.Anthropic:
    """Create the Anthropic client once; it reads ANTHROPIC_API_KEY from the environment (.env)."""
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def build_content(prompt: str, files: list | None) -> tuple[list[dict], list[dict]]:
    """User message content (files first, then the prompt) and a log entry per file."""
    content, info = [], []
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
            raise ValueError(f"{filename}: Claude models here accept PDFs and text files only. Save it as PDF and attach that.")
        content.append({"type": "text", "text": f'<file name="{name}">\n{text}\n</file>'})
        info.append(entry)
    if content:
        # Cache everything up to the end of the files, so the next call with the same system
        # prompt and files reads them from the cache. The prompt after it may change freely.
        content[-1]["cache_control"] = {"type": "ephemeral"}
    content.append({"type": "text", "text": prompt})
    return content, info


def call_claude(prompt, system, model, temperature, summary, web_search, log, name=None, effort=None,
                files=None, fallback=True, meta=None) -> tuple[str, str]:
    """Send one prompt to a Claude model; returns (answer, reasoning_summary). See the module docstring."""
    if temperature is not None:
        raise ValueError("Claude models do not accept a temperature. Leave it blank.")
    if effort and effort not in EFFORTS:
        raise ValueError(f'Reasoning effort "{effort}" is not available for Claude; use one of: low, medium, high, xhigh, max.')

    content, file_info = build_content(prompt, files)
    params = {"model": model, "max_tokens": MAX_TOKENS, "messages": [{"role": "user", "content": content}]}
    if system:
        params["system"] = system
    if model not in NO_ADAPTIVE_THINKING:
        params["thinking"] = {"type": "adaptive", "display": "summarized" if summary else "omitted"}
    if effort:
        params["output_config"] = {"effort": effort}
    if web_search:
        tool = "web_search_20260209" if model in NEW_WEB_SEARCH_MODELS else "web_search_20250305"
        params["tools"] = [{"type": tool, "name": "web_search"}]
    use_fallback = fallback and model in FALLBACK_MODELS

    start = time.perf_counter()
    blocks, responses = [], []
    messages = params["messages"]
    for _ in range(MAX_CONTINUATIONS + 1):
        response = _stream(dict(params, messages=messages), use_fallback)
        responses.append(response)
        blocks += response.content
        if response.stop_reason != "pause_turn":
            break
        # A long web search turn paused; send it back unchanged and the server carries on.
        messages = params["messages"] + [{"role": "assistant", "content": response.content}]
    final = responses[-1]

    answer = "".join(b.text for b in blocks if b.type == "text")
    reasoning = "\n\n".join(b.thinking for b in blocks if b.type == "thinking" and getattr(b, "thinking", ""))
    if final.stop_reason == "refusal":
        details = getattr(final, "stop_details", None)
        answer = answer or f"[Claude declined to answer: {getattr(details, 'category', None) or 'no category'}]"

    if log:
        _log_call(params, responses, blocks, answer, reasoning, time.perf_counter() - start, name, prompt,
                  file_info, effort, use_fallback, meta)
    return answer, reasoning


def _stream(params: dict, use_fallback: bool):
    """One request, streamed (long inputs and outputs would time out otherwise)."""
    client = get_client()
    if use_fallback:
        with client.beta.messages.stream(
            **params, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
        ) as stream:
            return stream.get_final_message()
    with client.messages.stream(**params) as stream:
        return stream.get_final_message()


def price_for(model: str):
    matches = [m for m in PRICES if model == m or model.startswith(m + "-")]
    return PRICES[max(matches, key=len)] if matches else None


def call_cost(model: str, uncached: int, cache_write: int, cache_read: int, output: int) -> float | None:
    price = price_for(model)
    if price is None:
        return None
    p_in, p_read, p_out = price
    return (uncached * p_in + cache_write * p_in * CACHE_WRITE_FACTOR + cache_read * p_read + output * p_out) / 1_000_000


def web_search_details(blocks, searches: int) -> dict:
    """What Claude searched for and which pages it saw and cited (same fields as the OpenAI log)."""
    queries, consulted, cited = [], [], {}
    for b in blocks:
        if b.type == "server_tool_use" and b.name == "web_search":
            q = (b.input or {}).get("query") if isinstance(b.input, dict) else None
            if q:
                queries.append(q)
        elif b.type == "web_search_tool_result" and isinstance(b.content, list):  # an error is an object
            consulted += [r.url for r in b.content if getattr(r, "url", None)]
        elif b.type == "text":
            for c in getattr(b, "citations", None) or []:
                if getattr(c, "url", None):
                    cited.setdefault(c.url, getattr(c, "title", None))
    return {
        "web_search_calls": searches or len(queries),
        "web_search_queries": queries,
        "web_sources_consulted": list(dict.fromkeys(consulted)),
        "web_sources_cited": [{"url": u, "title": t} for u, t in cited.items()],
    }


def _log_call(params, responses, blocks, answer, reasoning, seconds, name, prompt, files, effort, use_fallback,
              meta=None) -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    uncached = cache_write = cache_read = output = searches = 0
    fallback_used = False
    for r in responses:
        u = r.usage
        uncached += u.input_tokens or 0
        cache_write += getattr(u, "cache_creation_input_tokens", 0) or 0
        cache_read += getattr(u, "cache_read_input_tokens", 0) or 0
        output += u.output_tokens or 0
        searches += getattr(getattr(u, "server_tool_use", None), "web_search_requests", 0) or 0
        fallback_used |= any(getattr(i, "type", None) == "fallback_message" for i in getattr(u, "iterations", None) or [])
    final = responses[-1]
    model = final.model or params["model"]
    cost = call_cost(model, uncached, cache_write, cache_read, output)
    if cost is None:
        print(f"[claude_client] No price for model '{model}'; add it to PRICES to track cost.", file=sys.stderr)
    web = web_search_details(blocks, searches) if "tools" in params else {}
    search_cost = web.get("web_search_calls", 0) * WEB_SEARCH_PRICE
    if search_cost:
        cost = (cost or 0.0) + search_cost
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider": "anthropic",
        "name": (name or "").strip() or None,
        **(meta or {}),  # e.g. trial_id, series, run
        "model_requested": params["model"],
        "model_returned": model,  # differs from model_requested if a refusal fallback answered
        "fallback_enabled": use_fallback,
        "fallback_used": fallback_used,
        "response_id": final.id,
        "temperature": None,
        "reasoning_effort_requested": effort,
        "reasoning_effort": effort or DEFAULT_EFFORT.get(params["model"], "high"),  # not reported by the API
        "system": params.get("system"),
        "prompt": prompt,
        "files": files or None,
        "answer": answer,
        "reasoning_summary": reasoning or None,
        "stop_reason": final.stop_reason,
        "web_search": "tools" in params,
        **web,
        **({"web_search_cost_usd": round(search_cost, 6)} if web else {}),
        "input_tokens": uncached + cache_write + cache_read,  # whole prompt, as in the OpenAI records
        "cached_input_tokens": cache_read,
        "cache_write_input_tokens": cache_write,
        "output_tokens": output,
        "reasoning_tokens": None,  # included in output_tokens; the API does not report it separately
        "cost_usd": round(cost, 6) if cost is not None else None,
        "total_cost_usd": round(total_cost() + (cost or 0.0), 6),
        "seconds": round(seconds, 2),
    }
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
