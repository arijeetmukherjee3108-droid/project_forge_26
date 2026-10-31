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

import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app import extractor, eligibility
from app.browser_agent import start_application, resume_application
from app.schemas import (
    AgentStatus,
    ApplyResumeRequest,
    ApplyResumeResponse,
    ApplyStartRequest,
    ApplyStartResponse,
    EligibilityRequest,
    EligibilityResponse,
    ExtractResponse,
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
    allow_origins=[
        "http://localhost:5173",  # Vite dev server (Member 3)
        "http://localhost:3000",  # CRA fallback
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Upload directory — created on startup if missing
# ---------------------------------------------------------------------------

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health", tags=["meta"])
async def health_check() -> dict:
    """
    Liveness probe. Returns `{"status": "ok"}`.
    Useful for the team to confirm the server is up before running tests.
    """
    return {"status": "ok"}


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
    )
