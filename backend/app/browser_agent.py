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

from backend.app.portal_maps import (
    ActionType,
    PortalConfig,
    PortalStep,
    get_portal_config,
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
    portal_config: PortalConfig
    profile: CitizenProfile
    status: AgentStatus = AgentStatus.running
    steps_completed: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    document_path: Optional[str] = None


# In-memory session store — safe for a single-process hackathon demo.
_active_sessions: Dict[str, BrowserSession] = {}


def get_session(session_id: str) -> BrowserSession:
    """Retrieve an active session or raise KeyError."""
    if session_id not in _active_sessions:
        raise KeyError(f"No active session with id '{session_id}'")
    return _active_sessions[session_id]


async def close_session(session_id: str) -> None:
    """Gracefully tear down browser handles and remove the session."""
    session = _active_sessions.pop(session_id, None)
    if session is None:
        return
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

    try:
        config = get_portal_config(portal_id)
    except KeyError as exc:
        return ApplyStartResponse(
            session_id=session_id,
            status=AgentStatus.failed,
            message=str(exc),
        )

    # Resolve uploaded document path.
    doc_path: Optional[str] = None
    if document_filename:
        candidate = _UPLOADS_DIR / document_filename
        if candidate.exists():
            doc_path = str(candidate)

    # Determine headless mode.
    headless = os.getenv("BROWSER_HEADLESS", "false").lower() in ("1", "true", "yes")

    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.launch(
            headless=headless,
            slow_mo=100,  # slight slowdown so judges can follow
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
        )
        _active_sessions[session_id] = session

        # Execute steps until a CHECKPOINT returns a response.
        for step in config.steps:
            result = await _execute_step(page, step, session)
            if result is not None:
                # CHECKPOINT reached — return control to user.
                return result

        # All steps completed with no checkpoint (unusual but safe).
        session.status = AgentStatus.submitted
        preview = await _screenshot_page_b64(page)
        return ApplyStartResponse(
            session_id=session_id,
            status=session.status,
            message="All steps completed — no CAPTCHA checkpoint was needed.",
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


async def resume_application(
    session_id: str,
    captcha_text: str,
    approve: bool = True,
) -> ApplyResumeResponse:
    """
    Resume a paused session: fill the CAPTCHA, optionally submit,
    capture the result, and close the browser.
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
            await close_session(session_id)
            return ApplyResumeResponse(
                session_id=session_id,
                status=session.status,
                message="User chose not to approve. Session closed.",
            )

        # Fill CAPTCHA input.
        captcha_input = await _resolve_element(
            page, config.captcha_input_selectors, timeout_ms=5000
        )
        await captcha_input.fill("")
        await captcha_input.type(captcha_text, delay=50)
        session.steps_completed.append("CAPTCHA entered")

        # Brief pause so the audience can see the CAPTCHA being entered.
        await asyncio.sleep(2)

        # Click submit if selectors are configured.
        if config.submit_button_selectors:
            submit_btn = await _resolve_element(
                page, config.submit_button_selectors, timeout_ms=5000
            )
            await submit_btn.click()
            session.steps_completed.append("Submit clicked")

            # Wait for navigation / response.
            await asyncio.sleep(3)

        # Final screenshot.
        final_screenshot = await _screenshot_page_b64(page)
        session.status = AgentStatus.submitted

        return ApplyResumeResponse(
            session_id=session_id,
            status=session.status,
            message="Form submitted successfully. Check the screenshot for confirmation.",
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
        await close_session(session_id)

