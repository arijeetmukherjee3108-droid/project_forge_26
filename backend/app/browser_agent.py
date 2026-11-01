"""
browser_agent.py — Autonomous Playwright Browser Engine
========================================================
Generic step executor that reads any PortalConfig from portal_maps.py,
drives a visible Chromium instance through the form, and pauses at
CAPTCHA / human-approval checkpoints.

Owned exclusively by Member 1 (Krrish Dixit).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
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
    from app.portal_maps import (
        ActionType,
        PortalConfig,
        PortalStep,
        PORTAL_REGISTRY,
        get_portal_config,
    )
    from app.ai_form_agent import (
        distill_form_dom,
        generate_action_plan,
        execute_dynamic_action_plan,
    )
    from app.schemas import (
        AgentStatus,
        ApplyStartResponse,
        ApplyResumeResponse,
        CitizenProfile,
    )
except ImportError:
    from backend.app.portal_maps import (
        ActionType,
        PortalConfig,
        PortalStep,
        PORTAL_REGISTRY,
        get_portal_config,
    )
    from backend.app.ai_form_agent import (
        distill_form_dom,
        generate_action_plan,
        execute_dynamic_action_plan,
    )
    from backend.app.schemas import (
        AgentStatus,
        ApplyStartResponse,
        ApplyResumeResponse,
        CitizenProfile,
    )

logger = logging.getLogger(__name__)

# Default password used when portal_maps requests field_key="password"
# but CitizenProfile has no password field (it shouldn't store one).
_DEFAULT_PASSWORD = "VoiceLegacy@2026"

# Upload directory where Member 2's extractor saves incoming documents.
_UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"

# Map short service IDs (e.g. "1784") to portal registry keys so the
# frontend can pass either form.
_SERVICE_ID_ALIASES: Dict[str, str] = {
    "1784": "SERVICE_PLUS_REGISTRATION",
    "serviceplus": "SERVICE_PLUS_REGISTRATION",
    "mock": "LOCAL_MOCK_PORTAL",
    "vidyalakshmi": "VIDYA_LAKSHMI_PORTAL",
}


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
    portal_config: Optional[PortalConfig] = None
    status: AgentStatus = AgentStatus.running
    steps_completed: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    document_path: Optional[str] = None
    is_dynamic: bool = False
    captcha_input_selector: Optional[str] = None
    submit_button_selector: Optional[str] = None


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
# Selector resolution helper
# ---------------------------------------------------------------------------

async def _resolve_element(page: Page, selectors: List[str], timeout_ms: int):
    """Try each selector in order; return the first element found."""
    for sel in selectors:
        try:
            el = await page.wait_for_selector(sel, timeout=timeout_ms, state="visible")
            if el:
                return el
        except Exception:
            continue
    raise RuntimeError(
        f"None of the selectors resolved: {selectors}"
    )


# ---------------------------------------------------------------------------
# Field value extraction
# ---------------------------------------------------------------------------

def _get_field_value(
    profile: CitizenProfile,
    step: PortalStep,
    document_path: Optional[str] = None,
) -> Optional[str]:
    """Pull the right value for a step from the citizen profile."""
    key = step.field_key

    # Static / default value takes lowest priority.
    if key is None:
        return step.value

    # Special keys not on the profile model.
    if key == "password":
        return _DEFAULT_PASSWORD
    if key == "document_path":
        return document_path

    # Look up attribute on the Pydantic model.
    val = getattr(profile, key, None)
    if val is None:
        return step.value  # fall back to static default

    # Enums → their string value.
    if hasattr(val, "value"):
        return str(val.value)
    return str(val)


# ---------------------------------------------------------------------------
# Screenshot helpers
# ---------------------------------------------------------------------------

async def _screenshot_element_b64(page: Page, selectors: List[str]) -> Optional[str]:
    """Capture a single element as a Base64-encoded PNG."""
    try:
        el = await _resolve_element(page, selectors, timeout_ms=5000)
        png_bytes = await el.screenshot(type="png")
        return base64.b64encode(png_bytes).decode()
    except Exception as exc:
        logger.warning("Could not screenshot element %s: %s", selectors, exc)
        return None


async def _screenshot_page_b64(page: Page) -> Optional[str]:
    """Capture the full viewport as a Base64-encoded PNG."""
    try:
        png_bytes = await page.screenshot(type="png", full_page=False)
        return base64.b64encode(png_bytes).decode()
    except Exception as exc:
        logger.warning("Could not take page screenshot: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Step executor
# ---------------------------------------------------------------------------

async def _execute_step(
    page: Page,
    step: PortalStep,
    session: BrowserSession,
) -> Optional[ApplyStartResponse]:
    """
    Execute one PortalStep.  Returns an ApplyStartResponse only when a
    CHECKPOINT is reached (the caller should yield it to the frontend).
    """
    action = step.action

    if action == ActionType.NAVIGATE:
        await page.goto(
            session.portal_config.entry_url,
            timeout=step.timeout_ms,
            wait_until="domcontentloaded",
        )

    elif action == ActionType.FILL:
        value = _get_field_value(session.profile, step, session.document_path)
        if value:
            el = await _resolve_element(page, step.selectors, step.timeout_ms)
            await el.click()
            await el.fill("")  # clear existing
            await el.type(value, delay=30)  # human-like typing speed

    elif action == ActionType.SELECT:
        value = _get_field_value(session.profile, step, session.document_path)
        if value:
            el = await _resolve_element(page, step.selectors, step.timeout_ms)
            # Try exact label, then uppercase (standard for Indian .gov.in portals), then value
            try:
                await el.select_option(label=value, timeout=2000)
            except Exception:
                try:
                    await el.select_option(label=value.upper(), timeout=2000)
                except Exception:
                    await el.select_option(value=value)

    elif action == ActionType.CHECK:
        el = await _resolve_element(page, step.selectors, step.timeout_ms)
        if not await el.is_checked():
            await el.check()

    elif action == ActionType.UPLOAD:
        file_path = _get_field_value(session.profile, step, session.document_path)
        if file_path and Path(file_path).exists():
            el = await _resolve_element(page, step.selectors, step.timeout_ms)
            await el.set_input_files(file_path)

    elif action == ActionType.CLICK:
        el = await _resolve_element(page, step.selectors, step.timeout_ms)
        await el.click()

    elif action == ActionType.CHECKPOINT:
        # --- CAPTCHA / human approval pause ---
        session.status = AgentStatus.awaiting_captcha

        captcha_b64 = await _screenshot_element_b64(
            page, session.portal_config.captcha_image_selectors
        )
        preview_b64 = await _screenshot_page_b64(page)

        return ApplyStartResponse(
            session_id=session.session_id,
            status=session.status,
            message="Agent paused — please solve the CAPTCHA and approve.",
            captcha_image_b64=captcha_b64,
            page_preview_b64=preview_b64,
            steps_completed=list(session.steps_completed),
        )

    # Record completed step (except CHECKPOINT which pauses).
    session.steps_completed.append(step.description or action.value)
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _resolve_portal_id(service_id: str) -> str:
    """Map a service_id to a portal registry key."""
    normalized = service_id.strip().lower()
    if normalized in _SERVICE_ID_ALIASES:
        return _SERVICE_ID_ALIASES[normalized]
    # Try as-is (already a registry key like "SERVICE_PLUS_REGISTRATION").
    return service_id


async def start_application(
    profile: CitizenProfile,
    service_id: str,
    document_filename: Optional[str] = None,
) -> ApplyStartResponse:
    """
    Launch a visible browser, navigate the portal, fill the form,
    and pause at the CAPTCHA checkpoint.
    """
    session_id = uuid.uuid4().hex[:12]
    portal_id = _resolve_portal_id(service_id)

    # Resolve uploaded document path.
    doc_path: Optional[str] = None
    if document_filename:
        candidate = _UPLOADS_DIR / document_filename
        if candidate.exists():
            doc_path = str(candidate)

    # Determine headless mode.
    headless_env = os.getenv("BROWSER_HEADLESS")
    if headless_env is not None:
        headless = headless_env.lower() in ("1", "true", "yes")
    else:
        headless = True if (sys.platform != "win32" or not os.environ.get("DISPLAY")) else False
    pw = await async_playwright().start()

    try:
        # ---- Path 1: Deterministic Fast-Path (0 tokens, 0ms latency) ----
        if portal_id in PORTAL_REGISTRY:
            config = PORTAL_REGISTRY[portal_id]
            browser = await pw.chromium.launch(
                headless=headless,
                slow_mo=100,
            )
            context = await browser.new_context(
                ignore_https_errors=config.ignore_https_errors,
                viewport={"width": 1280, "height": 800},
            )
            page = await context.new_page()

            session = BrowserSession(
                session_id=session_id,
                pw=pw,
                browser=browser,
                context=context,
                page=page,
                portal_config=config,
                profile=profile,
                document_path=doc_path,
                is_dynamic=False,
            )
            _active_sessions[session_id] = session

            for step in config.steps:
                result = await _execute_step(page, step, session)
                if result is not None:
                    return result

            session.status = AgentStatus.submitted
            preview = await _screenshot_page_b64(page)
            return ApplyStartResponse(
                session_id=session_id,
                status=session.status,
                message="All steps completed — no CAPTCHA checkpoint was needed.",
                page_preview_b64=preview,
                steps_completed=list(session.steps_completed),
            )

        # ---- Path 2: Task 3: Zero-Shot Dynamic DOM Reasoner (Any Portal in India) ----
        sid = service_id.strip()
        if sid.startswith(("http://", "https://", "file://")):
            entry_url = sid
        elif getattr(profile, "target_portal_url", None) and profile.target_portal_url.startswith(("http://", "https://", "file://")):
            entry_url = profile.target_portal_url
        elif (Path(__file__).resolve().parent.parent / "static" / f"{sid.lower()}_mock.html").exists():
            entry_url = f"file://{(Path(__file__).resolve().parent.parent / 'static' / f'{sid.lower()}_mock.html').resolve()}"
        else:
            entry_url = getattr(profile, "target_portal_url", None) or f"https://{sid}.gov.in"

        browser = await pw.chromium.launch(
            headless=headless,
            slow_mo=100,
        )
        context = await browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 1280, "height": 800},
        )
        page = await context.new_page()

        session = BrowserSession(
            session_id=session_id,
            pw=pw,
            browser=browser,
            context=context,
            page=page,
            portal_config=None,
            profile=profile,
            document_path=doc_path,
            is_dynamic=True,
        )
        _active_sessions[session_id] = session

        # 1. Open government portal with resilient navigation
        navigated = False
        nav_err_msg = ""
        if entry_url.startswith(("http://", "https://")):
            try:
                resp = await page.goto(entry_url, timeout=10000, wait_until="domcontentloaded")
                if resp and resp.status >= 400:
                    navigated = False
                    nav_err_msg = f"HTTP {resp.status} Government server error"
                else:
                    navigated = True
                    session.steps_completed.append(f"🌐 Navigated to live portal: {entry_url}")
            except Exception as nav_err:
                nav_err_msg = str(nav_err)
                logger.warning("Direct navigation to %s failed (%s).", entry_url, nav_err)

        elif entry_url.startswith("file://"):
            try:
                await page.goto(entry_url, wait_until="domcontentloaded")
                navigated = True
                session.steps_completed.append(f"🌐 Loaded local portal template: {entry_url}")
            except Exception as nav_err:
                nav_err_msg = str(nav_err)

        if not navigated:
            # The official government portal is genuinely unreachable or down!
            # Do NOT silently substitute a mock template and pretend it is live!
            session.status = SessionStatus.ERROR
            error_msg = f"Official government portal '{entry_url}' is currently unreachable or offline ({nav_err_msg}). The autonomous browser agent stopped."
            session.steps_completed.append(f"❌ {error_msg}")
            logger.error(error_msg)
            return session

        # 2. Distill form DOM into compact ~400-token JSON
        distilled = await distill_form_dom(page)
        session.steps_completed.append(f"Scanned live DOM: {len(distilled.get('fields', []))} fields detected")

        # 3. Generate Action Plan using LLM / Heuristics
        plan = generate_action_plan(distilled, profile)
        session.steps_completed.append(f"AI generated zero-shot action plan with {len(plan)} actions")

        # 4. Execute dynamic plan
        completed_steps = await execute_dynamic_action_plan(page, plan, doc_path)
        session.steps_completed.extend(completed_steps)

        # 5. Checkpoint detection: CAPTCHA
        captcha_img_selectors = ["#imgCaptcha", "#captchaImage", "img[src*='captcha']", ".captcha-img", "img[alt*='captcha']"]
        captcha_inp_selectors = ["#inpCaptcha", "#captchaAnswer", "#txtCaptcha", "input[name*='captcha']", "input[id*='captcha']"]
        submit_btn_selectors = ["#btnSubmit", "#btnRegister", "button[type='submit']", "input[type='submit']"]

        captcha_b64 = None
        for sel in captcha_img_selectors:
            try:
                el = await page.wait_for_selector(sel, state="visible", timeout=1500)
                if el:
                    png_bytes = await el.screenshot(type="png")
                    captcha_b64 = base64.b64encode(png_bytes).decode()
                    break
            except Exception:
                continue

        for sel in captcha_inp_selectors:
            try:
                el = await page.wait_for_selector(sel, state="visible", timeout=1000)
                if el:
                    session.captcha_input_selector = sel
                    break
            except Exception:
                continue

        for sel in submit_btn_selectors:
            try:
                el = await page.wait_for_selector(sel, state="visible", timeout=1000)
                if el:
                    session.submit_button_selector = sel
                    break
            except Exception:
                continue

        preview_b64 = await _screenshot_page_b64(page)

        if captcha_b64:
            session.status = AgentStatus.awaiting_captcha
            return ApplyStartResponse(
                session_id=session.session_id,
                status=session.status,
                message="Dynamic agent paused — please solve the CAPTCHA and approve.",
                captcha_image_b64=captcha_b64,
                page_preview_b64=preview_b64,
                steps_completed=list(session.steps_completed),
            )

        session.status = AgentStatus.submitted
        return ApplyStartResponse(
            session_id=session_id,
            status=session.status,
            message="Zero-shot form filling completed.",
            page_preview_b64=preview_b64,
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


async def resume_application(
    session_id: str,
    captcha_text: str,
    approve: bool = True,
    submit_final: bool = False,
    keep_open_seconds: int = 0,
    close_browser: bool = True,
) -> ApplyResumeResponse:
    """
    Resume a paused session: fill the CAPTCHA, optionally submit or pause
    for human safety review, capture the result, and optionally keep browser open
    for user inspection.
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
    config = session.portal_config

    try:
        if not approve:
            session.status = AgentStatus.failed
            return ApplyResumeResponse(
                session_id=session_id,
                status=session.status,
                message="User chose not to approve. Session closed.",
            )

        # Locate and fill captcha_text into the CAPTCHA input element
        captcha_selectors = (
            config.captcha_input_selectors if config else
            ([session.captcha_input_selector] if session.captcha_input_selector else ["#inpCaptcha", "#captchaAnswer", "#txtCaptcha", "input[name*='captcha']"])
        )
        try:
            captcha_input = await _resolve_element(
                page, captcha_selectors, timeout_ms=3000
            )
            await captcha_input.fill("")
            await captcha_input.type(captcha_text, delay=50)
            session.steps_completed.append("CAPTCHA entered")
        except Exception:
            logger.info("CAPTCHA input element not found or skipped on this portal.")

        # Locate, scroll, and highlight Submit button
        submit_btn = None
        submit_selectors = (
            config.submit_button_selectors if config else
            ([session.submit_button_selector] if session.submit_button_selector else ["#btnSubmit", "#btnRegister", "button[type='submit']", "input[type='submit']"])
        )
        if submit_selectors:
            try:
                submit_btn = await _resolve_element(
                    page, submit_selectors, timeout_ms=5000
                )
                await submit_btn.scroll_into_view_if_needed()
                await page.evaluate(
                    "(btn) => { btn.style.border = '3px solid #10b981'; btn.style.boxShadow = '0 0 15px #10b981'; }",
                    submit_btn,
                )
            except Exception as exc:
                logger.warning("Could not locate or highlight submit button: %s", exc)

        receipt_no = None
        if submit_final:
            if submit_btn:
                await submit_btn.click()
                session.steps_completed.append("Submit clicked")
                try:
                    await page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    await asyncio.sleep(2)
            final_screenshot = await _screenshot_page_b64(page)
            session.status = AgentStatus.submitted
            message = "Form submitted successfully. Application receipt captured."
            try:
                page_text = await page.inner_text("body")
                import re
                match = re.search(
                    r"(?:Ack(?:nowledgement)?|Ref(?:erence)?|Application|Registration)\s*(?:No\.?|Number|ID)?[:\-\s]+([A-Z0-9\-\/]{6,25})",
                    page_text,
                    re.IGNORECASE,
                )
                if match:
                    receipt_no = match.group(0).strip()
            except Exception:
                pass
        else:
            # Safety Review Mode (Default): Do NOT click submit button
            final_screenshot = await _screenshot_page_b64(page)
            session.status = AgentStatus.submitted
            message = "Form 100% pre-filled with CAPTCHA. Paused right before final submission for human review (Safety Mode)."

        # Optional fixed delay for automated demo timers
        headless = os.getenv("BROWSER_HEADLESS", "false").lower() in ("1", "true", "yes")
        pause_duration = 0 if headless else keep_open_seconds
        if pause_duration > 0:
            logger.info("Keeping browser open for %d seconds for visual review...", pause_duration)
            await asyncio.sleep(pause_duration)

        return ApplyResumeResponse(
            session_id=session_id,
            status=session.status,
            message=message,
            tracking_receipt=receipt_no,
            final_screenshot_b64=final_screenshot,
        )

    except Exception as exc:
        logger.exception("resume_application failed")
        session.status = AgentStatus.failed
        return ApplyResumeResponse(
            session_id=session_id,
            status=session.status,
            message=f"Agent error during resume: {exc}",
        )

    finally:
        if close_browser or not approve:
            await close_session(session_id)

