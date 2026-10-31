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

import fitz  # PyMuPDF

from app.schemas import Category, CitizenProfile, ExtractResponse, Gender

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
    r"(?:father(?:'?s)?\s+name|pita\s*(?:ka\s*)?naam|guardian\s+name)\s*[:\-]\s*([A-Za-z][A-Za-z\s\.]{2,58}?)\s*$",
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


def _ocr_image_bytes(image_bytes: bytes, mime_hint: str = "png") -> str:
    """
    Run pytesseract on raw image bytes.
    Returns extracted text, or raises ImportError / OSError if unavailable.
    """
    try:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore
        import io

        img = Image.open(io.BytesIO(image_bytes))
        return pytesseract.image_to_string(img)
    except ImportError as exc:
        raise ImportError("pytesseract or Pillow not installed") from exc


def _ocr_pdf_bytes(file_bytes: bytes) -> str:
    """Render each PDF page to an image and OCR it."""
    try:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore
        import io

        doc = fitz.open(stream=file_bytes, filetype="pdf")
        texts: list[str] = []
        for page in doc:
            pix = page.get_pixmap(dpi=200)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            texts.append(pytesseract.image_to_string(img))
        doc.close()
        return "\n".join(texts)
    except ImportError as exc:
        raise ImportError("pytesseract or Pillow not installed") from exc


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
    if ext == ".pdf":
        selectable_text, needs_ocr = _extract_text_from_pdf(file_bytes)
        if needs_ocr:
            try:
                raw_text = _ocr_pdf_bytes(file_bytes)
            except ImportError:
                ocr_warning = (
                    "OCR is unavailable (Tesseract not installed). "
                    "Please install Tesseract and pytesseract, or upload a text-PDF."
                )
                raw_text = selectable_text  # use whatever we have
        else:
            raw_text = selectable_text
    else:
        # Image file
        try:
            raw_text = _ocr_image_bytes(file_bytes)
        except ImportError:
            ocr_warning = (
                "OCR is unavailable (Tesseract not installed). "
                "Cannot read image files. Please install Tesseract and pytesseract."
            )

    # ---- If OCR totally unavailable, return a safe empty response
    if ocr_warning and not raw_text.strip():
        empty_profile = CitizenProfile(
            uncertain_fields=ALL_PROFILE_FIELDS,
            source_documents=[],
        )
        return ExtractResponse(
            profile=empty_profile,
            uncertain_fields=ALL_PROFILE_FIELDS,
            raw_text_preview=ocr_warning,
        )

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
        masked_preview = f"[Warning: {ocr_warning}]\n\n{masked_preview}"

    return ExtractResponse(
        profile=profile,
        uncertain_fields=uncertain,
        raw_text_preview=masked_preview,
    )
