"""
llm_client.py — Shared Groq LLM wrapper for the Voice-to-Legacy Brain layer.

Usage (any Brain module):
    from app.llm_client import chat_json
    result = chat_json(system_prompt="...", user_content="...")
    # result is a dict, or {} if the API is unavailable.

Rules:
- Calls GROQ_MODEL first; on any failure retries once with GROQ_FALLBACK_MODEL.
- Returns {} (never raises) if the key is missing or both models fail.
- Logs with the standard logging module only — no print(), no personal data.
- Text-only (Task 1). Vision keys are intentionally ignored here.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from dotenv import load_dotenv

# Load .env from backend/ (two levels up from this file: app/ → backend/)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config — read once at import time
# ---------------------------------------------------------------------------

_API_KEY: str = os.getenv("GROQ_API_KEY", "")
_PRIMARY_MODEL: str = os.getenv("GROQ_MODEL", "llama3-8b-8192")
_FALLBACK_MODEL: str = os.getenv("GROQ_FALLBACK_MODEL", "llama3-70b-8192")

# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------


def _call_model(client: Any, model: str, system_prompt: str, user_content: str) -> dict:
    """
    Make one Groq chat-completions call requesting JSON output.
    Returns the parsed dict, or raises on any error (caller handles).
    """
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        timeout=15,          # seconds; keeps the API call snappy
        max_tokens=512,
    )
    raw_text: str = response.choices[0].message.content or "{}"
    return json.loads(raw_text)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def chat_json(system_prompt: str, user_content: str) -> dict:
    """
    Send a chat request to Groq and return the parsed JSON response as a dict.

    Flow:
      1. If GROQ_API_KEY is missing → log warning, return {}.
      2. Try GROQ_MODEL.
      3. On any error, retry once with GROQ_FALLBACK_MODEL.
      4. If both fail → log warning, return {}.

    Never raises. Never logs personal data.
    """
    if not _API_KEY:
        logger.warning("GROQ_API_KEY missing; falling back to deterministic heuristics.")
        return {}

    try:
        from groq import Groq  # type: ignore  # imported lazily so missing SDK → {}
    except ImportError:
        logger.warning("groq package not installed; falling back to deterministic heuristics.")
        return {}

    client = Groq(api_key=_API_KEY)

    # --- Primary model attempt ---
    try:
        result = _call_model(client, _PRIMARY_MODEL, system_prompt, user_content)
        logger.info("LLM response received from primary model %s.", _PRIMARY_MODEL)
        return result
    except Exception as primary_exc:
        logger.warning(
            "Primary model %s failed (%s); retrying with fallback %s.",
            _PRIMARY_MODEL,
            primary_exc,
            _FALLBACK_MODEL,
        )

    # --- Fallback model attempt ---
    try:
        result = _call_model(client, _FALLBACK_MODEL, system_prompt, user_content)
        logger.info("LLM response received from fallback model %s.", _FALLBACK_MODEL)
        return result
    except Exception as fallback_exc:
        logger.warning(
            "Fallback model %s also failed (%s); returning empty dict.",
            _FALLBACK_MODEL,
            fallback_exc,
        )
        return {}
