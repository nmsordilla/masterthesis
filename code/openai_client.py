"""Minimal helper for calling the OpenAI API with a prompt.

Setup:
    pip install -r code/requirements.txt
    Put your key in the .env file at the project root (ignored by git):
        OPENAI_API_KEY=sk-...

Usage from Python:
    from openai_client import ask
    print(ask("What is a prior distribution? Answer in one sentence."))

    answer, reasoning = ask_with_reasoning("...")  # also see how it got there

Usage from the terminal:
    python code/openai_client.py "What is a prior distribution?"
"""

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from openai import OpenAI

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load_env(path: Path = ENV_FILE) -> None:
    """Read KEY=value lines from the project's .env file into the environment.

    Variables already set in the shell take precedence over the file.
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if value:
            os.environ.setdefault(key.strip(), value)


load_env()

DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-mini")
LOG_FILE = Path(__file__).parent / "logs" / "openai_calls.jsonl"

# USD per 1M tokens: (input, cached input, output). Standard tier, short context (≤272K input).
# From https://developers.openai.com/api/docs/pricing, checked 2026-10-26 — update when prices change.
# Output tokens include hidden reasoning tokens, which are billed as output.
PRICES = {
    "gpt-6-astra": (10.00, 1.00, 50.00),
    "gpt-6.1-sol": (2.00, 0.10, 10.00),
    "gpt-6.1-terra": (1.00, 0.05, 5.00),
    "gpt-6-sol": (2.00, 0.20, 10.00),
    "gpt-6-luna": (0.10, 0.01, 0.50),
    "gpt-5.6-sol": (4.00, 0.40, 20.00),
    "gpt-5.6-terra": (2.00, 0.20, 12.00),
    "gpt-5.6-luna": (0.20, 0.02, 1.20),
    "gpt-5.5-pro": (30.00, 30.00, 180.00),
    "gpt-5.5": (5.00, 0.50, 30.00),
    "gpt-5.4-pro": (30.00, 30.00, 180.00),
    "gpt-5.4-mini": (0.75, 0.075, 4.50),
    "gpt-5.4-nano": (0.20, 0.02, 1.25),
    "gpt-5.4": (2.50, 0.25, 15.00),
    "gpt-5.2-pro": (21.00, 21.00, 168.00),
    "gpt-5.2": (1.75, 0.175, 14.00),
    "gpt-5.1": (1.25, 0.125, 10.00),
    "gpt-5-mini": (0.25, 0.025, 2.00),
    "gpt-5-nano": (0.05, 0.005, 0.40),
    "gpt-5": (1.25, 0.125, 10.00),
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
    "gpt-4.1-nano": (0.10, 0.025, 0.40),
    "gpt-4.1": (2.00, 0.50, 8.00),
    "gpt-4o-mini": (0.15, 0.075, 0.60),
    "gpt-4o": (2.50, 1.25, 10.00),
    "o4-mini": (1.10, 0.275, 4.40),
    "o3": (2.00, 0.50, 8.00),
}

_client = None


def get_client() -> OpenAI:
    """Create the OpenAI client once; it reads OPENAI_API_KEY from the environment."""
    global _client
    if _client is None:
        if not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError(f"OPENAI_API_KEY is not set. Paste it into {ENV_FILE} as OPENAI_API_KEY=sk-...")
        _client = OpenAI()
    return _client


def ask(
    prompt: str,
    system: str | None = None,
    model: str = DEFAULT_MODEL,
    temperature: float | None = None,
    log: bool = True,
) -> str:
    """Send a prompt to an OpenAI model and return its text answer.

    Args:
        prompt: The user prompt.
        system: Optional system instructions (role, output format, ...).
        model: Model name, e.g. "gpt-5-mini" or "gpt-4.1". Defaults to $OPENAI_MODEL.
        temperature: Sampling temperature. Leave as None for reasoning models
            (e.g. the gpt-5 family), which do not accept it.
        log: Append the call (prompt, settings, answer, tokens, cost, timing) to logs/openai_calls.jsonl.

    Returns:
        The model's answer as a string.
    """
    return _call(prompt, system, model, temperature, None, log)[0]


def ask_with_reasoning(
    prompt: str,
    system: str | None = None,
    model: str = DEFAULT_MODEL,
    summary: str = "auto",
    log: bool = True,
) -> tuple[str, str]:
    """Like ask(), but also return a summary of the model's reasoning.

    OpenAI does not expose the raw chain of thought; reasoning models can instead
    return a summary of it. Only works with reasoning models (gpt-5 family, o3, o4-mini).

    Args:
        summary: "auto", "concise" or "detailed".

    Returns:
        (answer, reasoning_summary). The summary is "" if the model returned none.
    """
    return _call(prompt, system, model, None, summary, log)


def _call(prompt, system, model, temperature, summary, log) -> tuple[str, str]:
    params = {"model": model, "input": prompt}
    if system:
        params["instructions"] = system
    if temperature is not None:
        params["temperature"] = temperature
    if summary:
        params["reasoning"] = {"summary": summary}

    start = time.perf_counter()
    response = get_client().responses.create(**params)
    answer = response.output_text
    reasoning = "\n\n".join(
        part.text
        for item in response.output
        if getattr(item, "type", None) == "reasoning"
        for part in (getattr(item, "summary", None) or [])
    )

    if log:
        _log_call(params, response, answer, reasoning, time.perf_counter() - start)
    return answer, reasoning


def price_for(model: str) -> tuple[float, float, float] | None:
    """Look up prices by the longest matching name, so "gpt-5-mini-2025-08-07" → "gpt-5-mini"."""
    matches = [name for name in PRICES if model == name or model.startswith(name + "-")]
    return PRICES[max(matches, key=len)] if matches else None


def call_cost(model: str, input_tokens: int, cached_tokens: int, output_tokens: int) -> float | None:
    """Cost of one call in USD, or None if the model is not in PRICES."""
    price = price_for(model)
    if price is None:
        return None
    p_in, p_cached, p_out = price
    return ((input_tokens - cached_tokens) * p_in + cached_tokens * p_cached + output_tokens * p_out) / 1_000_000


def total_cost(log_file: Path | None = None) -> float:
    """Sum of cost_usd over every call in the log."""
    log_file = log_file or LOG_FILE
    if not log_file.exists():
        return 0.0
    total = 0.0
    for line in log_file.read_text(encoding="utf-8").splitlines():
        if line.strip():
            total += json.loads(line).get("cost_usd") or 0.0
    return total


def _log_call(params: dict, response, answer: str, reasoning: str, seconds: float) -> None:
    """Write one JSON line per call so every prior can be traced back to its prompt."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    usage = getattr(response, "usage", None)
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    cached_tokens = getattr(getattr(usage, "input_tokens_details", None), "cached_tokens", 0) or 0
    reasoning_tokens = getattr(getattr(usage, "output_tokens_details", None), "reasoning_tokens", 0) or 0
    model = getattr(response, "model", None) or params["model"]
    cost = call_cost(model, input_tokens, cached_tokens, output_tokens)
    if cost is None:
        print(f"[openai_client] No price for model '{model}'; add it to PRICES to track cost.", file=sys.stderr)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_requested": params["model"],
        "model_returned": getattr(response, "model", None),  # exact snapshot used
        "response_id": getattr(response, "id", None),
        "temperature": params.get("temperature"),
        "system": params.get("instructions"),
        "prompt": params["input"],
        "answer": answer,
        "reasoning_summary": reasoning or None,
        "input_tokens": input_tokens,
        "cached_input_tokens": cached_tokens,
        "output_tokens": output_tokens,
        "reasoning_tokens": reasoning_tokens,
        "cost_usd": round(cost, 6) if cost is not None else None,
        "total_cost_usd": round(total_cost() + (cost or 0.0), 6),
        "seconds": round(seconds, 2),
    }
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    question = " ".join(sys.argv[1:]) or "In one sentence, what is a Bayesian prior distribution?"
    print(ask(question, system="You are a concise biostatistics assistant."))
    print(f"\n[total spent so far: ${total_cost():.4f}]")
