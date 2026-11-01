"""
extractor.py — Document-to-CitizenProfile extraction pipeline.

Accepts PDF / PNG / JPG / JPEG uploads (≤ 10 MB).
  1. PDFs: extracts text page-by-page with PyMuPDF (fitz).
  2. Scanned PDFs / images: falls back to pytesseract OCR.
     If Tesseract is not installed, returns a safe empty profile instead of crashing.
  3. Regex + keyword matching maps raw text → CitizenProfile fields.
  4. Aadhaar safety: only the last 4 digits are ever stored (matches schemas.py validator).
  5. raw_text_preview is masked so no 12-digit number leaks.

Public API: extract_profile(file_bytes, filename) -> ExtractResponse
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

import pymupdf as fitz  # PyMuPDF (pymupdf alias removes FutureWarning)

try:
    from app.schemas import Category, CitizenProfile, ExtractResponse, Gender
except ImportError:
    from backend.app.schemas import Category, CitizenProfile, ExtractResponse, Gender

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}

# Minimum text characters in a PDF page before we treat it as scanned
MIN_TEXT_CHARS_PER_PAGE = 30

# ---------------------------------------------------------------------------
# Regex patterns — keep these small and named so the team can tune them.
# Each pattern is tried in order; the first non-empty match wins.
# ---------------------------------------------------------------------------

# Full name — line after keywords: name / naam / applicant name / citizen name
_RE_FULL_NAME = re.compile(
    r"(?:(?:full\s+)?name|naam|applicant\s+name|citizen\s+name)\s*[:\-]\s*([A-Za-z][A-Za-z\s\.]{2,58}?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)

# Father / guardian
_RE_FATHER = re.compile(
    r"(?:father(?:'?s)?\s+name|pita\s*(?:ka\s*)?naam|guardian\s+name|c\/o|s\/o|d\/o|w\/o)\s*[:\-]\s*([A-Za-z][A-Za-z\s\.]{2,58}?)(?:,|$)",
    re.IGNORECASE | re.MULTILINE,
)

# Date of birth — multiple raw formats; normalised later
_RE_DOB_PATTERNS = [
    # DD/MM/YYYY or DD-MM-YYYY
    re.compile(
        r"(?:date\s+of\s+birth|d\.?o\.?b\.?|janm\s*tithi|birth\s+date)\s*[:\-]?\s*"
        r"(\d{2}[\/\-]\d{2}[\/\-]\d{4})",
        re.IGNORECASE,
    ),
    # "12 Jan 1990" / "12 January 1990"
    re.compile(
        r"(?:date\s+of\s+birth|d\.?o\.?b\.?|janm\s*tithi|birth\s+date)\s*[:\-]?\s*"
        r"(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
        r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|"
        r"Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})",
        re.IGNORECASE,
    ),
    # YYYY-MM-DD already in ISO
    re.compile(
        r"(?:date\s+of\s+birth|d\.?o\.?b\.?|janm\s*tithi|birth\s+date)\s*[:\-]?\s*"
        r"(\d{4}-\d{2}-\d{2})",
        re.IGNORECASE,
    ),
]

# Gender
_RE_GENDER = re.compile(
    r"(?:gender|sex|ling)\s*[:\-]\s*(male|female|other|पुरुष|महिला)",
    re.IGNORECASE,
)

# Mobile / phone
_RE_MOBILE = re.compile(
    r"(?:mobile|phone|mob\.?|contact\s+no\.?)\s*[:\-]?\s*(\+?91[-\s]?)?([6-9]\d{9})",
    re.IGNORECASE,
)

# Email
_RE_EMAIL = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
)

# Aadhaar — 12-digit number (we capture ALL to mask; store only last 4)
_RE_AADHAAR = re.compile(
    r"(?:aadhaar|aadhar|uid(?:ai)?)\s*(?:no\.?|number|#)?\s*[:\-]?\s*"
    r"(\d{4}[\s\-]?\d{4}[\s\-]?\d{4})",
    re.IGNORECASE,
)
# Standalone 12-digit (may be bare on ID card lines)
_RE_AADHAAR_BARE = re.compile(r"\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4})\b")

# Address
_RE_ADDRESS = re.compile(
    r"(?:address|pata|residence)\s*[:\-]\s*([^\n]{10,120})",
    re.IGNORECASE,
)

# Village / city
_RE_VILLAGE = re.compile(
    r"(?:village|city|town|gram|nagar|gaon)\s*[:\-]\s*([A-Za-z][A-Za-z\s]{2,48}?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)

# District
_RE_DISTRICT = re.compile(
    r"(?:district|zila|zilla)\s*[:\-]\s*([A-Za-z][A-Za-z\s]{2,48}?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)

# State
_RE_STATE = re.compile(
    r"(?:state|rajya|pradesh)\s*[:\-]\s*([A-Za-z][A-Za-z\s]{2,48}?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)

# PIN code — 6 digits after keyword or standalone
_RE_PINCODE = re.compile(
    r"(?:pin(?:\s*code)?|postal\s*code)\s*[:\-]?\s*(\d{6})\b",
    re.IGNORECASE,
)

# Occupation
_RE_OCCUPATION = re.compile(
    r"(?:occupation|profession|vyavsay|work)\s*[:\-]\s*([A-Za-z][A-Za-z\s]{2,58}?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)

# Annual income — handles commas, INR/Rs prefix/suffix, Indian lakh format
_RE_INCOME = re.compile(
    r"(?:annual\s+income|yearly\s+income|aay|income)\s*[:\-]?\s*"
    r"(?:Rs\.?|INR\.?)?\s*([\d,]+)",
    re.IGNORECASE,
)

# Category
_RE_CATEGORY = re.compile(
    r"(?:category|caste\s+category|varg)\s*[:\-]\s*(general|obc|sc|st|ews)",
    re.IGNORECASE,
)

# Document-type keywords to guess source_documents
_DOC_KEYWORDS: dict[str, str] = {
    "income certificate": "income_certificate",
    "income_certificate": "income_certificate",
    "aadhaar": "aadhaar",
    "aadhar": "aadhaar",
    "uid": "aadhaar",
    "caste certificate": "caste_certificate",
    "residence certificate": "residence_certificate",
    "domicile": "residence_certificate",
}

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

_MONTH_MAP = {
    "jan": 1, "january": 1, "feb": 2, "february": 2,
    "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}


def _normalise_dob(raw: str) -> Optional[str]:
    """Convert various date strings to YYYY-MM-DD; return None on failure."""
    raw = raw.strip()
    # Already ISO
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    # DD/MM/YYYY or DD-MM-YYYY
    m = re.fullmatch(r"(\d{2})[\/\-](\d{2})[\/\-](\d{4})", raw)
    if m:
        d, mo, y = m.group(1), m.group(2), m.group(3)
        return f"{y}-{mo}-{d}"
    # "12 Jan 1990" style
    m = re.fullmatch(
        r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", raw
    )
    if m:
        d_str, mon_str, y_str = m.group(1), m.group(2).lower(), m.group(3)
        mo_num = _MONTH_MAP.get(mon_str)
        if mo_num:
            return f"{y_str}-{mo_num:02d}-{int(d_str):02d}"
    return None


def _parse_income(raw: str) -> Optional[int]:
    """Strip commas and convert to int; return None if unparseable."""
    cleaned = raw.replace(",", "").strip()
    try:
        return int(cleaned)
    except ValueError:
        return None


def _mask_aadhaar(text: str) -> str:
    """Replace any 12-digit Aadhaar-like number with XXXX-XXXX-XXXX in text."""
    def _replace(m: re.Match) -> str:
        return "XXXX-XXXX-XXXX"
    return _RE_AADHAAR_BARE.sub(_replace, text)


def _extract_aadhaar_last4(text: str) -> Optional[str]:
    """Return only the last 4 digits of an Aadhaar found in text, or None."""
    for pattern in (_RE_AADHAAR, _RE_AADHAAR_BARE):
        m = pattern.search(text)
        if m:
            digits = re.sub(r"\D", "", m.group(1))
            if len(digits) == 12:
                return digits[-4:]
    return None


def _guess_source_documents(text: str) -> list[str]:
    """Heuristically identify document type from keyword presence."""
    text_lower = text.lower()
    found: list[str] = []
    for keyword, tag in _DOC_KEYWORDS.items():
        if keyword in text_lower and tag not in found:
            found.append(tag)
    return found or ["unknown"]


def _first_match(pattern: re.Pattern, text: str) -> Optional[str]:
    """Return stripped first capture group of pattern, or None."""
    m = pattern.search(text)
    return m.group(1).strip() if m else None


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

def _extract_text_from_pdf(file_bytes: bytes) -> tuple[str, bool]:
    """
    Return (full_text, used_ocr).
    If the PDF has very little selectable text, flag it for OCR.
    """
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages_text: list[str] = []
    low_text_pages = 0
    for page in doc:
        t = page.get_text()
        pages_text.append(t)
        if len(t.strip()) < MIN_TEXT_CHARS_PER_PAGE:
            low_text_pages += 1
    doc.close()
    full_text = "\n".join(pages_text)
    needs_ocr = low_text_pages >= max(1, len(pages_text))
    return full_text, needs_ocr


# Safely build the set of OCR exceptions we want to catch at call sites.
# If pytesseract is not installed at all, TesseractNotFoundError doesn't exist,
# so we fall back to a plain Exception subclass that will never be raised.
try:
    from pytesseract import TesseractNotFoundError as _TesseractNotFoundError  # type: ignore
except ImportError:
    class _TesseractNotFoundError(Exception):  # type: ignore
        pass

# Tuple used in all except clauses below.
_OCR_ERRORS = (ImportError, _TesseractNotFoundError, OSError)


def _ocr_image_bytes(image_bytes: bytes) -> str:
    """
    Run pytesseract on raw image bytes with phone-photo fixes applied.

    Improvements over the old version:
    - EXIF transpose: corrects phone rotation.
    - Grayscale + autocontrast: improves OCR on faded/bright photos.
    - Upscale to ≥ 1600 px wide: Tesseract accuracy degrades on small images.
    - lang="eng+hin" with automatic fallback to "eng" if Hindi data is missing.

    Raises _OCR_ERRORS on any library/binary problem (caller handles these).
    Nothing is written to disk.
    """
    import io
    import pytesseract  # type: ignore
    from PIL import Image, ImageOps  # type: ignore

    img = Image.open(io.BytesIO(image_bytes))

    # Fix EXIF rotation (phone photos are often rotated 90°/270°)
    img = ImageOps.exif_transpose(img)

    # Grayscale → better contrast for OCR
    img = img.convert("L")

    # Autocontrast: stretch histogram to use full 0-255 range
    img = ImageOps.autocontrast(img)

    # Upscale if narrower than 1600 px (keeps aspect ratio)
    if img.width < 1600:
        scale = 1600 / img.width
        img = img.resize(
            (1600, int(img.height * scale)),
            Image.LANCZOS,
        )

    # Try bilingual first; fall back to English-only if Hindi data is missing
    try:
        return pytesseract.image_to_string(img, lang="eng+hin")
    except _TesseractNotFoundError:
        raise  # binary missing — let caller handle
    except Exception:  # language data not installed
        return pytesseract.image_to_string(img, lang="eng")


def _ocr_pdf_bytes(file_bytes: bytes) -> str:
    """
    Render up to 5 pages of a scanned PDF to PNG (in memory) and OCR each.
    Uses the same improved _ocr_image_bytes helper as the image path.
    Raises _OCR_ERRORS on any library/binary problem (caller handles these).
    """
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    texts: list[str] = []
    for i, page in enumerate(doc):
        if i >= 5:  # cap at 5 pages to keep response times reasonable
            break
        # Render page to PNG bytes entirely in memory (dpi=200 balances quality/speed)
        png_bytes = page.get_pixmap(dpi=200).tobytes("png")
        texts.append(_ocr_image_bytes(png_bytes))
    doc.close()
    return "\n".join(texts)


# ---------------------------------------------------------------------------
# Field extraction
# ---------------------------------------------------------------------------

ALL_PROFILE_FIELDS = [
    "full_name", "father_or_guardian_name", "date_of_birth", "gender",
    "mobile_number", "email", "aadhaar_last4",
    "address_line", "village_or_city", "district", "state", "pincode",
    "occupation", "annual_income", "category",
]


def _extract_fields(text: str) -> tuple[dict, list[str]]:
    """
    Run all patterns against `text`.
    Returns (field_dict, uncertain_fields).
    Fields not found or with conflicts stay None and go into uncertain_fields.
    """
    fields: dict = {}
    uncertain: list[str] = []

    # ---- full_name
    v = _first_match(_RE_FULL_NAME, text)
    fields["full_name"] = v
    if not v:
        uncertain.append("full_name")

    # ---- father_or_guardian_name
    v = _first_match(_RE_FATHER, text)
    fields["father_or_guardian_name"] = v
    if not v:
        uncertain.append("father_or_guardian_name")

    # ---- date_of_birth (try each pattern in order)
    dob_raw = None
    for pat in _RE_DOB_PATTERNS:
        m = pat.search(text)
        if m:
            dob_raw = m.group(1)
            break
    dob_iso = _normalise_dob(dob_raw) if dob_raw else None
    fields["date_of_birth"] = dob_iso
    if not dob_iso:
        uncertain.append("date_of_birth")

    # ---- gender
    g_raw = _first_match(_RE_GENDER, text)
    if g_raw:
        g_lower = g_raw.lower()
        if g_lower in ("male", "पुरुष"):
            fields["gender"] = Gender.male
        elif g_lower in ("female", "महिला"):
            fields["gender"] = Gender.female
        else:
            fields["gender"] = Gender.other
    else:
        fields["gender"] = None
        uncertain.append("gender")

    # ---- mobile_number
    m = _RE_MOBILE.search(text)
    if m:
        # group(2) is the 10-digit number without country code
        mob = re.sub(r"\D", "", m.group(2))[-10:]
        fields["mobile_number"] = mob if len(mob) == 10 else None
    else:
        fields["mobile_number"] = None
    if not fields["mobile_number"]:
        uncertain.append("mobile_number")

    # ---- email
    m = _RE_EMAIL.search(text)
    fields["email"] = m.group(0) if m else None
    if not fields["email"]:
        uncertain.append("email")

    # ---- aadhaar_last4 (NEVER store full number — schemas.py validator enforces this)
    last4 = _extract_aadhaar_last4(text)
    fields["aadhaar_last4"] = last4
    if not last4:
        uncertain.append("aadhaar_last4")

    # ---- address_line
    v = _first_match(_RE_ADDRESS, text)
    fields["address_line"] = v
    if not v:
        uncertain.append("address_line")

    # ---- village_or_city
    v = _first_match(_RE_VILLAGE, text)
    fields["village_or_city"] = v.strip() if v else None
    if not fields["village_or_city"]:
        uncertain.append("village_or_city")

    # ---- district
    v = _first_match(_RE_DISTRICT, text)
    fields["district"] = v.strip() if v else None
    if not fields["district"]:
        uncertain.append("district")

    # ---- state
    v = _first_match(_RE_STATE, text)
    fields["state"] = v.strip() if v else None
    if not fields["state"]:
        uncertain.append("state")

    # ---- pincode
    v = _first_match(_RE_PINCODE, text)
    # validate 6 digits
    fields["pincode"] = v if (v and len(v) == 6 and v.isdigit()) else None
    if not fields["pincode"]:
        uncertain.append("pincode")

    # ---- occupation
    v = _first_match(_RE_OCCUPATION, text)
    fields["occupation"] = v
    if not v:
        uncertain.append("occupation")

    # ---- annual_income
    v = _first_match(_RE_INCOME, text)
    inc = _parse_income(v) if v else None
    fields["annual_income"] = inc
    if inc is None:
        uncertain.append("annual_income")

    # ---- category
    v = _first_match(_RE_CATEGORY, text)
    if v:
        try:
            fields["category"] = Category(v.lower())
        except ValueError:
            fields["category"] = None
            uncertain.append("category")
    else:
        fields["category"] = None
        uncertain.append("category")

    return fields, uncertain


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_profile(file_bytes: bytes, filename: str) -> ExtractResponse:
    """
    Parse `file_bytes` (PDF/PNG/JPG/JPEG, ≤ 10 MB) and return an ExtractResponse.

    - Rejects unsupported types with ValueError.
    - Rejects files over 10 MB with ValueError.
    - Never crashes on missing Tesseract; returns an empty profile instead.
    - Never stores or logs a full 12-digit Aadhaar number.
    """
    # ---- File size guard
    if len(file_bytes) > MAX_FILE_BYTES:
        raise ValueError(
            f"File too large: {len(file_bytes) / 1024 / 1024:.1f} MB "
            f"(limit is {MAX_FILE_BYTES // 1024 // 1024} MB)."
        )

    # ---- Extension guard
    ext = ("." + filename.rsplit(".", 1)[-1]).lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type '{ext}'. Accepted: PDF, PNG, JPG, JPEG."
        )

    raw_text = ""
    ocr_warning: Optional[str] = None

    # ---- Text extraction
    _INSTALL_HINT = (
        "Run: brew install tesseract tesseract-lang && pip install pytesseract pillow"
    )
    if ext == ".pdf":
        selectable_text, needs_ocr = _extract_text_from_pdf(file_bytes)
        if needs_ocr:
            try:
                raw_text = _ocr_pdf_bytes(file_bytes)
            except _OCR_ERRORS:
                ocr_warning = (
                    "OCR unavailable for this scanned PDF. "
                    "Tesseract must be installed on the server. "
                    + _INSTALL_HINT
                )
                raw_text = selectable_text  # use whatever selectable text exists
        else:
            raw_text = selectable_text
    else:
        # Image file — requires Tesseract
        try:
            raw_text = _ocr_image_bytes(file_bytes)
        except _OCR_ERRORS:
            ocr_warning = (
                "OCR unavailable. Tesseract must be installed to read image files. "
                + _INSTALL_HINT
            )

    # ---- If OCR totally unavailable, try LLM vision for images; else return empty
    if ocr_warning and not raw_text.strip():
        empty_profile = CitizenProfile(
            uncertain_fields=ALL_PROFILE_FIELDS,
            source_documents=[],
        )
        empty_result = ExtractResponse(
            profile=empty_profile,
            uncertain_fields=ALL_PROFILE_FIELDS,
            raw_text_preview=ocr_warning,
        )
        # For image files, the vision LLM can still read the document directly.
        if ext in {".jpg", ".jpeg", ".png"}:
            return _llm_extraction_fallback(
                result=empty_result,
                raw_text="",
                file_bytes=file_bytes,
                ext=ext,
                filename=filename,
            )
        return empty_result

    # ---- Field extraction
    fields, uncertain = _extract_fields(raw_text)

    # ---- Source document guessing
    source_docs = _guess_source_documents(raw_text)

    # ---- Build CitizenProfile (validators in schemas.py enforce safety)
    profile = CitizenProfile(
        **fields,
        source_documents=source_docs,
        uncertain_fields=uncertain,
        verified_by_user=False,
    )

    # ---- raw_text_preview: first 300 chars, Aadhaar masked
    masked_preview = _mask_aadhaar(raw_text[:300])
    if ocr_warning:
        masked_preview = f"[Warning: {ocr_warning}]\\n\\n{masked_preview}"

    result = ExtractResponse(
        profile=profile,
        uncertain_fields=uncertain,
        raw_text_preview=masked_preview,
    )

    # ---- LLM fallback: when regex missed key fields (full_name, dob) or left >3 uncertain fields ----
    if not result.profile.full_name or not result.profile.date_of_birth or len(uncertain) > 3:
        result = _llm_extraction_fallback(
            result=result,
            raw_text=raw_text,
            file_bytes=file_bytes,
            ext=ext,
            filename=filename,
        )

    return result


# ===========================================================================
# LLM Extraction Fallback — Brain layer only.
# Must NOT be called unless uncertain_fields > 3.
# Never overwrites regex-extracted values.
# Never crashes — returns the original result unchanged on any error.
# ===========================================================================

import re as _re                  # already imported at top; alias for clarity below
from datetime import date as _date
from typing import Optional as _Optional

from pydantic import BaseModel as _BaseModel


# ---------------------------------------------------------------------------
# Indian states/UTs canonical list for normalization
# ---------------------------------------------------------------------------

_INDIAN_STATES: dict[str, str] = {
    s.lower(): s for s in [
        "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
        "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
        "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
        "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
        "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
        "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
        "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
    ]
}

# ---------------------------------------------------------------------------
# Extraction Pydantic model (internal to extractor — not in schemas.py)
# ---------------------------------------------------------------------------


class ExtractedProfileLLM(_BaseModel):
    """Raw LLM output validator for document extraction. Every field defaults to None."""

    full_name: _Optional[str] = None
    father_or_guardian_name: _Optional[str] = None
    date_of_birth: _Optional[str] = None
    gender: _Optional[str] = None
    mobile_number: _Optional[str] = None
    email: _Optional[str] = None
    aadhaar_last4: _Optional[str] = None
    annual_income: _Optional[int] = None
    address_line: _Optional[str] = None
    village_or_city: _Optional[str] = None
    state: _Optional[str] = None
    district: _Optional[str] = None
    pincode: _Optional[str] = None
    category: _Optional[str] = None


# ---------------------------------------------------------------------------
# Field normalizers — each returns None on invalid input
# ---------------------------------------------------------------------------

def _norm_address(v: _Optional[str]) -> _Optional[str]:
    if not v:
        return None
    s = str(v).strip()
    s = _re.sub(r"^(?:address|pata|पता)\s*[:\-]\s*", "", s, flags=_re.IGNORECASE).strip()
    return s if len(s) >= 4 else None

def _norm_dob(v: _Optional[str]) -> _Optional[str]:
    """Parse and normalize DOB to YYYY-MM-DD. Reject future dates."""
    if not v:
        return None
    v = str(v).strip()
    # Already ISO
    if _re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        iso = v
    else:
        # DD/MM/YYYY or DD-MM-YYYY
        m = _re.fullmatch(r"(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})", v)
        if m:
            d, mo, y = m.group(1), m.group(2), m.group(3)
            iso = f"{y}-{int(mo):02d}-{int(d):02d}"
        else:
            return None
    try:
        parsed = _date.fromisoformat(iso)
    except ValueError:
        return None
    if parsed > _date.today():   # reject future dates
        return None
    return iso


def _norm_gender(v: _Optional[str]) -> _Optional[str]:
    """Normalize gender to male/female/other."""
    if not v:
        return None
    mapping = {
        "male": "male", "m": "male", "पुरुष": "male",
        "female": "female", "f": "female", "महिला": "female",
        "other": "other", "o": "other",
    }
    return mapping.get(str(v).strip().lower())


def _norm_mobile(v: _Optional[str]) -> _Optional[str]:
    """Strip country code/spaces; return 10-digit number starting 6-9 or None."""
    if not v:
        return None
    digits = _re.sub(r"\D", "", str(v))
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if len(digits) == 10 and digits[0] in "6789":
        return digits
    return None


def _norm_email(v: _Optional[str]) -> _Optional[str]:
    if not v:
        return None
    s = str(v).strip()
    return s if _re.fullmatch(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", s) else None


def _norm_aadhaar(v: _Optional[str]) -> _Optional[str]:
    """Keep only last 4 digits; reject if not exactly 4 digits after stripping."""
    if not v:
        return None
    digits = _re.sub(r"\D", "", str(v))
    if len(digits) >= 4:
        last4 = digits[-4:]
        return last4 if last4.isdigit() else None
    return None


def _norm_income(v) -> _Optional[int]:
    if v is None:
        return None
    cleaned = _re.sub(r"[^\d]", "", str(v))
    try:
        val = int(cleaned)
        return val if val >= 0 else None
    except ValueError:
        return None


def _norm_state(v: _Optional[str]) -> _Optional[str]:
    if not v:
        return None
    return _INDIAN_STATES.get(str(v).strip().lower())


def _norm_district(v: _Optional[str]) -> _Optional[str]:
    if not v:
        return None
    return str(v).strip().title() or None


def _norm_pincode(v: _Optional[str]) -> _Optional[str]:
    if not v:
        return None
    s = _re.sub(r"\D", "", str(v))
    return s if (len(s) == 6 and s[0] != "0") else None


def _norm_category(v: _Optional[str]) -> _Optional[str]:
    if not v:
        return None
    VALID = {"general", "obc", "sc", "st", "ews"}
    s = str(v).strip().lower()
    return s if s in VALID else None


def _norm_name(v: _Optional[str]) -> _Optional[str]:
    if not v:
        return None
    # Strip OCR junk characters — keep letters, spaces, dots, hyphens
    cleaned = _re.sub(r"[^\w\s.\-]", "", str(v), flags=_re.UNICODE).strip()
    return cleaned if len(cleaned) >= 2 else None


# ---------------------------------------------------------------------------
# LLM system prompt (shared between text and vision paths)
# ---------------------------------------------------------------------------

_LLM_EXTRACT_SYSTEM = """\
You are an expert Indian government document parser (Aadhaar card, PAN card, Voter ID, Marksheets, Income Certificates).
Extract the citizen's personal information and respond ONLY with a JSON object containing exactly these 14 keys (use null for any field not clearly present — NEVER guess or invent values):

{
  "full_name": null,
  "father_or_guardian_name": null,
  "date_of_birth": null,
  "gender": null,
  "mobile_number": null,
  "email": null,
  "aadhaar_last4": null,
  "annual_income": null,
  "address_line": null,
  "village_or_city": null,
  "state": null,
  "district": null,
  "pincode": null,
  "category": null
}

Guidelines:
1. Citizen Full Name: Extract the primary individual/cardholder/applicant name. Identify the name from visual prominence and document context even if there is no "Name:" label.
2. Parent / Guardian / Care-of Name: If a father, mother, spouse, or guardian is specified (e.g., C/O, S/O, D/O, W/O, Father's Name), put it in 'father_or_guardian_name'. Keep it distinct from the citizen's own name.
3. Date of Birth: Format as YYYY-MM-DD.
4. Gender: Output "male", "female", or "other".
5. Address: Extract full residential address into 'address_line'. Extract district, state, and 6-digit postal pincode.
6. Mobile & Aadhaar: Extract 10-digit mobile number. For Aadhaar, extract ONLY the last 4 digits.
7. Return raw JSON only — no explanation, no markdown backticks."""

_LLM_EXTRACT_TEXT_USER = """\
Document Filename: {filename}

Extract all citizen profile details from this document text:
{text}"""

_LLM_EXTRACT_VISION_USER = """\
Document Filename: {filename}

Carefully inspect this document image and extract all citizen personal details (full name, date of birth in YYYY-MM-DD, father/guardian name, gender, full address, district, state, pincode, mobile number)."""

import logging as _logging
_logger = _logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Core fallback orchestration
# ---------------------------------------------------------------------------

def _validate_and_normalize_llm_output(raw: dict) -> dict:
    """
    Validate raw LLM dict against ExtractedProfileLLM, then normalize each field.
    Returns a dict of field→normalized_value; invalid fields become None (not dropped).
    """
    try:
        parsed = ExtractedProfileLLM.model_validate(raw)
    except Exception:
        return {}

    normalizers = {
        "full_name": _norm_name,
        "father_or_guardian_name": _norm_name,
        "date_of_birth": _norm_dob,
        "gender": _norm_gender,
        "mobile_number": _norm_mobile,
        "email": _norm_email,
        "aadhaar_last4": _norm_aadhaar,
        "annual_income": _norm_income,
        "address_line": _norm_address,
        "village_or_city": _norm_district,
        "state": _norm_state,
        "district": _norm_district,
        "pincode": _norm_pincode,
        "category": _norm_category,
    }

    result: dict = {}
    for field, norm_fn in normalizers.items():
        raw_val = getattr(parsed, field, None)
        try:
            result[field] = norm_fn(raw_val)
        except Exception:
            result[field] = None
    return result


def _pdf_to_png_pages(file_bytes: bytes, max_pages: int = 3) -> list[bytes]:
    """Render up to max_pages of a PDF to PNG bytes lists (in-memory, no disk)."""
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages: list[bytes] = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        # 150 dpi — good quality without hitting Groq size limits
        png_bytes = page.get_pixmap(dpi=150).tobytes("png")
        pages.append(png_bytes)
    doc.close()
    return pages


def _merge_llm_into_result(
    result: "ExtractResponse",
    llm_fields: dict,
    source_label: str,
) -> "ExtractResponse":
    """
    Merge normalized LLM fields into result. Rules:
    - Only fill fields that are currently None AND in uncertain_fields.
    - Never overwrite a field the regex already extracted.
    - Remove filled fields from uncertain_fields.
    - Set extraction_source and llm_filled_fields.
    Returns a new ExtractResponse (profile is mutated in-place is fine since
    it's our own object).
    """
    profile = result.profile
    uncertain = list(result.uncertain_fields)   # mutable copy
    filled: list[str] = []

    # Map from LLM field names to CitizenProfile field names (all match 1-to-1
    # except gender/category which are Enums in the profile)
    for field, llm_val in llm_fields.items():
        if llm_val is None:
            continue
        # Only fill if currently None or uncertain
        current = getattr(profile, field, None)
        if current is not None:
            continue   # regex won — never overwrite
        if field not in uncertain:
            continue   # regex was confident — skip

        # Apply: handle Enum fields specially
        try:
            if field == "gender":
                from app.schemas import Gender  # type: ignore
                setattr(profile, field, Gender(llm_val))
            elif field == "category":
                from app.schemas import Category  # type: ignore
                setattr(profile, field, Category(llm_val))
            else:
                setattr(profile, field, llm_val)
            filled.append(field)
            if field in uncertain:
                uncertain.remove(field)
        except Exception:
            pass   # invalid enum value → leave uncertain

    # Update profile.uncertain_fields
    profile.uncertain_fields = uncertain

    return ExtractResponse(
        profile=profile,
        uncertain_fields=uncertain,
        raw_text_preview=result.raw_text_preview,
        extraction_source=source_label,
        llm_filled_fields=filled,
    )


def _llm_extraction_fallback(
    result: "ExtractResponse",
    raw_text: str,
    file_bytes: bytes,
    ext: str,
    filename: str = "",
) -> "ExtractResponse":
    """
    Attempt to fill uncertain fields using the Groq LLM and Vision models.

    Text path: send raw_text (truncated) to the text model with filename.
    Vision path: convert to PNG pages and send to the vision model with filename.
      - Always used for image files (.jpg/.jpeg/.png).
      - Also used for scanned PDFs (raw_text very short) or when key fields are missing.

    Returns the original result unchanged on any error.
    """
    try:
        try:
            import app.llm_client as _llm  # type: ignore
        except ImportError:
            import backend.app.llm_client as _llm  # type: ignore

        chat_json = _llm.chat_json
        chat_json_vision = _llm.chat_json_vision

        IS_IMAGE = ext in {".jpg", ".jpeg", ".png"}
        text_is_thin = len(raw_text.strip()) < MIN_TEXT_CHARS_PER_PAGE  # < 30 chars = scanned/empty
        source_label = "regex"

        llm_raw: dict = {}

        # ---- TEXT PATH ----
        if not IS_IMAGE and not text_is_thin:
            user_msg = _LLM_EXTRACT_TEXT_USER.format(filename=filename or "document", text=raw_text[:4000])
            llm_raw = chat_json(
                system_prompt=_LLM_EXTRACT_SYSTEM,
                user_content=user_msg,
            )
            if llm_raw:
                source_label = "regex+llm_text"
                _logger.info(
                    "LLM text extraction ran; %d fields in response.", len(llm_raw)
                )

        # ---- VISION PATH ----
        # Run if: image file, scanned PDF, or critical identity fields (full_name / dob) remain missing
        has_full_name = bool(llm_raw.get("full_name") or getattr(result.profile, "full_name", None))
        has_dob = bool(llm_raw.get("date_of_birth") or getattr(result.profile, "date_of_birth", None))
        critical_missing = not has_full_name or not has_dob

        if IS_IMAGE or text_is_thin or critical_missing:
            if IS_IMAGE:
                images = [file_bytes]   # raw image bytes directly
            else:
                images = _pdf_to_png_pages(file_bytes, max_pages=3)

            if images:
                user_vis = _LLM_EXTRACT_VISION_USER.format(filename=filename or "document")
                vision_raw = chat_json_vision(
                    system_prompt=_LLM_EXTRACT_SYSTEM,
                    user_text=user_vis,
                    images=images,
                )
                if vision_raw:
                    # Vision fills only what text path missed
                    for k, v in vision_raw.items():
                        if k not in llm_raw or llm_raw[k] is None:
                            llm_raw[k] = v
                    source_label = "regex+llm_vision"
                    _logger.info(
                        "LLM vision extraction ran; %d fields in response.", len(vision_raw)
                    )

        if not llm_raw:
            return result  # nothing from LLM — return original unchanged

        normalized = _validate_and_normalize_llm_output(llm_raw)
        if not normalized:
            return result

        return _merge_llm_into_result(result, normalized, source_label)

    except Exception as exc:
        _logger.warning("LLM extraction fallback failed unexpectedly: %s", exc)
        return result
