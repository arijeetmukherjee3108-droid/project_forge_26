"""
schemas.py — Single Source of Truth for the Voice-to-Legacy Data Contract
=========================================================================
All Pydantic v2 models, enums, and validators used by the backend API live here.

Member 3: frontend/src/types.ts MUST mirror every model and field defined in
this file. Keep names identical (snake_case → camelCase where TS conventions
require it), but the field semantics must stay 1-to-1.

No FastAPI imports, no business logic, no file I/O in this module.
Required package: pydantic>=2
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class Gender(str, Enum):
    """Recognised gender values for CitizenProfile."""

    male = "male"
    female = "female"
    other = "other"


class Category(str, Enum):
    """Social-category values used by Indian government schemes."""

    general = "general"
    obc = "obc"
    sc = "sc"
    st = "st"
    ews = "ews"


class AgentStatus(str, Enum):
    """
    Lifecycle states of the Playwright browser agent session.

    running         – agent is actively interacting with the portal.
    awaiting_captcha – agent has paused; waiting for user to solve CAPTCHA.
    submitted       – form was successfully submitted; receipt available.
    failed          – an unrecoverable error occurred.
    """

    running = "running"
    awaiting_captcha = "awaiting_captcha"
    submitted = "submitted"
    failed = "failed"


# ---------------------------------------------------------------------------
# Core citizen model
# ---------------------------------------------------------------------------


class CitizenProfile(BaseModel):
    """
    Central model representing a citizen's extracted profile.

    All fields are Optional[...] = None by default because document
    extraction can be partial or ambiguous.  The ``uncertain_fields``
    list names every field whose value is missing or low-confidence so
    the React UI can highlight them for manual verification.

    Privacy note: we store ONLY the last 4 digits of the Aadhaar number.
    Passing a full 12-digit number will raise a ValidationError.
    """

    # ---- Personal identification ----------------------------------------
    full_name: Optional[str] = Field(
        default=None,
        description="Citizen's full legal name as on the document.",
    )
    father_or_guardian_name: Optional[str] = Field(
        default=None,
        description="Father's or legal guardian's full name.",
    )
    date_of_birth: Optional[str] = Field(
        default=None,
        description="Date of birth in ISO-8601 format: YYYY-MM-DD.",
    )
    gender: Optional[Gender] = Field(
        default=None,
        description="Gender as declared on the identity document.",
    )

    # ---- Contact details ------------------------------------------------
    mobile_number: Optional[str] = Field(
        default=None,
        description="10-digit Indian mobile number (digits only, no country code).",
    )
    email: Optional[str] = Field(
        default=None,
        description="Citizen's email address.",
    )

    # ---- Identity numbers -----------------------------------------------
    aadhaar_last4: Optional[str] = Field(
        default=None,
        description=(
            "Last 4 digits of the Aadhaar number ONLY. "
            "Full 12-digit Aadhaar is never stored."
        ),
    )

    # ---- Address --------------------------------------------------------
    address_line: Optional[str] = Field(
        default=None,
        description="Street / house number address line.",
    )
    village_or_city: Optional[str] = Field(
        default=None,
        description="Village or city name.",
    )
    district: Optional[str] = Field(
        default=None,
        description="District name.",
    )
    state: Optional[str] = Field(
        default=None,
        description="State name (full, e.g. 'Rajasthan').",
    )
    pincode: Optional[str] = Field(
        default=None,
        description="6-digit Indian postal PIN code.",
    )

    # ---- Socioeconomic details -----------------------------------------
    occupation: Optional[str] = Field(
        default=None,
        description="Citizen's declared occupation.",
    )
    annual_income: Optional[int] = Field(
        default=None,
        ge=0,
        description="Annual household income in INR. Must be >= 0.",
    )
    category: Optional[Category] = Field(
        default=None,
        description="Social category for scheme eligibility.",
    )

    # ---- Metadata fields -----------------------------------------------
    source_documents: list[str] = Field(
        default_factory=list,
        description=(
            "Filenames or document-type tags of source documents used for "
            "extraction (e.g. 'income_certificate', 'aadhaar')."
        ),
    )
    uncertain_fields: list[str] = Field(
        default_factory=list,
        description=(
            "Names of CitizenProfile fields that are missing or ambiguous. "
            "The UI highlights these in yellow for manual verification."
        ),
    )
    verified_by_user: bool = Field(
        default=False,
        description="Set to True after the citizen explicitly confirms the profile.",
    )

    # ---- Validators ----------------------------------------------------

    @field_validator("date_of_birth", mode="before")
    @classmethod
    def validate_dob(cls, v: object) -> object:
        """Accept None or a valid YYYY-MM-DD string; reject anything else."""
        if v is None:
            return v
        try:
            date.fromisoformat(str(v))
        except ValueError as exc:
            raise ValueError(
                f"date_of_birth must be in YYYY-MM-DD format, got: {v!r}"
            ) from exc
        return str(v)

    @field_validator("mobile_number", mode="before")
    @classmethod
    def validate_mobile(cls, v: object) -> object:
        """Digits only, exactly 10 characters."""
        if v is None:
            return v
        s = str(v).strip()
        if not s.isdigit():
            raise ValueError(
                f"mobile_number must contain digits only, got: {s!r}"
            )
        if len(s) != 10:
            raise ValueError(
                f"mobile_number must be exactly 10 digits, got {len(s)} digits: {s!r}"
            )
        return s

    @field_validator("aadhaar_last4", mode="before")
    @classmethod
    def validate_aadhaar_last4(cls, v: object) -> object:
        """
        Accept only the last 4 digits of an Aadhaar number.
        Reject any string longer than 4 characters to prevent accidental
        storage of a full 12-digit Aadhaar.
        """
        if v is None:
            return v
        s = str(v).strip()
        if len(s) > 4:
            raise ValueError(
                "aadhaar_last4 must be at most 4 digits. "
                "Full Aadhaar numbers are never stored. "
                f"Received {len(s)} characters: provide only the last 4 digits."
            )
        if not s.isdigit():
            raise ValueError(
                f"aadhaar_last4 must contain digits only, got: {s!r}"
            )
        return s

    @field_validator("pincode", mode="before")
    @classmethod
    def validate_pincode(cls, v: object) -> object:
        """Digits only, exactly 6 characters."""
        if v is None:
            return v
        s = str(v).strip()
        if not s.isdigit() or len(s) != 6:
            raise ValueError(
                f"pincode must be exactly 6 digits, got: {s!r}"
            )
        return s


# ---------------------------------------------------------------------------
# Endpoint models
# ---------------------------------------------------------------------------


# ---------- a) POST /api/documents/extract ----------------------------------

class ExtractResponse(BaseModel):
    """
    Response body for POST /api/documents/extract.

    The request itself is a multipart/form-data file upload and has no
    corresponding Pydantic model.
    """

    profile: CitizenProfile = Field(
        description="Extracted citizen profile (may have None fields).",
    )
    uncertain_fields: list[str] = Field(
        default_factory=list,
        description="Mirror of CitizenProfile.uncertain_fields for quick UI access.",
    )
    raw_text_preview: Optional[str] = Field(
        default=None,
        description="First ~500 chars of raw OCR/parsed text for debugging.",
    )


# ---------- b) POST /api/eligibility ----------------------------------------

class EligibilityRequest(BaseModel):
    """Request body for POST /api/eligibility."""

    profile: CitizenProfile = Field(
        description="The (optionally user-verified) citizen profile.",
    )
    service_id: str = Field(
        description="Service ID string (e.g. '1784') for the target government form.",
    )


class RuleResult(BaseModel):
    """Outcome of a single deterministic eligibility rule."""

    rule_id: str = Field(
        description="Short identifier for the rule (e.g. 'income_ceiling').",
    )
    description: str = Field(
        description="Human-readable rule description shown in the UI.",
    )
    passed: bool = Field(
        description="True if the citizen satisfies this rule.",
    )
    explanation: str = Field(
        description="Why the rule passed or failed (shown to the citizen).",
    )


class EligibilityResponse(BaseModel):
    """Response body for POST /api/eligibility."""

    eligible: bool = Field(
        description="True only if ALL rules passed.",
    )
    service_name: str = Field(
        description="Human-readable name of the government service.",
    )
    results: list[RuleResult] = Field(
        default_factory=list,
        description="Per-rule breakdown; empty list means no rules were checked.",
    )
    summary: str = Field(
        description="One-sentence plain-English eligibility verdict.",
    )


# ---------- c) POST /api/apply/start ----------------------------------------

class ApplyStartRequest(BaseModel):
    """Request body for POST /api/apply/start."""

    profile: CitizenProfile = Field(
        description="User-verified citizen profile to pre-fill the form.",
    )
    service_id: str = Field(
        description="Service ID string identifying the target government form.",
    )
    document_filename: Optional[str] = Field(
        default=None,
        description="Filename of the uploaded document (for the agent to attach, if needed).",
    )


class ApplyStartResponse(BaseModel):
    """Response body for POST /api/apply/start."""

    session_id: str = Field(
        description="Unique identifier for this browser-agent session.",
    )
    status: AgentStatus = Field(
        description="Current lifecycle state of the agent.",
    )
    message: str = Field(
        description="Human-readable status message.",
    )
    captcha_image_b64: Optional[str] = Field(
        default=None,
        description="Base-64 encoded PNG of the CAPTCHA (set when status=awaiting_captcha).",
    )
    page_preview_b64: Optional[str] = Field(
        default=None,
        description="Base-64 encoded screenshot of the current browser page.",
    )
    steps_completed: list[str] = Field(
        default_factory=list,
        description="Ordered list of form-filling steps the agent has finished.",
    )


# ---------- d) POST /api/apply/resume ---------------------------------------

class ApplyResumeRequest(BaseModel):
    """Request body for POST /api/apply/resume."""

    session_id: str = Field(
        description="Session ID returned by /api/apply/start.",
    )
    captcha_text: str = Field(
        description="CAPTCHA answer typed by the citizen in the UI.",
    )
    approve: bool = Field(
        description="True = citizen confirms submission; False = abort.",
    )
    submit_final: bool = Field(
        default=False,
        description="True = actually click the portal submit button; False = Safety Review pause.",
    )


class ApplyResumeResponse(BaseModel):
    """Response body for POST /api/apply/resume."""

    session_id: str = Field(
        description="Echo of the session ID.",
    )
    status: AgentStatus = Field(
        description="Final lifecycle state after resume attempt.",
    )
    message: str = Field(
        description="Human-readable result message.",
    )
    tracking_receipt: Optional[str] = Field(
        default=None,
        description="Government-issued tracking / acknowledgement number (set on success).",
    )
    final_screenshot_b64: Optional[str] = Field(
        default=None,
        description="Base-64 encoded PNG of the final confirmation page.",
    )


# ---------- e) Google Vault — POST /api/documents/google-search & google-fetch

class VaultCandidate(BaseModel):
    """A single file candidate found in Google Drive or Gmail."""

    id: str = Field(
        description="File ID (Drive file ID or Gmail messageId/attachmentId composite).",
    )
    name: str = Field(
        description="Original filename (e.g. 'Income_Certificate_2025.pdf').",
    )
    source: str = Field(
        description="Where the file was found: 'Google Drive' or 'Gmail'.",
    )
    mime_type: str = Field(
        description="MIME type of the file (e.g. 'application/pdf').",
    )
    size_kb: Optional[float] = Field(
        default=None,
        description="File size in kilobytes (may be None if unknown).",
    )
    modified_date: Optional[str] = Field(
        default=None,
        description="Last modified date in YYYY-MM-DD format (may be None).",
    )


class GoogleSearchRequest(BaseModel):
    """Request body for POST /api/documents/google-search."""

    query: str = Field(
        description="Search keyword (e.g. 'income certificate', 'marksheet').",
    )
    access_token: Optional[str] = Field(
        default=None,
        description="OAuth2 access_token from the Google sign-in popup.",
    )
    demo_mode: bool = Field(
        default=False,
        description="If True, returns synthetic demo candidates without calling Google APIs.",
    )


class GoogleSearchResponse(BaseModel):
    """Response body for POST /api/documents/google-search."""

    query: str = Field(
        description="Echo of the search query.",
    )
    candidates: list[VaultCandidate] = Field(
        default_factory=list,
        description="List of matching files the citizen can pick from.",
    )


class GoogleFetchRequest(BaseModel):
    """Request body for POST /api/documents/google-fetch."""

    file_id: str = Field(
        description="ID of the file to download (from VaultCandidate.id).",
    )
    source: str = Field(
        default="drive",
        description="Source of the file: 'drive' or 'gmail'.",
    )
    access_token: Optional[str] = Field(
        default=None,
        description="OAuth2 access_token from the Google sign-in popup.",
    )
    demo_mode: bool = Field(
        default=False,
        description="If True, generates a synthetic PDF without calling Google APIs.",
    )


# ---------- compressor.prepare_for_upload return type ----------------------

class PreparedFile(BaseModel):
    """
    Result of compressor.prepare_for_upload().

    Member 1 (browser agent) calls prepare_for_upload() and uses final_path
    to attach the document to the portal form. Member 3 shows original_bytes,
    final_bytes, message and warnings in the confirmation UI.
    """

    final_path: str = Field(
        description=(
            "Absolute path of the file to upload. "
            "Equals the original path when compressed=False, otherwise a "
            "uuid-named copy inside backend/uploads/."
        ),
    )
    original_bytes: int = Field(
        description="Size of the original file in bytes.",
    )
    final_bytes: int = Field(
        description="Size of the file at final_path in bytes.",
    )
    compressed: bool = Field(
        description="True when a compressed copy was produced.",
    )
    converted: bool = Field(
        description="True when the file type was changed (e.g. PNG → PDF).",
    )
    method_used: str = Field(
        description=(
            "Short label describing what was done: "
            "'none', 'pymupdf', 'pymupdf_render_150dpi', "
            "'ghostscript:/printer', 'ghostscript:/ebook', 'ghostscript:/screen', "
            "'pillow_quality_75', 'pillow_resize_90pct', etc."
        ),
    )
    fits: bool = Field(
        description="True when final_bytes <= max_bytes.",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description=(
            "Non-fatal issues: e.g. Ghostscript not installed, "
            "signed PDF detected, readability degraded, page cap hit."
        ),
    )
    message: str = Field(
        description=(
            "Plain-English sentence suitable for showing to the citizen, "
            "e.g. 'Your file was reduced from 2.4 MB to 180 KB using PyMuPDF.'"
        ),
    )


# ---------- g) POST /api/intent/classify ------------------------------------


class IntentClassifyRequest(BaseModel):
    """Request body for POST /api/intent/classify."""

    text: str = Field(
        description="The citizen's typed prompt or transcribed voice query.",
        examples=["I want to apply for student scholarship", "किसान सम्मान निधि योजना"],
    )


class IntentClassifyResponse(BaseModel):
    """Response body for POST /api/intent/classify."""

    matched_service_id: str = Field(
        description="Matched service identifier (e.g. '1784', 'vidyalakshmi', 'pm_kisan', 'ration_card', 'citizen_registration').",
    )
    service_name: str = Field(
        description="Human-readable title of the government scheme or portal service.",
    )
    confidence: float = Field(
        description="Confidence score between 0.0 and 1.0.",
    )
    explanation: str = Field(
        description="Brief explanation of why this service was matched.",
    )
    suggested_documents: list[str] = Field(
        default_factory=list,
        description="Key documents recommended to fetch or upload for this scheme.",
    )
