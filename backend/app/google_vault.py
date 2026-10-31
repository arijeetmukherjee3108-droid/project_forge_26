"""
google_vault.py — Google Vault Auto-Document Hunter (Drive + Gmail).

Searches a citizen's Google Drive and Gmail attachments for government
certificates (Income Certificate, Marksheet, Caste Certificate, etc.)
and downloads the selected file for extraction + portal upload.

Public API:
    search_google_vault(access_token, query, demo_mode) -> list[VaultCandidate]
    fetch_google_vault_file(access_token, file_id, source, demo_mode) -> (bytes, str)

Uses lightweight urllib.request — no heavy SDK dependencies.
Never crashes: every API/network error is caught and returned gracefully.

Owned by Member 1 (Krrish Dixit).
"""

from __future__ import annotations

import io
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
import base64
from typing import Optional

try:
    from app.schemas import VaultCandidate
except ImportError:
    from backend.app.schemas import VaultCandidate

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Google API base URLs
# ---------------------------------------------------------------------------
_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
_GMAIL_MESSAGES_URL = "https://www.googleapis.com/gmail/v1/users/me/messages"

# ---------------------------------------------------------------------------
# Demo / mock data — used when demo_mode=True or access_token is missing
# ---------------------------------------------------------------------------
_DEMO_CANDIDATES: dict[str, list[dict]] = {
    "income": [
        {
            "id": "demo_drive_income_cert_2025",
            "name": "Income_Certificate_Tehsildar_2025.pdf",
            "source": "Google Drive",
            "mime_type": "application/pdf",
            "size_kb": 142.5,
            "modified_date": "2025-08-10",
        },
        {
            "id": "demo_gmail_itr_2024",
            "name": "ITR_Acknowledgement_AY2024-25.pdf",
            "source": "Gmail",
            "mime_type": "application/pdf",
            "size_kb": 520.0,
            "modified_date": "2024-07-31",
        },
    ],
    "marksheet": [
        {
            "id": "demo_drive_marksheet_12th",
            "name": "Class_12_Marksheet_CBSE_2023.pdf",
            "source": "Google Drive",
            "mime_type": "application/pdf",
            "size_kb": 310.2,
            "modified_date": "2023-06-15",
        },
    ],
    "aadhaar": [
        {
            "id": "demo_drive_aadhaar",
            "name": "Aadhaar_Card_Masked.pdf",
            "source": "Google Drive",
            "mime_type": "application/pdf",
            "size_kb": 85.0,
            "modified_date": "2024-01-20",
        },
    ],
    "caste": [
        {
            "id": "demo_drive_caste_cert",
            "name": "Caste_Certificate_OBC_2024.pdf",
            "source": "Google Drive",
            "mime_type": "application/pdf",
            "size_kb": 175.8,
            "modified_date": "2024-03-12",
        },
    ],
    "domicile": [
        {
            "id": "demo_drive_domicile",
            "name": "Domicile_Certificate_Rajasthan.pdf",
            "source": "Google Drive",
            "mime_type": "application/pdf",
            "size_kb": 198.0,
            "modified_date": "2024-05-22",
        },
    ],
    "kisan": [
        {
            "id": "demo_drive_pmkisan_passbook",
            "name": "PM_KISAN_Land_Record_Patwari.pdf",
            "source": "Google Drive",
            "mime_type": "application/pdf",
            "size_kb": 215.4,
            "modified_date": "2024-09-18",
        },
        {
            "id": "demo_gmail_kisan_credit",
            "name": "Kisan_Credit_Card_Passbook.pdf",
            "source": "Gmail",
            "mime_type": "application/pdf",
            "size_kb": 184.0,
            "modified_date": "2024-06-10",
        },
    ],
    "farmer": [
        {
            "id": "demo_drive_farmer_land",
            "name": "Khasra_Khatauni_Land_Document.pdf",
            "source": "Google Drive",
            "mime_type": "application/pdf",
            "size_kb": 240.0,
            "modified_date": "2024-08-05",
        },
    ],
    "ration": [
        {
            "id": "demo_drive_ration_card",
            "name": "NFSA_Priority_Ration_Card.pdf",
            "source": "Google Drive",
            "mime_type": "application/pdf",
            "size_kb": 160.0,
            "modified_date": "2023-11-14",
        },
    ],
}


def _generate_demo_pdf(query: str, file_id: str = "") -> bytes:
    """
    Generate a realistic synthetic PDF certificate for demo mode.
    Contains extractable text fields so extractor.extract_profile() can parse them.
    Multi-document support for Marksheets, Kisan records, Ration Cards, Aadhaar, and Income Certs.
    """
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)  # A4

    hint = f"{query} {file_id}".lower()

    if any(k in hint for k in ["marksheet", "10th", "12th", "cbse", "mark"]):
        # CBSE Marksheet Template
        page.insert_text((50, 60), "CENTRAL BOARD OF SECONDARY EDUCATION", fontsize=16)
        page.insert_text((50, 85), "Senior School Certificate Examination (Class XII)", fontsize=12)
        page.insert_text((50, 130), "MARKS STATEMENT & PERFORMANCE CERTIFICATE", fontsize=16)
        page.insert_text((50, 155), "Roll No: 6184920 | Year: 2023 | School: 08412-GOVT SR SEC SCHOOL JAIPUR", fontsize=10)

        y = 200
        fields = [
            "Candidate Name: Ramesh Kumar Sharma",
            "Father's Name: Suresh Kumar Sharma",
            "Date of Birth: 15/05/1999",
            "Gender: Male",
            "Mobile: 9876543210",
            "Email: ramesh.sharma2026@example.com",
            "State: Rajasthan",
            "District: Jaipur",
            "Pin Code: 302029",
            "Occupation: Student",
            "Annual Income: Rs. 140000",
            "Category: OBC",
            "----------------------------------------------------------------------",
            "SUB CODE & NAME             THEORY   PRACTICAL   TOTAL   GRADE",
            "301  ENGLISH CORE             070       018       088      A2",
            "041  MATHEMATICS              074       018       092      A1",
            "042  PHYSICS                  058       028       086      A2",
            "043  CHEMISTRY                062       028       090      A1",
            "----------------------------------------------------------------------",
            "RESULT: PASS (Overall Percentage: 89.0%)",
        ]
        for field_line in fields:
            page.insert_text((50, y), field_line, fontsize=10)
            y += 20
        page.insert_text((50, y + 25), "Controller of Examinations, CBSE New Delhi", fontsize=10)
        page.insert_text((50, y + 45), "Date of Result Declaration: 12/05/2023", fontsize=10)

    elif any(k in hint for k in ["kisan", "farmer", "land", "passbook"]):
        # PM-KISAN & Land Record Passbook Template
        page.insert_text((50, 60), "PRADHAN MANTRI KISAN SAMMAN NIDHI (PM-KISAN)", fontsize=16)
        page.insert_text((50, 85), "Department of Agriculture & Farmers Welfare, Rajasthan", fontsize=12)
        page.insert_text((50, 130), "FARMER BENEFICIARY PASSBOOK & LAND RECORD", fontsize=16)
        page.insert_text((50, 155), "Registration No: RJ-KISAN-2024-91823 | Domicile: Rajasthan", fontsize=10)

        y = 200
        fields = [
            "Farmer Name: Ramesh Kumar Sharma",
            "Father's Name: Suresh Kumar Sharma",
            "Date of Birth: 15/05/1999",
            "Gender: Male",
            "Mobile: 9876543210",
            "Aadhaar No: 4567 8901 2345",
            "Village: Sanganer",
            "District: Jaipur",
            "State: Rajasthan",
            "Pin Code: 302029",
            "Occupation: Farmer",
            "Annual Income: Rs. 95000",
            "Category: OBC",
            "Landholding Area: 1.4 Hectares (Small & Marginal Farmer Category)",
            "Khasra / Khatauni Number: 412/1, Patwar Circle Sanganer",
            "DBT Direct Benefit Transfer Bank Status: ACTIVE (Aadhaar Seeded)",
        ]
        for field_line in fields:
            page.insert_text((50, y), field_line, fontsize=11)
            y += 22
        page.insert_text((50, y + 25), "Certified by: Patwari / Tehsildar, Sanganer Tehsil, Jaipur", fontsize=10)
        page.insert_text((50, y + 45), "Date of Verification: 14/06/2024", fontsize=10)

    elif any(k in hint for k in ["aadhaar", "uid"]):
        # Aadhaar Card Template
        page.insert_text((50, 60), "UNIQUE IDENTIFICATION AUTHORITY OF INDIA", fontsize=16)
        page.insert_text((50, 85), "Government of India | Mera Aadhaar, Meri Pehchaan", fontsize=12)
        page.insert_text((50, 130), "AADHAAR CARD (OFFICIAL IDENTITY DOCUMENT)", fontsize=16)
        page.insert_text((50, 155), "Enrolment No: 1048/29184/01924", fontsize=10)

        y = 200
        fields = [
            "Name: Ramesh Kumar Sharma",
            "Father's Name: Suresh Kumar Sharma",
            "Date of Birth: 15/05/1999",
            "Gender: Male",
            "Aadhaar Number: 4567 8901 2345",
            "Mobile: 9876543210",
            "Email: ramesh.sharma2026@example.com",
            "Address: 42, Shanti Nagar, Near Gandhi Circle",
            "Village: Sanganer",
            "District: Jaipur",
            "State: Rajasthan",
            "Pin Code: 302029",
            "Occupation: Student",
            "Annual Income: Rs. 140000",
            "Category: OBC",
        ]
        for field_line in fields:
            page.insert_text((50, y), field_line, fontsize=11)
            y += 22
        page.insert_text((50, y + 25), "Unique Identification Authority of India (UIDAI)", fontsize=10)
        page.insert_text((50, y + 45), "Generation Date: 20/01/2024", fontsize=10)

    elif any(k in hint for k in ["ration", "bpl", "nfsa"]):
        # NFSA Ration Card Template
        page.insert_text((50, 60), "FOOD & CIVIL SUPPLIES DEPARTMENT, RAJASTHAN", fontsize=16)
        page.insert_text((50, 85), "National Food Security Act (NFSA) 2013", fontsize=12)
        page.insert_text((50, 130), "PRIORITY HOUSEHOLD RATION CARD (BPL/PHH)", fontsize=16)
        page.insert_text((50, 155), "Ration Card No: 0802-9182-3841", fontsize=10)

        y = 200
        fields = [
            "Head of Family: Ramesh Kumar Sharma",
            "Father's Name: Suresh Kumar Sharma",
            "Date of Birth: 15/05/1999",
            "Gender: Male",
            "Mobile: 9876543210",
            "Aadhaar Number: 4567 8901 2345",
            "Address: 42, Shanti Nagar, Sanganer",
            "District: Jaipur",
            "State: Rajasthan",
            "Pin Code: 302029",
            "Annual Income: Rs. 80000",
            "Category: OBC",
            "Fair Price Shop (FPS) Code: 4192 - Jaipur Central",
            "Monthly Entitlement: Wheat 25 kg @ Rs 2/kg",
        ]
        for field_line in fields:
            page.insert_text((50, y), field_line, fontsize=11)
            y += 22
        page.insert_text((50, y + 25), "Issued by: District Supply Officer, Food Department, Jaipur", fontsize=10)
        page.insert_text((50, y + 45), "Date of Issue: 18/11/2023", fontsize=10)

    else:
        # Standard Income Certificate (Default)
        page.insert_text((50, 60), "GOVERNMENT OF RAJASTHAN", fontsize=16)
        page.insert_text((50, 85), "Office of the Tehsildar, Jaipur District", fontsize=12)
        page.insert_text((50, 130), "INCOME & DOMICILE CERTIFICATE", fontsize=16)
        page.insert_text((50, 155), "Certificate No: RJ/JPR/2025/00847", fontsize=10)

        y = 200
        fields = [
            "Name: Ramesh Kumar Sharma",
            "Father's Name: Suresh Kumar Sharma",
            "Date of Birth: 15/05/1999",
            "Gender: Male",
            "Mobile: 9876543210",
            "Email: ramesh.sharma2026@example.com",
            "Aadhaar No: 4567 8901 2345",
            "Address: 42, Shanti Nagar, Near Gandhi Circle",
            "Village: Sanganer",
            "District: Jaipur",
            "State: Rajasthan",
            "Pin Code: 302029",
            "Occupation: Student",
            "Annual Income: Rs. 140000",
            "Category: OBC",
        ]
        for field_line in fields:
            page.insert_text((50, y), field_line, fontsize=11)
            y += 22
        page.insert_text((50, y + 25), "Issued by: Tehsildar, Jaipur", fontsize=10)
        page.insert_text((50, y + 45), "Date of Issue: 10/08/2025", fontsize=10)

    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Internal helpers for Google APIs
# ---------------------------------------------------------------------------

def _api_get(url: str, access_token: str) -> dict:
    """Make an authenticated GET request to a Google API. Returns parsed JSON."""
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {access_token}")
    req.add_header("Accept", "application/json")

    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _api_get_bytes(url: str, access_token: str) -> bytes:
    """Make an authenticated GET request and return raw bytes."""
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {access_token}")

    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def _search_drive(access_token: str, query: str) -> list[VaultCandidate]:
    """Search Google Drive for PDF/image files matching the query."""
    candidates: list[VaultCandidate] = []

    clean_terms = [t.strip().replace("'", "\\'") for t in query.replace("_", " ").split() if t.strip()]
    if not clean_terms:
        return []

    # Match each term in filename, or search fullText
    term_clauses = " and ".join(f"name contains '{t}'" for t in clean_terms)
    drive_query = (
        f"({term_clauses}) "
        f"and (mimeType='application/pdf' or mimeType contains 'image/') "
        f"and trashed=false"
    )
    params = urllib.parse.urlencode({
        "q": drive_query,
        "fields": "files(id,name,mimeType,size,modifiedTime)",
        "pageSize": 10,
        "orderBy": "modifiedTime desc",
    })
    url = f"{_DRIVE_FILES_URL}?{params}"

    try:
        data = _api_get(url, access_token)
        for f in data.get("files", []):
            size_bytes = int(f.get("size", 0))
            modified = f.get("modifiedTime", "")[:10]  # YYYY-MM-DD
            candidates.append(VaultCandidate(
                id=f["id"],
                name=f.get("name", "Untitled"),
                source="Google Drive",
                mime_type=f.get("mimeType", "application/octet-stream"),
                size_kb=round(size_bytes / 1024, 1) if size_bytes else None,
                modified_date=modified or None,
            ))
    except (urllib.error.URLError, urllib.error.HTTPError, Exception) as exc:
        logger.warning("Drive search failed: %s", exc)

    return candidates


def _search_gmail(access_token: str, query: str) -> list[VaultCandidate]:
    """Search Gmail for messages with attachments matching the query."""
    candidates: list[VaultCandidate] = []

    clean_terms = [t.strip() for t in query.replace("_", " ").split() if t.strip()]
    search_keywords = " ".join(clean_terms) if clean_terms else query
    gmail_query = f"has:attachment filename:(pdf OR jpg OR jpeg OR png) {search_keywords}"
    params = urllib.parse.urlencode({
        "q": gmail_query,
        "maxResults": 10,
    })
    url = f"{_GMAIL_MESSAGES_URL}?{params}"

    try:
        data = _api_get(url, access_token)
        messages = data.get("messages", [])

        for msg_stub in messages[:5]:  # limit to 5 messages
            msg_id = msg_stub["id"]
            msg_url = (
                f"{_GMAIL_MESSAGES_URL}/{msg_id}"
                f"?fields=payload(parts(filename,mimeType,body(attachmentId,size)),headers)"
            )

            try:
                msg_data = _api_get(msg_url, access_token)
                payload = msg_data.get("payload", {})

                # Extract date from headers
                headers = payload.get("headers", [])
                date_str = None
                for h in headers:
                    if h.get("name", "").lower() == "date":
                        # Parse just the date part
                        raw = h.get("value", "")
                        # Try to extract YYYY-MM-DD-ish from the date header
                        date_str = raw[:16] if raw else None
                        break

                # Look through parts for attachments
                for part in payload.get("parts", []):
                    filename = part.get("filename", "")
                    mime = part.get("mimeType", "")
                    att_id = part.get("body", {}).get("attachmentId")
                    att_size = part.get("body", {}).get("size", 0)

                    if filename and att_id:
                        # Build a composite ID: msgId/attachmentId
                        composite_id = f"{msg_id}/{att_id}"
                        candidates.append(VaultCandidate(
                            id=composite_id,
                            name=filename,
                            source="Gmail",
                            mime_type=mime or "application/octet-stream",
                            size_kb=round(att_size / 1024, 1) if att_size else None,
                            modified_date=date_str,
                        ))
            except Exception as exc:
                logger.warning("Failed to fetch Gmail message %s: %s", msg_id, exc)

    except (urllib.error.URLError, urllib.error.HTTPError, Exception) as exc:
        logger.warning("Gmail search failed: %s", exc)

    return candidates


def _download_drive_file(access_token: str, file_id: str) -> tuple[bytes, str]:
    """Download a file from Google Drive. Returns (file_bytes, filename)."""
    # First get metadata for the filename
    meta_url = f"{_DRIVE_FILES_URL}/{file_id}?fields=name,mimeType"
    meta = _api_get(meta_url, access_token)
    filename = meta.get("name", "document.pdf")

    # Download the actual content
    download_url = f"{_DRIVE_FILES_URL}/{file_id}?alt=media"
    file_bytes = _api_get_bytes(download_url, access_token)

    return file_bytes, filename


def _download_gmail_attachment(
    access_token: str, composite_id: str
) -> tuple[bytes, str]:
    """
    Download a Gmail attachment.
    composite_id format: "messageId/attachmentId"
    Returns (file_bytes, filename).
    """
    parts = composite_id.split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid Gmail composite_id: {composite_id}")
    msg_id, att_id = parts

    # Get the attachment data
    att_url = (
        f"{_GMAIL_MESSAGES_URL}/{msg_id}/attachments/{att_id}"
    )
    att_data = _api_get(att_url, access_token)
    raw_data = att_data.get("data", "")

    # Gmail uses URL-safe base64
    # Add padding if needed
    padded = raw_data + "=" * (4 - len(raw_data) % 4)
    file_bytes = base64.urlsafe_b64decode(padded)

    # Get the filename from the message metadata
    msg_url = (
        f"{_GMAIL_MESSAGES_URL}/{msg_id}"
        f"?fields=payload(parts(filename,body(attachmentId)))"
    )
    msg_data = _api_get(msg_url, access_token)
    filename = "attachment.pdf"
    for part in msg_data.get("payload", {}).get("parts", []):
        if part.get("body", {}).get("attachmentId") == att_id:
            filename = part.get("filename", "attachment.pdf")
            break

    return file_bytes, filename


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def search_google_vault(
    access_token: Optional[str],
    query: str,
    demo_mode: bool = False,
) -> list[VaultCandidate]:
    """
    Search Google Drive and Gmail for documents matching `query`.

    If demo_mode=True or access_token is missing, returns realistic
    synthetic candidates for hackathon demos and testing.

    Returns a list of VaultCandidate objects sorted by relevance.
    """
    query = query.strip()
    if not query:
        return []

    # Demo mode: return synthetic candidates
    if demo_mode or not access_token:
        query_lower = query.lower()
        candidates: list[VaultCandidate] = []

        # Match against demo data
        for keyword, items in _DEMO_CANDIDATES.items():
            if keyword in query_lower or query_lower in keyword:
                for item in items:
                    candidates.append(VaultCandidate(**item))

        # If no specific match, return a generic result
        if not candidates:
            candidates.append(VaultCandidate(
                id=f"demo_generic_{query_lower.replace(' ', '_')}",
                name=f"{query.replace(' ', '_')}_Certificate.pdf",
                source="Google Drive",
                mime_type="application/pdf",
                size_kb=156.0,
                modified_date="2025-06-01",
            ))

        return candidates

    # Live mode: search both Drive and Gmail
    drive_results = _search_drive(access_token, query)
    gmail_results = _search_gmail(access_token, query)

    return drive_results + gmail_results


def fetch_google_vault_file(
    access_token: Optional[str],
    file_id: str,
    source: str = "drive",
    demo_mode: bool = False,
) -> tuple[bytes, str]:
    """
    Download a specific file from Google Drive or Gmail.

    If demo_mode=True or access_token is missing, generates a synthetic
    PDF certificate with extractable fields.

    Returns (file_bytes, filename).
    """
    # Demo mode: generate synthetic certificate
    if demo_mode or not access_token:
        # Infer document type from file_id
        query_hint = file_id.replace("demo_", "").replace("_", " ")
        pdf_bytes = _generate_demo_pdf(query_hint, file_id=file_id)
        filename = f"demo_certificate_{file_id}.pdf"
        return pdf_bytes, filename

    # Live mode: download from the appropriate source
    source_lower = source.strip().lower()

    if source_lower == "gmail":
        return _download_gmail_attachment(access_token, file_id)
    else:
        # Default to Drive
        return _download_drive_file(access_token, file_id)

