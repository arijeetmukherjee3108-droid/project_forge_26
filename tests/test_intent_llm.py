"""
tests/test_intent_llm.py
========================
Unit tests for the LLM-fallback intent classifier.

All Groq API calls are mocked — no real key required.
Run with:
    cd project_forge_26
    python -m pytest tests/test_intent_llm.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# ── path setup ──────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
for p in (str(BACKEND_DIR), str(PROJECT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

# ── imports under test ───────────────────────────────────────────────────────
from app.eligibility import classify_citizen_intent, _llm_classify_intent  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_chat_json(return_value: dict):
    """Return a mock that patches app.eligibility._llm_classify_intent's chat_json."""
    return patch("app.llm_client.chat_json", return_value=return_value)


def _patch_chat(return_value: dict):
    """Patch chat_json inside the eligibility module's lazy import."""
    return patch("app.llm_client.chat_json", return_value=return_value)


# ---------------------------------------------------------------------------
# Test 1: Keyword match succeeds → LLM NOT called
# ---------------------------------------------------------------------------

def test_keyword_match_no_llm_call():
    """'scholarship' hits the vidyalakshmi keyword map; LLM must not be called."""
    with patch("app.llm_client.chat_json") as mock_llm:
        result = classify_citizen_intent("I need a scholarship for my studies")
    mock_llm.assert_not_called()
    assert result.matched_service_id == "vidyalakshmi"
    assert result.confidence >= 0.78


# ---------------------------------------------------------------------------
# Test 2: Keyword fails → LLM returns valid Hinglish result
# ---------------------------------------------------------------------------

def test_llm_fallback_hinglish_college_query():
    """Fully ambiguous Hinglish query (0 keyword hits) → LLM fallback returns vidyalakshmi."""
    # This query contains NONE of the registered keywords (no 'college', 'scholarship', etc.)
    # so best_score will be 0 and the LLM fallback will fire.
    llm_response = {
        "matched_service_id": "vidyalakshmi",
        "confidence": 0.96,
        "explanation": "Citizen is seeking financial assistance for higher education.",
        "suggested_documents": ["marksheet", "income_certificate", "aadhaar"],
    }
    with patch("app.llm_client.chat_json", return_value=llm_response):
        result = classify_citizen_intent(
            "bhaiya aage padhna chahta hoon magar paisa nahi hai kuch madad milegi kya"
        )
    assert result.matched_service_id == "vidyalakshmi"
    assert abs(result.confidence - 0.96) < 0.01
    assert "marksheet" in result.suggested_documents


# ---------------------------------------------------------------------------
# Test 3: LLM returns invalid service ID → deterministic fallback used
# ---------------------------------------------------------------------------

def test_llm_invalid_service_id_falls_back():
    """LLM returns an unknown service ID → validation rejects it → deterministic default."""
    llm_response = {
        "matched_service_id": "pm_awas",   # not a real service ID
        "confidence": 0.88,
        "explanation": "Housing scheme.",
        "suggested_documents": ["aadhaar"],
    }
    with patch("app.llm_client.chat_json", return_value=llm_response):
        result = classify_citizen_intent(
            "mujhe ghar chahiye sarkari yojana se"
        )
    # Validation fails → deterministic fallback (1784 default), no crash
    assert result.matched_service_id == "1784"


# ---------------------------------------------------------------------------
# Test 4: LLM returns malformed JSON / raises exception → no crash
# ---------------------------------------------------------------------------

def test_llm_exception_no_crash():
    """LLM raises an exception → graceful fallback, no crash."""
    with patch("app.llm_client.chat_json", side_effect=RuntimeError("network timeout")):
        result = classify_citizen_intent("koi bhi sarkari kaam karwana hai")
    assert result is not None
    assert result.matched_service_id in {"1784", "vidyalakshmi", "pm_kisan", "ration_card", "citizen_registration"}


def test_llm_malformed_json_no_crash():
    """LLM returns empty dict (malformed parse) → graceful fallback."""
    with patch("app.llm_client.chat_json", return_value={}):
        result = classify_citizen_intent("kuch samajh nahi aa raha")
    assert result is not None
    assert result.matched_service_id == "1784"  # deterministic default


# ---------------------------------------------------------------------------
# Test 5: GROQ_API_KEY missing → no crash, fallback used
# ---------------------------------------------------------------------------

def test_missing_api_key_no_crash(monkeypatch):
    """GROQ_API_KEY env var missing → llm_client returns {} → deterministic fallback."""
    monkeypatch.setenv("GROQ_API_KEY", "")
    # Re-import to pick up the empty key in llm_client
    import importlib, app.llm_client as lc
    importlib.reload(lc)

    with patch.object(lc, "_API_KEY", ""):
        result = classify_citizen_intent(
            "mujhe kisi bhi sarkari yojana ki jankari chahiye"
        )
    assert result is not None
    assert result.matched_service_id == "1784"   # deterministic default


# ---------------------------------------------------------------------------
# Test 6: Primary model fails → fallback model succeeds
# ---------------------------------------------------------------------------

def test_primary_fails_fallback_succeeds():
    """First Groq model call raises → second (fallback) call returns valid result."""
    import app.llm_client as lc

    good_response = {
        "matched_service_id": "pm_kisan",
        "confidence": 0.91,
        "explanation": "Farmer looking for income support.",
        "suggested_documents": ["land_record", "aadhaar"],
    }

    call_count = {"n": 0}

    def side_effect(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise ConnectionError("rate limited")
        return good_response

    # Patch both _API_KEY (so the key-check passes) and _call_model
    with patch.object(lc, "_API_KEY", "fake-key"), \
         patch.object(lc, "_call_model", side_effect=side_effect):
        result = classify_citizen_intent(
            "mera khet chhota hai par koi madad nahi milti"
        )

    assert result.matched_service_id == "pm_kisan"
    assert call_count["n"] == 2   # primary tried + fallback used


# ---------------------------------------------------------------------------
# Test 7: Hindi / Hinglish queries for multiple schemes
# ---------------------------------------------------------------------------

def test_hindi_devanagari_farmer():
    """Pure Devanagari 'किसान' — should hit pm_kisan via keyword 'kisan' ... but
    Devanagari won't match ASCII keywords, so the LLM fallback is expected."""
    llm_response = {
        "matched_service_id": "pm_kisan",
        "confidence": 0.93,
        "explanation": "Farmer income support.",
        "suggested_documents": ["land_record", "aadhaar"],
    }
    with patch("app.llm_client.chat_json", return_value=llm_response):
        result = classify_citizen_intent("मुझे किसान सम्मान निधि के बारे में जानकारी चाहिए")
    assert result.matched_service_id == "pm_kisan"


def test_hinglish_ration_card():
    """Hinglish ration card query — should match via keyword 'rashan'."""
    result = classify_citizen_intent("mujhe rashan card banana hai ghar ke liye")
    assert result.matched_service_id == "ration_card"
    # Keyword matched → LLM should NOT be consulted (no mock needed)


def test_hinglish_labour_certificate():
    """'majdur' hits the 1784 keyword map directly."""
    result = classify_citizen_intent("main ek majdur hoon mujhe certificate chahiye")
    assert result.matched_service_id == "1784"


def test_devanagari_ration():
    """Pure Devanagari ration query → LLM fallback."""
    llm_response = {
        "matched_service_id": "ration_card",
        "confidence": 0.95,
        "explanation": "Food security scheme.",
        "suggested_documents": ["income_certificate", "aadhaar"],
    }
    with patch("app.llm_client.chat_json", return_value=llm_response):
        result = classify_citizen_intent("मुझे राशन कार्ड के लिए आवेदन करना है")
    assert result.matched_service_id == "ration_card"


# ---------------------------------------------------------------------------
# Test: confidence clamping (edge case)
# ---------------------------------------------------------------------------

def test_confidence_clamped():
    """LLM returns confidence > 1 → clamped to 1.0."""
    llm_response = {
        "matched_service_id": "vidyalakshmi",
        "confidence": 1.5,   # out of range
        "explanation": "Education loan.",
        "suggested_documents": [],
    }
    with patch("app.llm_client.chat_json", return_value=llm_response):
        result = classify_citizen_intent("mujhe padhai ke liye paisa chahiye")
    # 'padhai' is a keyword → LLM won't fire; but let's call _llm_classify_intent directly
    from app.eligibility import _llm_classify_intent
    with patch("app.llm_client.chat_json", return_value=llm_response):
        llm_res = _llm_classify_intent("mujhe padhai ke liye paisa chahiye")
    assert llm_res is not None
    assert llm_res.confidence <= 1.0
