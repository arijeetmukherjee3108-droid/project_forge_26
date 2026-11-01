"""
main.py — Voice-to-Legacy FastAPI application server.

Start the server:
    cd backend && uvicorn app.main:app --reload

Endpoints:
  GET  /health                → {"status": "ok"}
  POST /api/documents/extract → ExtractResponse
  POST /api/eligibility       → EligibilityResponse
  POST /api/apply/start       → ApplyStartResponse  (PLACEHOLDER — Step C2)
  POST /api/apply/resume      → ApplyResumeResponse (PLACEHOLDER — Step C2)

CORS allows http://localhost:5173 (Vite) and http://localhost:3000 (CRA).
Uploaded files are saved under backend/uploads/ with UUID-prefixed names
so Member 1's browser agent can later attach them to the portal form.

DO NOT log request bodies — they may contain personal citizen data.
"""

from __future__ import annotations

import sys
import asyncio

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

try:
    from app import extractor, eligibility
    from app.browser_agent import (
        start_application,
        resume_application,
        navigate_digilocker_apaar,
        autofill_digilocker_apaar,
        get_browser_session_status,
    )
    from app.ai_form_agent import scan_portal_url
    from app.google_vault import search_google_vault, fetch_google_vault_file
    from app.schemas import (
        AgentStatus,
        ApplyResumeRequest,
        ApplyResumeResponse,
        ApplyStartRequest,
        ApplyStartResponse,
        EligibilityRequest,
        EligibilityResponse,
        ExtractResponse,
        GoogleFetchRequest,
        GoogleSearchRequest,
        GoogleSearchResponse,
        IntentClassifyRequest,
        IntentClassifyResponse,
        DynamicScanRequest,
        DynamicScanResponse,
        DigiLockerNavigateRequest,
        DigiLockerAutofillRequest,
    )
except ImportError:
    from backend.app import extractor, eligibility
    from backend.app.browser_agent import (
        start_application,
        resume_application,
        navigate_digilocker_apaar,
        autofill_digilocker_apaar,
        get_browser_session_status,
    )
    from backend.app.ai_form_agent import scan_portal_url
    from backend.app.google_vault import search_google_vault, fetch_google_vault_file
    from backend.app.schemas import (
        AgentStatus,
        ApplyResumeRequest,
        ApplyResumeResponse,
        ApplyStartRequest,
        ApplyStartResponse,
        EligibilityRequest,
        EligibilityResponse,
        ExtractResponse,
        GoogleFetchRequest,
        GoogleSearchRequest,
        GoogleSearchResponse,
        IntentClassifyRequest,
        IntentClassifyResponse,
        DynamicScanRequest,
        DynamicScanResponse,
        DigiLockerNavigateRequest,
        DigiLockerAutofillRequest,
    )

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Voice-to-Legacy API",
    description=(
        "Backend API for the Voice-to-Legacy citizen services assistant. "
        "Extracts CitizenProfile from uploaded documents, checks eligibility, "
        "and (via browser agent) fills government portal forms."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Upload directory — created on startup if missing
# ---------------------------------------------------------------------------

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health", tags=["meta"])
@app.get("/api/health", tags=["meta"])
async def health_check() -> dict:
    """
    Liveness probe. Returns `{"status": "ok"}`.
    Useful for the team to confirm the server is up before running tests.
    """
    return {"status": "ok"}


@app.get("/mock_portal.html", include_in_schema=False)
async def serve_mock_portal():
    """Serves the offline mock portal for live document-upload testing."""
    mock_file = STATIC_DIR / "mock_portal.html"
    if mock_file.exists():
        return FileResponse(mock_file, media_type="text/html")
    raise HTTPException(status_code=404, detail="Mock portal not found")


@app.get("/{filename}.html", include_in_schema=False)
async def serve_portal_html(filename: str):
    """Generically serves any local HTML portal page for live zero-shot testing."""
    mock_file = STATIC_DIR / f"{filename}.html"
    if mock_file.exists():
        return FileResponse(mock_file, media_type="text/html")
    raise HTTPException(status_code=404, detail=f"Portal page '{filename}.html' not found")


@app.post(
    "/api/documents/extract",
    response_model=ExtractResponse,
    tags=["extraction"],
    summary="Upload a document and extract a CitizenProfile",
)
async def extract_document(
    file: UploadFile = File(..., description="PDF, PNG, JPG or JPEG ≤ 10 MB"),
) -> ExtractResponse:
    """
    Accepts a multipart file upload and returns an ExtractResponse containing:
    - **profile**: the extracted CitizenProfile (may have None fields)
    - **uncertain_fields**: fields the UI should highlight for manual review
    - **raw_text_preview**: first 300 characters of parsed text (Aadhaar masked)

    The uploaded file is saved to `backend/uploads/<uuid>.<ext>` so Member 1's
    browser agent can later attach it to the government portal form.

    **Note**: The saved filename is returned inside the response profile's
    `source_documents` list as the last element (e.g. `"saved:abc123.pdf"`).
    Member 1: look for entries prefixed with `"saved:"` in `source_documents`.
    <!-- TODO(Step C2): pass the saved filename to ApplyStartRequest.document_filename -->
    """
    # ---- Extension check (fast, before reading body)
    filename = file.filename or "upload"
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{suffix}'. Accepted: PDF, PNG, JPG, JPEG.",
        )

    # ---- Read body
    file_bytes = await file.read()

    # ---- Size check
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"File too large: {len(file_bytes) / 1024 / 1024:.1f} MB. "
                f"Maximum allowed is {MAX_UPLOAD_BYTES // 1024 // 1024} MB."
            ),
        )

    # ---- Save to uploads/
    saved_name = f"{uuid.uuid4().hex}{suffix}"
    saved_path = UPLOAD_DIR / saved_name
    saved_path.write_bytes(file_bytes)

    # ---- Extract fields
    try:
        result: ExtractResponse = extractor.extract_profile(file_bytes, filename)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc

    # ---- Append the saved filename so Member 1 can locate it
    # We prefix with "saved:" so it's distinguishable from document-type tags.
    result.profile.source_documents.append(f"saved:{saved_name}")

    return result


@app.post(
    "/api/intent/classify",
    response_model=IntentClassifyResponse,
    tags=["intent"],
    summary="Classify citizen voice/text intent to matching scheme",
)
async def classify_intent(body: IntentClassifyRequest) -> IntentClassifyResponse:
    """
    Classifies the citizen's prompt or transcribed voice query to a matching
    government scheme (e.g. '1784', 'vidyalakshmi', 'pm_kisan', 'ration_card').

    Returns the matched service ID, human-readable name, confidence score,
    and recommended document types for automatic Google Vault discovery.
    """
    return eligibility.classify_citizen_intent(body.text)


@app.post(
    "/api/eligibility",
    response_model=EligibilityResponse,
    tags=["eligibility"],
    summary="Check if a CitizenProfile is eligible for a service",
)
async def check_eligibility(body: EligibilityRequest) -> EligibilityResponse:
    """
    Runs deterministic eligibility rules for the given `service_id` against
    the provided `profile`.

    Returns an **EligibilityResponse** with:
    - **eligible**: True only if every rule passed
    - **results**: per-rule breakdown with plain-English explanations
    - **summary**: one-sentence verdict the UI can display

    Currently supported `service_id` values:
    - `"1784"` — Construction Worker Registration / Citizen Certificate
    - `"citizen_registration"` — ServicePlus Citizen Self-Registration
    """
    try:
        return eligibility.check_eligibility(body.profile, body.service_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc


@app.post(
    "/api/apply/start",
    response_model=ApplyStartResponse,
    tags=["apply"],
    summary="Start a browser-agent session to fill a government form",
)
async def apply_start(body: ApplyStartRequest) -> ApplyStartResponse:
    """
    Starts the autonomous Playwright browser agent to navigate and pre-fill fields
    on the government portal. Pauses at the CAPTCHA checkpoint and returns the
    cropped CAPTCHA and page preview for human verification.
    """
    return await start_application(
        profile=body.profile,
        service_id=body.service_id,
        document_filename=body.document_filename,
    )


@app.post(
    "/api/apply/resume",
    response_model=ApplyResumeResponse,
    tags=["apply"],
    summary="Resume a paused browser-agent session after CAPTCHA entry",
)
async def apply_resume(body: ApplyResumeRequest) -> ApplyResumeResponse:
    """
    Resumes the active Playwright browser session by typing the citizen's solved
    CAPTCHA into the portal and completing submission upon user approval.
    """
    return await resume_application(
        session_id=body.session_id,
        captcha_text=body.captcha_text,
        approve=body.approve,
        submit_final=body.submit_final,
    )


@app.post(
    "/api/apply/digilocker-navigate",
    response_model=ApplyStartResponse,
    tags=["apply"],
    summary="Deep-navigate to APAAR ID form post-login and fill initial dropdowns",
)
async def digilocker_navigate(body: DigiLockerNavigateRequest) -> ApplyStartResponse:
    """
    Executes autonomous navigation to APAAR form on DigiLocker post-login,
    opens dropdowns, fills initial identity options, and halts at Institution/Board checkpoint.
    """
    return await navigate_digilocker_apaar(session_id=body.session_id)


@app.post(
    "/api/apply/digilocker-autofill",
    response_model=ApplyResumeResponse,
    tags=["apply"],
    summary="Resume APAAR autofill after Human-in-the-Loop Institution/Board selection",
)
async def digilocker_autofill(body: DigiLockerAutofillRequest) -> ApplyResumeResponse:
    """
    Resumes after Human-in-the-Loop selection, checks consent, highlights 'Get Document',
    and halts right before final submit for sovereign citizen review.
    """
    return await autofill_digilocker_apaar(
        session_id=body.session_id,
        selected_board=body.selected_board,
    )


@app.get(
    "/api/apply/session-status/{session_id}",
    tags=["apply"],
    summary="Get current browser URL and authentication state",
)
async def get_session_status_endpoint(session_id: str) -> dict:
    """Returns active session state, current URL, and completed steps."""
    return await get_browser_session_status(session_id=session_id)


@app.post(
    "/api/documents/google-search",
    response_model=GoogleSearchResponse,
    tags=["google-vault"],
    summary="Search Google Drive & Gmail for citizen documents",
)
async def google_search(body: GoogleSearchRequest) -> GoogleSearchResponse:
    """
    Searches the citizen's Google Drive and Gmail attachments for documents
    matching the query (e.g. 'income certificate', 'marksheet').

    Returns a list of candidate files with name, source, size, and date
    so the citizen can pick the correct one before downloading.

    Set ``demo_mode=true`` for hackathon demos (returns synthetic candidates
    without requiring a live Google OAuth token).
    """
    candidates = search_google_vault(
        access_token=body.access_token,
        query=body.query,
        demo_mode=body.demo_mode,
    )
    return GoogleSearchResponse(
        query=body.query,
        candidates=candidates,
    )


@app.post(
    "/api/documents/google-fetch",
    response_model=ExtractResponse,
    tags=["google-vault"],
    summary="Download a file from Google Drive/Gmail, extract profile, and save for upload",
)
async def google_fetch(body: GoogleFetchRequest) -> ExtractResponse:
    """
    Downloads the selected file from Google Drive or Gmail, saves it to
    ``backend/uploads/``, extracts a CitizenProfile using the same pipeline
    as ``/api/documents/extract``, and returns the standard ExtractResponse.

    The saved filename is appended to ``profile.source_documents`` as
    ``"saved:<uuid>.pdf"`` so the browser agent can later attach it to
    the government portal form.

    Set ``demo_mode=true`` for hackathon demos (generates a synthetic
    certificate PDF without calling Google APIs).
    """
    try:
        file_bytes, filename = fetch_google_vault_file(
            access_token=body.access_token,
            file_id=body.file_id,
            source=body.source,
            demo_mode=body.demo_mode,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch file from Google: {exc}",
        ) from exc

    # Save to uploads/
    suffix = Path(filename).suffix.lower() or ".pdf"
    if suffix not in ALLOWED_SUFFIXES:
        suffix = ".pdf"
    saved_name = f"{uuid.uuid4().hex}{suffix}"
    saved_path = UPLOAD_DIR / saved_name
    saved_path.write_bytes(file_bytes)

    # Extract fields
    try:
        result: ExtractResponse = extractor.extract_profile(file_bytes, filename)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc

    # Append saved filename so browser_agent can locate it
    result.profile.source_documents.append(f"saved:{saved_name}")

    return result


@app.post(
    "/api/form/scan-dom",
    response_model=DynamicScanResponse,
    tags=["dynamic-form"],
    summary="Zero-shot distill arbitrary government portal DOM and generate action plan",
)
async def scan_form_dom(body: DynamicScanRequest) -> DynamicScanResponse:
    """
    Scans any arbitrary government portal in India, distills interactive fields
    into a compact ~400-token JSON blueprint, infers required documents, and uses
    AI to generate an actionable pre-fill and upload plan.
    """
    url = body.portal_url.strip()
    if not url.startswith(("http://", "https://", "file://")):
        mock_file = STATIC_DIR / f"{url.lower()}_mock.html"
        if mock_file.exists():
            url = f"file://{mock_file.resolve()}"
        else:
            url = f"https://{url}.gov.in"

    try:
        blueprint = await scan_portal_url(url, body.profile)
        return DynamicScanResponse(**blueprint)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to scan portal DOM: {exc}",
        ) from exc

