"""Minimal helper for calling the OpenAI API with a prompt.

Setup:
    pip install -r code/requirements.txt
    export OPENAI_API_KEY="sk-..."        # never commit your key

Usage from Python:
    from openai_client import ask
    print(ask("What is a prior distribution? Answer in one sentence."))

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

DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-mini")
LOG_FILE = Path(__file__).parent / "logs" / "openai_calls.jsonl"

_client = None


def get_client() -> OpenAI:
    """Create the OpenAI client once; it reads OPENAI_API_KEY from the environment."""
    global _client
    if _client is None:
        if not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is not set. Run: export OPENAI_API_KEY='sk-...'")
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
        log: Append the call (prompt, settings, answer, timing) to logs/openai_calls.jsonl.

    Returns:
        The model's answer as a string.
    """
    params = {"model": model, "input": prompt}
    if system:
        params["instructions"] = system
    if temperature is not None:
        params["temperature"] = temperature

    start = time.perf_counter()
    response = get_client().responses.create(**params)
    answer = response.output_text

    if log:
        _log_call(params, response, answer, time.perf_counter() - start)
    return answer


def _log_call(params: dict, response, answer: str, seconds: float) -> None:
    """Write one JSON line per call so every prior can be traced back to its prompt."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    usage = getattr(response, "usage", None)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_requested": params["model"],
        "model_returned": getattr(response, "model", None),  # exact snapshot used
        "response_id": getattr(response, "id", None),
        "temperature": params.get("temperature"),
        "system": params.get("instructions"),
        "prompt": params["input"],
        "answer": answer,
        "input_tokens": getattr(usage, "input_tokens", None),
        "output_tokens": getattr(usage, "output_tokens", None),
        "seconds": round(seconds, 2),
    }
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    question = " ".join(sys.argv[1:]) or "In one sentence, what is a Bayesian prior distribution?"
    print(ask(question, system="You are a concise biostatistics assistant."))
