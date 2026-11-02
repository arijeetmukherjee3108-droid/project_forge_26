"""
browser_agent.py — Autonomous Vision-Guided Playwright Browser Engine
======================================================================
Launches a visible Chromium browser on any real government portal and uses
the Vision LLM to navigate, fill forms, and interact — zero hardcoded
selectors, zero mocks.

Architecture:
  1. start_application() → launches Chromium, navigates to real portal URL.
  2. Runs vision_agent.run_vision_loop() — a screenshot → LLM → action loop.
  3. Pauses at OTP, CAPTCHA, subjective choices, or final submit.
  4. resume_after_human() → resumes the vision loop after human input.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from playwright.async_api import (
    Page,
    async_playwright,
    Browser,
    BrowserContext,
    Playwright,
)

try:
    from app.vision_agent import run_vision_loop
    from app.schemas import (
        AgentStatus,
        ApplyStartResponse,
        ApplyResumeResponse,
        CitizenProfile,
    )
except ImportError:
    from backend.app.vision_agent import run_vision_loop
    from backend.app.schemas import (
        AgentStatus,
        ApplyStartResponse,
        ApplyResumeResponse,
        CitizenProfile,
    )

logger = logging.getLogger(__name__)

# Upload directory where the extractor saves incoming documents.
_UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"


# ---------------------------------------------------------------------------
# Session dataclass
# ---------------------------------------------------------------------------

@dataclass
class BrowserSession:
    """Holds all live Playwright handles for one agent run."""

    session_id: str
    pw: Playwright
    browser: Browser
    context: BrowserContext
    page: Page
    profile: CitizenProfile
    target_goal: str = ""
    status: AgentStatus = AgentStatus.running
    steps_completed: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    document_path: Optional[str] = None
    latest_screenshot_b64: Optional[str] = None
    citizen_guidance: str = ""
    citizen_guidance_hindi: str = ""
    message: str = ""
    vision_task: Optional[asyncio.Task] = None


# In-memory session store — safe for a single-process hackathon demo.
_active_sessions: Dict[str, BrowserSession] = {}


def get_session(session_id: str) -> BrowserSession:
    """Retrieve an active session or raise KeyError."""
    if session_id not in _active_sessions:
        raise KeyError(f"No active session with id '{session_id}'")
    return _active_sessions[session_id]


async def close_session(session_id: str) -> None:
    """Gracefully tear down browser handles, clean up temp files, and remove session."""
    session = _active_sessions.pop(session_id, None)
    if session is None:
        return

    # Clean up temporary uploaded file if within uploads directory
    if session.document_path:
        try:
            doc_path = Path(session.document_path).resolve()
            uploads_dir = _UPLOADS_DIR.resolve()
            if doc_path.exists() and uploads_dir in doc_path.parents:
                doc_path.unlink(missing_ok=True)
                logger.info("Cleaned up temp document %s", session.document_path)
        except Exception as exc:
            logger.warning("Failed to clean up temp document %s: %s", session.document_path, exc)

    try:
        await session.browser.close()
    except Exception:
        logger.warning("Browser already closed for session %s", session_id)
    try:
        await session.pw.stop()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Screenshot helper
# ---------------------------------------------------------------------------

async def _screenshot_page_b64(page: Page) -> Optional[str]:
    """Capture the full viewport as a Base64-encoded JPEG."""
    try:
        jpg_bytes = await page.screenshot(type="jpeg", quality=75, full_page=False)
        return base64.b64encode(jpg_bytes).decode()
    except Exception as exc:
        logger.warning("Could not take page screenshot: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Portal URL Resolution
# ---------------------------------------------------------------------------

# Known portal entry URLs for common service IDs
_KNOWN_PORTAL_URLS: Dict[str, str] = {
    "1784": "https://serviceonline.gov.in/citizenRegistration.html",
    "serviceplus": "https://serviceonline.gov.in/citizenRegistration.html",
    "citizen_registration": "https://serviceonline.gov.in/citizenRegistration.html",
    "vidyalakshmi": "https://www.vidyalakshmi.co.in/Students/",
    "digilocker": "https://www.digilocker.gov.in/",
    "digilocker_apaar": "https://www.digilocker.gov.in/",
    "apaar": "https://www.digilocker.gov.in/",
    "pmkisan": "https://pmkisan.gov.in/",
    "pm_kisan": "https://pmkisan.gov.in/",
    "ayushman_bharat": "https://beneficiary.nha.gov.in/",
    "nsp": "https://scholarships.gov.in/",
}

# Known target goal descriptions for common service IDs
_KNOWN_GOALS: Dict[str, str] = {
    "1784": "Register as a new citizen on ServicePlus portal by filling the registration form with name, email, mobile, password, and state.",
    "serviceplus": "Register as a new citizen on ServicePlus portal.",
    "citizen_registration": "Complete citizen self-registration on ServicePlus.",
    "vidyalakshmi": "Register as a new student on Vidya Lakshmi education loan portal.",
    "digilocker": "Sign in or register on DigiLocker and navigate to the requested service.",
    "digilocker_apaar": "Sign in to DigiLocker, navigate to APAAR / Academic Bank of Credits, and fill the APAAR ID issuance form.",
    "apaar": "Sign in to DigiLocker and apply for APAAR / ABC student ID.",
    "pmkisan": "Register or check status on PM-KISAN farmer portal.",
    "ayushman_bharat": "Check eligibility or register on Ayushman Bharat PM-JAY portal.",
    "nsp": "Register or apply for scholarship on National Scholarship Portal.",
}


def _resolve_portal_url(service_id: str, profile: CitizenProfile) -> str:
    """Resolve the real government portal entry URL from service_id or profile."""
    sid = service_id.strip().lower()

    # 1. If service_id is already a full URL, use it directly
    if sid.startswith(("http://", "https://")):
        return service_id.strip()

    # 2. Check profile's explicit portal URL
    portal_url = getattr(profile, "target_portal_url", None)
    if portal_url and portal_url.startswith(("http://", "https://")):
        # Reject mock/local file URLs
        if "mock" not in portal_url.lower() and "file://" not in portal_url:
            return portal_url

    # 3. Look up in known portals
    if sid in _KNOWN_PORTAL_URLS:
        return _KNOWN_PORTAL_URLS[sid]

    # 4. Default: try to construct a .gov.in URL
    return f"https://{sid}.gov.in"


def _resolve_target_goal(service_id: str, profile: CitizenProfile) -> str:
    """Determine the target goal description for the vision agent."""
    sid = service_id.strip().lower()

    if sid in _KNOWN_GOALS:
        return _KNOWN_GOALS[sid]

    # Build a generic goal from profile metadata
    service_name = getattr(profile, "target_service_id", None) or service_id
    return f"Navigate and complete the application/registration process on the {service_name} government portal."


# ---------------------------------------------------------------------------
# Public API: start_application
# ---------------------------------------------------------------------------

async def start_application(
    profile: CitizenProfile,
    service_id: str,
    document_filename: Optional[str] = None,
) -> ApplyStartResponse:
    """
    Launch a visible Chromium browser, navigate to the real government portal,
    and run the autonomous Vision-Guided Agent loop.
    """
    session_id = uuid.uuid4().hex[:12]

    # Resolve document path
    doc_path: Optional[str] = None
    if document_filename:
        candidate = _UPLOADS_DIR / document_filename
        if candidate.exists():
            doc_path = str(candidate)

    # Resolve portal URL and target goal
    entry_url = _resolve_portal_url(service_id, profile)
    target_goal = _resolve_target_goal(service_id, profile)

    # Determine headless mode from environment
    headless_env = os.getenv("BROWSER_HEADLESS")
    if headless_env is not None:
        headless = headless_env.lower() in ("1", "true", "yes")
    else:
        headless = True if (sys.platform != "win32" or not os.environ.get("DISPLAY")) else False

    pw = await async_playwright().start()

    try:
        browser = await pw.chromium.launch(
            headless=headless,
            slow_mo=80,
        )
        context = await browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 1280, "height": 850},
        )
        page = await context.new_page()

        session = BrowserSession(
            session_id=session_id,
            pw=pw,
            browser=browser,
            context=context,
            page=page,
            profile=profile,
            target_goal=target_goal,
            document_path=doc_path,
        )
        _active_sessions[session_id] = session

        # Navigate to the real government portal
        session.steps_completed.append("🚀 Launching visible Chromium browser...")
        session.steps_completed.append(f"🌐 Navigating to: {entry_url}")

        try:
            resp = await page.goto(entry_url, timeout=20000, wait_until="domcontentloaded")
            if resp and resp.status >= 400:
                session.status = AgentStatus.failed
                session.steps_completed.append(f"❌ Portal returned HTTP {resp.status}")
                preview = await _screenshot_page_b64(page)
                return ApplyStartResponse(
                    session_id=session_id,
                    status=session.status,
                    message=f"Government portal returned error (HTTP {resp.status}).",
                    page_preview_b64=preview,
                    steps_completed=list(session.steps_completed),
                )
        except Exception as nav_err:
            session.status = AgentStatus.failed
            session.steps_completed.append(f"❌ Could not reach portal: {nav_err}")
            return ApplyStartResponse(
                session_id=session_id,
                status=session.status,
                message=f"Government portal is unreachable: {nav_err}",
                steps_completed=list(session.steps_completed),
            )

        session.steps_completed.append(f"✅ Portal loaded: {await page.title()}")
        session.steps_completed.append(f"🎯 Target Goal: {target_goal}")
        session.steps_completed.append("🤖 Starting autonomous Vision-Guided Agent...")

        # Wait for initial page render
        await asyncio.sleep(1.5)

        # Define the on_step callback for real-time session updates
        async def _on_step(step_log: str, screenshot_b64: Optional[str] = None, guidance: str = "", guidance_hi: str = ""):
            session.steps_completed.append(step_log)
            if screenshot_b64:
                session.latest_screenshot_b64 = screenshot_b64
            if guidance:
                session.citizen_guidance = guidance
            if guidance_hi:
                session.citizen_guidance_hindi = guidance_hi

        # Background task that runs the vision loop
        async def _run_vision_background():
            try:
                result = await run_vision_loop(
                    page=page,
                    profile=profile,
                    target_goal=target_goal,
                    on_step=_on_step,
                )
                # Merge final steps
                session.steps_completed.extend(result.get("steps_completed", []))
                session.citizen_guidance = result.get("citizen_guidance", session.citizen_guidance)
                session.citizen_guidance_hindi = result.get("citizen_guidance_hindi", session.citizen_guidance_hindi)

                # Map vision agent status to AgentStatus
                vision_status = result.get("status", "error")
                reason = result.get("reason_for_pause", "")

                if vision_status == "done":
                    session.status = AgentStatus.ready_to_submit
                    session.message = "✅ Form fully filled! Paused before final submission for your review."
                elif vision_status == "otp_checkpoint":
                    session.status = AgentStatus.awaiting_login
                    session.message = f"⏸️ OTP Required: {reason}"
                elif vision_status == "captcha_checkpoint":
                    session.status = AgentStatus.awaiting_captcha
                    session.message = f"⏸️ CAPTCHA Detected: {reason}"
                elif vision_status == "subjective_checkpoint":
                    session.status = AgentStatus.awaiting_user_selection
                    session.message = f"⏸️ Your Input Needed: {reason}"
                elif vision_status == "max_turns":
                    session.status = AgentStatus.awaiting_user_selection
                    session.message = f"⚠️ Agent needs guidance: {reason}"
                else:
                    session.status = AgentStatus.failed
                    session.message = f"❌ Agent error: {reason}"

                # Capture final screenshot
                try:
                    session.latest_screenshot_b64 = await _screenshot_page_b64(page)
                except Exception:
                    pass
            except Exception as exc:
                logger.exception("Vision loop background task failed")
                session.status = AgentStatus.failed
                session.message = f"❌ Agent error: {exc}"

        # Launch vision loop as background task
        session.vision_task = asyncio.create_task(_run_vision_background())

        # Return immediately with running status
        preview = await _screenshot_page_b64(page)

        return ApplyStartResponse(
            session_id=session_id,
            status=AgentStatus.running,
            message="🤖 Vision Agent started. Monitoring live progress...",
            page_preview_b64=preview,
            steps_completed=list(session.steps_completed),
        )

    except Exception as exc:
        logger.exception("start_application failed")
        await close_session(session_id)
        return ApplyStartResponse(
            session_id=session_id,
            status=AgentStatus.failed,
            message=f"Agent error: {exc}",
        )


# ---------------------------------------------------------------------------
# Public API: resume_after_human
# ---------------------------------------------------------------------------

async def resume_after_human(
    session_id: str,
    captcha_text: Optional[str] = None,
) -> ApplyResumeResponse:
    """
    Resume the vision agent after the human has completed their input
    (OTP entry, CAPTCHA solve, dropdown selection, etc.) on the live browser.

    The agent takes a fresh screenshot and continues the vision loop.
    """
    try:
        session = get_session(session_id)
    except KeyError:
        return ApplyResumeResponse(
            session_id=session_id,
            status=AgentStatus.failed,
            message=f"No active session '{session_id}' — it may have expired.",
        )

    page = session.page
    profile = session.profile

    # If captcha text was provided, try to fill it into the active CAPTCHA input
    if captcha_text:
        try:
            captcha_selectors = [
                "input[name*='captcha']", "input[id*='captcha']",
                "#captchaAnswer", "#txtCaptcha", "#inpCaptcha",
            ]
            for sel in captcha_selectors:
                try:
                    el = await page.wait_for_selector(sel, state="visible", timeout=1500)
                    if el:
                        await el.fill("")
                        await el.type(captcha_text, delay=50)
                        session.steps_completed.append(f"📝 Entered CAPTCHA: {captcha_text}")
                        break
                except Exception:
                    continue
        except Exception as exc:
            logger.warning("Could not fill captcha text: %s", exc)

    session.steps_completed.append("🔄 Human input completed. Resuming Vision Agent...")

    # Wait a moment for any page transitions triggered by human input
    await asyncio.sleep(1.5)

    # Define the on_step callback for real-time session updates
    async def _on_step(step_log: str, screenshot_b64: Optional[str] = None, guidance: str = "", guidance_hi: str = ""):
        session.steps_completed.append(step_log)
        if screenshot_b64:
            session.latest_screenshot_b64 = screenshot_b64
        if guidance:
            session.citizen_guidance = guidance
        if guidance_hi:
            session.citizen_guidance_hindi = guidance_hi

    async def _run_resume_background():
        try:
            result = await run_vision_loop(
                page=page,
                profile=profile,
                target_goal=session.target_goal,
                on_step=_on_step,
            )
            session.steps_completed.extend(result.get("steps_completed", []))
            session.citizen_guidance = result.get("citizen_guidance", session.citizen_guidance)
            session.citizen_guidance_hindi = result.get("citizen_guidance_hindi", session.citizen_guidance_hindi)

            vision_status = result.get("status", "error")
            reason = result.get("reason_for_pause", "")

            if vision_status == "done":
                session.status = AgentStatus.ready_to_submit
                session.message = "✅ Form fully filled! Paused before final submission for your review."
            elif vision_status == "otp_checkpoint":
                session.status = AgentStatus.awaiting_login
                session.message = f"⏸️ OTP Required: {reason}"
            elif vision_status == "captcha_checkpoint":
                session.status = AgentStatus.awaiting_captcha
                session.message = f"⏸️ CAPTCHA Detected: {reason}"
            elif vision_status == "subjective_checkpoint":
                session.status = AgentStatus.awaiting_user_selection
                session.message = f"⏸️ Your Input Needed: {reason}"
            elif vision_status == "max_turns":
                session.status = AgentStatus.awaiting_user_selection
                session.message = f"⚠️ Agent needs guidance: {reason}"
            else:
                session.status = AgentStatus.failed
                session.message = f"❌ Agent error: {reason}"

            try:
                session.latest_screenshot_b64 = await _screenshot_page_b64(page)
            except Exception:
                pass
        except Exception as exc:
            logger.exception("Vision loop resume background task failed")
            session.status = AgentStatus.failed
            session.message = f"❌ Agent error: {exc}"

    session.status = AgentStatus.running
    session.vision_task = asyncio.create_task(_run_resume_background())

    preview = await _screenshot_page_b64(page)

    return ApplyResumeResponse(
        session_id=session_id,
        status=AgentStatus.running,
        message="🔄 Vision Agent resumed. Monitoring live progress...",
        final_screenshot_b64=preview,
        steps_completed=list(session.steps_completed),
    )


# ---------------------------------------------------------------------------
# Legacy compatibility wrappers (referenced by main.py and frontend)
# ---------------------------------------------------------------------------

async def resume_application(
    session_id: str,
    captcha_text: str = "",
    approve: bool = True,
    submit_final: bool = False,
    keep_open_seconds: int = 0,
    close_browser: bool = False,
) -> ApplyResumeResponse:
    """
    Legacy resume endpoint — wraps resume_after_human.
    Does NOT auto-submit. The citizen must click submit themselves.
    """
    if not approve:
        try:
            session = get_session(session_id)
            session.status = AgentStatus.failed
        except KeyError:
            pass
        await close_session(session_id)
        return ApplyResumeResponse(
            session_id=session_id,
            status=AgentStatus.failed,
            message="User chose not to approve. Session closed.",
        )

    return await resume_after_human(session_id, captcha_text=captcha_text or None)


async def navigate_digilocker_apaar(session_id: str) -> ApplyStartResponse:
    """Legacy: Resume vision loop for DigiLocker APAAR after login."""
    try:
        session = get_session(session_id)
    except KeyError:
        return ApplyStartResponse(
            session_id=session_id,
            status=AgentStatus.failed,
            message=f"No active session '{session_id}' — it may have expired.",
        )

    session.steps_completed.append("🔄 Login completed. Resuming Vision Agent for APAAR navigation...")
    await asyncio.sleep(1.5)

    result = await run_vision_loop(
        page=session.page,
        profile=session.profile,
        target_goal=session.target_goal or "Navigate to APAAR ID issuance form and fill it.",
    )

    session.steps_completed.extend(result.get("steps_completed", []))

    vision_status = result.get("status", "error")
    reason = result.get("reason_for_pause", "")

    status_map = {
        "done": AgentStatus.ready_to_submit,
        "otp_checkpoint": AgentStatus.awaiting_login,
        "captcha_checkpoint": AgentStatus.awaiting_captcha,
        "subjective_checkpoint": AgentStatus.awaiting_user_selection,
        "max_turns": AgentStatus.awaiting_user_selection,
    }
    session.status = status_map.get(vision_status, AgentStatus.failed)

    preview = await _screenshot_page_b64(session.page)
    return ApplyStartResponse(
        session_id=session_id,
        status=session.status,
        message=reason or f"Vision agent status: {vision_status}",
        page_preview_b64=preview,
        steps_completed=list(session.steps_completed),
    )


async def autofill_digilocker_apaar(session_id: str, selected_board: Optional[str] = None) -> ApplyResumeResponse:
    """Legacy: Resume vision loop after human-in-the-loop selection."""
    return await resume_after_human(session_id)


async def get_browser_session_status(session_id: str) -> dict:
    """Checks current URL and state of live browser session."""
    try:
        session = get_session(session_id)
        current_url = session.page.url

        # Return the latest screenshot captured during the vision loop (prevents browser viewport flickering)
        preview = session.latest_screenshot_b64

        return {
            "session_id": session_id,
            "status": session.status.value if hasattr(session.status, "value") else str(session.status),
            "current_url": current_url,
            "is_logged_in": "login" not in current_url.lower() and "signin" not in current_url.lower(),
            "steps_completed": list(session.steps_completed),
            "page_preview_b64": preview,
            "citizen_guidance": session.citizen_guidance,
            "citizen_guidance_hindi": session.citizen_guidance_hindi,
            "message": session.message,
        }
    except KeyError:
        return {
            "session_id": session_id,
            "status": "not_found",
            "current_url": "",
            "is_logged_in": False,
            "steps_completed": [],
            "page_preview_b64": None,
            "citizen_guidance": "",
            "citizen_guidance_hindi": "",
            "message": "",
        }
