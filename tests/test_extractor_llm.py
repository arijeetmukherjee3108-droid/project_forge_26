"""
tests/test_extractor_llm.py
===========================
Unit tests for the LLM extraction fallback (Task 2).

All Groq calls are mocked — no real key required.
Run with:
    cd project_forge_26
    python3 -m pytest tests/test_extractor_llm.py -v
"""

from __future__ import annotations

import io
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# ── path setup ──────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
for p in (str(BACKEND_DIR), str(PROJECT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

import pymupdf as fitz
from app.extractor import (
    extract_profile,
    _norm_dob, _norm_mobile, _norm_aadhaar, _norm_state, _norm_income,
    _norm_pincode, _norm_gender, _validate_and_normalize_llm_output,
    _merge_llm_into_result,
)
from app.schemas import CitizenProfile, ExtractResponse

# Patch target: functions are looked up via the module object inside extractor.py
_PATCH_CHAT = "app.llm_client.chat_json"
_PATCH_VISION = "app.llm_client.chat_json_vision"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_pdf(text: str) -> bytes:
    """Create a minimal in-memory PDF containing `text`."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 80), text)
    data = doc.tobytes()
    doc.close()
    return data


def _make_empty_pdf() -> bytes:
    """Create a PDF with no selectable text (blank page — simulates scanned)."""
    doc = fitz.open()
    doc.new_page()
    data = doc.tobytes()
    doc.close()
    return data


def _make_png_bytes() -> bytes:
    """Create a minimal white PNG image in memory."""
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (100, 100), color=(255, 255, 255)).save(buf, format="PNG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Test 1: Regex confident (≤ 3 uncertain) → LLM NOT called
# ---------------------------------------------------------------------------

def test_regex_confident_no_llm():
    """When regex leaves ≤ 3 uncertain fields, LLM must not be invoked."""
    text = (
        "GOVERNMENT OF RAJASTHAN\n"
        "INCOME CERTIFICATE\n\n"
        "Name: Ramesh Kumar Sharma\n"
        "Father Name: Suresh Sharma\n"
        "Date of Birth: 1999-05-15\n"
        "Mobile: 9876543210\n"
        "Aadhaar Number: 1234 5678 4321\n"
        "Annual Income: Rs. 140000\n"
        "District: Jaipur\n"
        "State: Rajasthan\n"
        "Pin Code: 302001\n"
        "Gender: Male\n"
        "Category: general\n"
        "Email: ramesh@example.com\n"
    )
    pdf_bytes = _make_pdf(text)
    with patch(_PATCH_CHAT) as mock_text, patch(_PATCH_VISION) as mock_vision:
        result = extract_profile(pdf_bytes, "cert.pdf")
    mock_text.assert_not_called()
    mock_vision.assert_not_called()
    assert result.extraction_source == "regex"
    assert result.llm_filled_fields == []


# ---------------------------------------------------------------------------
# Test 2: > 3 uncertain → text LLM called and fills missing fields
# ---------------------------------------------------------------------------

def test_text_llm_fills_missing_fields():
    """Thin text triggers LLM text path; missing fields are filled from LLM."""
    # Minimal text — many fields will be uncertain; 'state' keyword so regex finds it
    text = "INCOME CERTIFICATE\nState: Rajasthan\nAnnual Income: Rs. 50000\n"
    pdf_bytes = _make_pdf(text)

    llm_response = {
        "full_name": "Priya Devi",
        "father_or_guardian_name": "Ram Devi",
        "date_of_birth": "15/08/1990",
        "gender": "female",
        "mobile_number": "+91 98765 43210",
        "email": "priya@gov.in",
        "aadhaar_last4": "4321",
        "annual_income": 120000,
        "state": "Rajasthan",
        "district": "Jaipur",
        "pincode": "302001",
        "category": "general",
    }

    with patch(_PATCH_CHAT, return_value=llm_response), \
         patch(_PATCH_VISION, return_value={}):
        result = extract_profile(pdf_bytes, "cert.pdf")

    assert result.extraction_source in {"regex+llm_text", "regex+llm_vision"}
    assert len(result.llm_filled_fields) > 0
    assert result.profile.mobile_number == "9876543210"   # normalized
    assert result.profile.date_of_birth == "1990-08-15"   # ISO converted


# ---------------------------------------------------------------------------
# Test 3: Regex values NOT overwritten by LLM
# ---------------------------------------------------------------------------

def test_regex_values_not_overwritten():
    """LLM must not overwrite a field already extracted by regex."""
    text = (
        "INCOME CERTIFICATE\n"
        "Name: Real Name From Regex\n"
        "State: Rajasthan\n"
        "Annual Income: Rs. 80000\n"
    )
    pdf_bytes = _make_pdf(text)

    llm_response = {
        "full_name": "WRONG LLM NAME",
        "father_or_guardian_name": "Father Ji",
        "date_of_birth": "01/01/1985",
        "gender": "male",
        "mobile_number": "9123456789",
        "email": "x@y.com",
        "aadhaar_last4": "1234",
        "annual_income": 99999999,   # should NOT win
        "state": "Rajasthan",
        "district": "Jaipur",
        "pincode": "302001",
        "category": "general",
    }

    with patch(_PATCH_CHAT, return_value=llm_response), \
         patch(_PATCH_VISION, return_value={}):
        result = extract_profile(pdf_bytes, "cert.pdf")

    # Regex-extracted name must win
    assert result.profile.full_name == "Real Name From Regex"
    # Regex-extracted income must win
    assert result.profile.annual_income == 80000
    # LLM can fill what regex missed
    assert result.profile.mobile_number == "9123456789"


# ---------------------------------------------------------------------------
# Test 4: Text path returns {} → vision path also runs
# ---------------------------------------------------------------------------

def test_vision_runs_when_text_leaves_gaps():
    """If text LLM returns {}, vision path should be attempted."""
    text = "INCOME CERTIFICATE"   # near-empty → many uncertain fields
    pdf_bytes = _make_pdf(text)

    vision_response = {
        "full_name": "Suresh Kumar",
        "father_or_guardian_name": None,
        "date_of_birth": "1985-03-20",
        "gender": "male",
        "mobile_number": "9000000001",
        "email": None,
        "aadhaar_last4": "5678",
        "annual_income": 75000,
        "state": "Bihar",
        "district": "Patna",
        "pincode": "800001",
        "category": "obc",
    }

    with patch(_PATCH_CHAT, return_value={}), \
         patch(_PATCH_VISION, return_value=vision_response):
        result = extract_profile(pdf_bytes, "cert.pdf")

    assert result.extraction_source == "regex+llm_vision"
    assert result.profile.full_name == "Suresh Kumar"
    assert result.profile.state == "Bihar"


# ---------------------------------------------------------------------------
# Test 5: Image upload → goes straight to vision path
# ---------------------------------------------------------------------------

def test_image_upload_uses_vision_path():
    """PNG upload always uses vision path (text path never called for images)."""
    png_bytes = _make_png_bytes()

    vision_response = {
        "full_name": "Anita Singh",
        "father_or_guardian_name": "Ramesh Singh",
        "date_of_birth": "1992-07-04",
        "gender": "female",
        "mobile_number": "9876512345",
        "email": None,
        "aadhaar_last4": "9999",
        "annual_income": 60000,
        "state": "Uttar Pradesh",
        "district": "Lucknow",
        "pincode": "226001",
        "category": "sc",
    }

    with patch(_PATCH_CHAT, return_value={}) as mock_text, \
         patch(_PATCH_VISION, return_value=vision_response):
        result = extract_profile(png_bytes, "id_card.png")

    # Text LLM must NOT be called for images
    mock_text.assert_not_called()
    assert result.extraction_source == "regex+llm_vision"
    assert result.profile.state == "Uttar Pradesh"


# ---------------------------------------------------------------------------
# Test 6: Normalization correctness
# ---------------------------------------------------------------------------

def test_norm_dob_dd_mm_yyyy():
    assert _norm_dob("15/08/1990") == "1990-08-15"

def test_norm_dob_future_rejected():
    assert _norm_dob("01/01/2099") is None

def test_norm_mobile_with_country_code():
    assert _norm_mobile("+91 98765 43210") == "9876543210"

def test_norm_mobile_with_91_prefix():
    assert _norm_mobile("919876543210") == "9876543210"

def test_norm_aadhaar_full_12_digit():
    """Full 12-digit Aadhaar → only last 4 kept."""
    assert _norm_aadhaar("123456784321") == "4321"

def test_norm_aadhaar_already_4():
    assert _norm_aadhaar("4321") == "4321"

def test_norm_state_lowercase():
    assert _norm_state("rajasthan") == "Rajasthan"

def test_norm_state_uppercase():
    assert _norm_state("RAJASTHAN") == "Rajasthan"

def test_norm_income_with_rupee_symbol():
    assert _norm_income("₹1,20,000") == 120000

def test_norm_income_with_rs():
    assert _norm_income("Rs. 1,20,000") == 120000


# ---------------------------------------------------------------------------
# Test 7: Invalid values dropped to None without crashing the whole result
# ---------------------------------------------------------------------------

def test_invalid_pincode_becomes_none():
    assert _norm_pincode("0123456") is None
    assert _norm_pincode("12345") is None

def test_future_dob_becomes_none():
    assert _norm_dob("01/01/2099") is None

def test_validate_normalize_drops_invalid_fields():
    """Malformed LLM fields become None; valid fields are kept."""
    raw = {
        "full_name": "Ravi Kumar",
        "father_or_guardian_name": None,
        "date_of_birth": "01/01/2099",   # future — invalid
        "gender": "male",
        "mobile_number": "12345",          # too short — invalid
        "email": None,
        "aadhaar_last4": "4321",
        "annual_income": 50000,
        "state": "Rajasthan",
        "district": None,
        "pincode": "012345",              # starts with 0 — invalid
        "category": "obc",
    }
    result = _validate_and_normalize_llm_output(raw)
    assert result["full_name"] == "Ravi Kumar"
    assert result["date_of_birth"] is None
    assert result["mobile_number"] is None
    assert result["pincode"] is None
    assert result["state"] == "Rajasthan"
    assert result["annual_income"] == 50000


# ---------------------------------------------------------------------------
# Test 8: Exception or empty dict → original regex result returned unchanged
# ---------------------------------------------------------------------------

def test_llm_exception_returns_original():
    """LLM raises exception → original regex result returned unchanged."""
    text = "INCOME CERTIFICATE\nName: Test Person\n"
    pdf_bytes = _make_pdf(text)

    with patch(_PATCH_CHAT, side_effect=RuntimeError("network error")), \
         patch(_PATCH_VISION, side_effect=RuntimeError("network error")):
        result = extract_profile(pdf_bytes, "cert.pdf")

    assert result is not None
    assert result.extraction_source == "regex"
    assert result.llm_filled_fields == []


def test_llm_returns_empty_dict():
    """LLM returns {} → original regex result unchanged."""
    text = "INCOME CERTIFICATE\nName: Test Person\n"
    pdf_bytes = _make_pdf(text)

    with patch(_PATCH_CHAT, return_value={}), patch(_PATCH_VISION, return_value={}):
        result = extract_profile(pdf_bytes, "cert.pdf")

    assert result.extraction_source == "regex"


# ---------------------------------------------------------------------------
# Test 9: GROQ_API_KEY missing → no crash, regex result returned
# ---------------------------------------------------------------------------

def test_missing_api_key_returns_regex_result(monkeypatch):
    """No API key → llm_client returns {} → regex result unchanged."""
    import app.llm_client as lc
    import importlib

    monkeypatch.setenv("GROQ_API_KEY", "")
    importlib.reload(lc)

    text = "INCOME CERTIFICATE\nName: Test Person\n"
    pdf_bytes = _make_pdf(text)

    with patch.object(lc, "_API_KEY", ""):
        result = extract_profile(pdf_bytes, "cert.pdf")

    assert result is not None
    assert result.extraction_source == "regex"


# ---------------------------------------------------------------------------
# Test 10: Primary model fails → fallback model succeeds (text + vision)
# ---------------------------------------------------------------------------

def test_text_primary_fails_fallback_succeeds():
    """Text primary model raises → fallback model returns valid result."""
    import app.llm_client as lc

    good_response = {
        "full_name": "Fallback Name",
        "father_or_guardian_name": None,
        "date_of_birth": "1990-01-01",
        "gender": "male",
        "mobile_number": "9000012345",
        "email": None,
        "aadhaar_last4": "1111",
        "annual_income": 50000,
        "state": "Gujarat",
        "district": "Ahmedabad",
        "pincode": "380001",
        "category": "general",
    }

    call_count = {"n": 0}

    def side_effect(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise ConnectionError("rate limited")
        return good_response

    text = "INCOME CERTIFICATE\nState: Rajasthan\n"
    pdf_bytes = _make_pdf(text)

    with patch.object(lc, "_API_KEY", "fake-key"), \
         patch.object(lc, "_call_model", side_effect=side_effect), \
         patch(_PATCH_VISION, return_value={}):
        result = extract_profile(pdf_bytes, "cert.pdf")

    assert call_count["n"] == 2   # primary tried + fallback used
    # 'state' was extracted by regex (Rajasthan) — LLM must NOT overwrite it
    assert result.profile.state == "Rajasthan"
    # mobile_number was uncertain → LLM should have filled it from good_response
    assert result.profile.mobile_number == "9000012345"
    assert result.extraction_source == "regex+llm_text"


def test_vision_primary_fails_fallback_succeeds():
    """Vision primary model raises → fallback model returns valid result."""
    import app.llm_client as lc

    good_response = {
        "full_name": "Vision Fallback",
        "father_or_guardian_name": None,
        "date_of_birth": "1988-06-15",
        "gender": "female",
        "mobile_number": "8888800001",
        "email": None,
        "aadhaar_last4": "2222",
        "annual_income": 45000,
        "state": "Kerala",
        "district": "Kochi",
        "pincode": "682001",
        "category": "general",
    }

    call_count = {"n": 0}

    def side_effect(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise ConnectionError("rate limited")
        return good_response

    png_bytes = _make_png_bytes()

    with patch(_PATCH_CHAT, return_value={}), \
         patch.object(lc, "_API_KEY", "fake-key"), \
         patch.object(lc, "_call_model_vision", side_effect=side_effect):
        result = extract_profile(png_bytes, "scan.png")

    assert call_count["n"] == 2
    assert result.profile.state == "Kerala"


# ---------------------------------------------------------------------------
# Test 11: extraction_source and llm_filled_fields set correctly
# ---------------------------------------------------------------------------

def test_provenance_fields_set_correctly():
    """extraction_source and llm_filled_fields reflect what actually happened."""
    text = "INCOME CERTIFICATE\nState: Rajasthan\n"
    pdf_bytes = _make_pdf(text)

    llm_response = {
        "full_name": None,           # LLM couldn't find name
        "father_or_guardian_name": "Hari Das",
        "date_of_birth": "1985-04-10",
        "gender": "female",
        "mobile_number": "7777711111",
        "email": None,
        "aadhaar_last4": "3333",
        "annual_income": 90000,
        "state": "Punjab",
        "district": "Amritsar",
        "pincode": "143001",
        "category": "general",
    }

    with patch(_PATCH_CHAT, return_value=llm_response), \
         patch(_PATCH_VISION, return_value={}):
        result = extract_profile(pdf_bytes, "cert.pdf")

    assert result.extraction_source == "regex+llm_text"
    # full_name was None from LLM → not in filled list
    assert "full_name" not in result.llm_filled_fields
    # mobile_number was uncertain → should be filled
    assert "mobile_number" in result.llm_filled_fields
