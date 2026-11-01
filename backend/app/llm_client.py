"""
llm_client.py — Shared Groq LLM wrapper for the Voice-to-Legacy Brain layer.

Usage (any Brain module):
    from app.llm_client import chat_json, chat_json_vision
    result = chat_json(system_prompt="...", user_content="...")
    result = chat_json_vision(system_prompt="...", user_text="...", images=[b"..."])
    # Both return a dict, or {} if the API is unavailable.

Rules:
- Calls primary model first; on any failure retries once with fallback model.
- Returns {} (never raises) if the key is missing or both models fail.
- Logs with the standard logging module only — no print(), no personal data.
- Text path: GROQ_MODEL / GROQ_FALLBACK_MODEL.
- Vision path: GROQ_VISION_MODEL / GROQ_VISION_FALLBACK_MODEL.
"""

from __future__ import annotations

import base64
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
_VISION_MODEL: str = os.getenv("GROQ_VISION_MODEL", "llava-v1.5-7b-4096-preview")
_VISION_FALLBACK_MODEL: str = os.getenv("GROQ_VISION_FALLBACK_MODEL", "llava-v1.5-13b-4096-preview")

# ---------------------------------------------------------------------------
# Internal helpers
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
        timeout=15,
        max_tokens=512,
    )
    raw_text: str = response.choices[0].message.content or "{}"
    return json.loads(raw_text)


def _call_model_vision(
    client: Any,
    model: str,
    system_prompt: str,
    user_text: str,
    images: list[bytes],
) -> dict:
    """
    Make one Groq vision chat-completions call.
    Images are sent as base64 data URLs in the OpenAI image_url content format.
    Returns the parsed dict, or raises on any error (caller handles).

    Groq vision: cap at 3 images per request to stay within limits.
    """
    content: list[dict] = [{"type": "text", "text": user_text}]
    for img_bytes in images[:3]:
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}"},
        })

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        timeout=30,
        max_tokens=512,
    )
    raw_text: str = response.choices[0].message.content or "{}"
    return json.loads(raw_text)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def chat_json(system_prompt: str, user_content: str) -> dict:
    """
    Send a text chat request to Groq and return the parsed JSON response as a dict.

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
        from groq import Groq  # type: ignore
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


def chat_json_vision(
    system_prompt: str,
    user_text: str,
    images: list[bytes],
) -> dict:
    """
    Send a vision chat request to Groq with page images and return parsed JSON.

    Flow:
      1. If GROQ_API_KEY is missing → log warning, return {}.
      2. Try GROQ_VISION_MODEL.
      3. On any error, retry once with GROQ_VISION_FALLBACK_MODEL.
      4. If both fail → log warning, return {}.

    `images` must be a list of PNG bytes (max 3 pages enforced internally).
    Never raises. Never logs personal data or full image bytes.
    """
    if not _API_KEY:
        logger.warning("GROQ_API_KEY missing; vision fallback unavailable.")
        return {}

    if not images:
        logger.warning("chat_json_vision called with no images; returning {}.")
        return {}

    try:
        from groq import Groq  # type: ignore
    except ImportError:
        logger.warning("groq package not installed; vision fallback unavailable.")
        return {}

    client = Groq(api_key=_API_KEY)

    # --- Primary vision model attempt ---
    try:
        result = _call_model_vision(client, _VISION_MODEL, system_prompt, user_text, images)
        logger.info(
            "Vision LLM response from primary model %s (%d image(s)).",
            _VISION_MODEL,
            len(images[:3]),
        )
        return result
    except Exception as primary_exc:
        logger.warning(
            "Vision primary model %s failed (%s); retrying with %s.",
            _VISION_MODEL,
            primary_exc,
            _VISION_FALLBACK_MODEL,
        )

    # --- Fallback vision model attempt ---
    try:
        result = _call_model_vision(
            client, _VISION_FALLBACK_MODEL, system_prompt, user_text, images
        )
        logger.info("Vision LLM response from fallback model %s.", _VISION_FALLBACK_MODEL)
        return result
    except Exception as fallback_exc:
        logger.warning(
            "Vision fallback model %s also failed (%s); returning empty dict.",
            _VISION_FALLBACK_MODEL,
            fallback_exc,
        )
        return {}
