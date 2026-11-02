"""
vision_agent.py — Zero-Shot Vision-Guided Autonomous Browser Navigation
=========================================================================
Core brain of the SahayakAI browser agent.

Instead of hardcoded CSS selectors or mock portals, this module:
1. Takes a screenshot of the current live Playwright page.
2. Sends it to a Vision LLM (Groq qwen/qwen3.8-27b) along with the
   citizen's goal and data pool.
3. The Vision LLM reasons about what it sees and returns one atomic action.
4. Playwright executes that action. Loop repeats (max 15 turns).

Pause points:
- OTP fields → pauses for citizen to type OTP in the real browser.
- Subjective fields → pauses for citizen to make a personal choice.
- Final submit → pauses for sovereign human review. NEVER auto-submits.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from playwright.async_api import Page

try:
    from app.llm_client import chat_json_vision, chat_json
    from app.schemas import CitizenProfile
except ImportError:
    from backend.app.llm_client import chat_json_vision, chat_json
    from backend.app.schemas import CitizenProfile

logger = logging.getLogger(__name__)

# Maximum vision-action loop iterations before the agent stops.
MAX_VISION_TURNS = 15

# ---------------------------------------------------------------------------
# Vision LLM System Prompt
# ---------------------------------------------------------------------------

_VISION_AGENT_SYSTEM_PROMPT = """You are an expert autonomous AI browser agent navigating real Indian Government portals.

You are given:
1. A screenshot of the current browser page.
2. The citizen's TARGET GOAL (what they want to accomplish).
3. The citizen's DATA POOL (extracted profile data available for form filling).
4. A history of previous actions you have already taken.

Your job: Look at the screenshot carefully and decide the SINGLE BEST next action to make progress toward the target goal.

## Action Types

- **click**: Click a button, link, tab, or menu item to navigate.
  - Set `selector_strategy` to "text" and `selector_or_text` to the visible text on the element.
  - For elements without clear text, describe position: "button in top-right corner".

- **fill**: Type text into an input field. Only fill with data from the DATA POOL.
  - Set `selector_or_text` to the field's visible label text (e.g., "Full Name", "Mobile Number").
  - Set `fill_value` to the exact value from the DATA POOL.

- **select**: Pick an option from a dropdown menu.
  - Set `selector_or_text` to the dropdown's label.
  - Set `fill_value` to the option text to select.

- **check**: Check a checkbox (terms, consent, declarations).
  - Set `selector_or_text` to the checkbox label text.

- **scroll**: Scroll down the page to see more content.
  - Set `selector_or_text` to "down" or "up".

- **wait**: Wait for content to finish loading (use sparingly, max 2 consecutive waits).
  - Set `selector_or_text` to what you're waiting for.

- **otp_checkpoint**: An OTP / verification code input is detected. The agent MUST pause.
  - The citizen needs to type the OTP they received on their phone.
  - Set `reason_for_human` explaining what OTP is needed.

- **subjective_checkpoint**: A field requires the citizen's personal choice that cannot be inferred from the data pool (e.g., specific school name, exam center, loan amount preference).
  - Set `reason_for_human` explaining what choice is needed.

- **captcha_checkpoint**: A CAPTCHA image is detected. The agent MUST pause.
  - Set `reason_for_human` to describe the CAPTCHA.

- **done**: The target form is fully filled. The agent pauses BEFORE clicking any final submit/register button.
  - NEVER click a submit button yourself. Always pause for human review.

## Rules
1. Take ONE action per turn. Be specific about what to click/fill.
2. NEVER guess data that isn't in the DATA POOL. If a field's data is missing, use subjective_checkpoint.
3. FINAL APPLICATION VS LOGIN GATEWAY:
   - On the FINAL scheme/certificate application form: NEVER click the final "Submit" or "Register" button yourself — always output action "done" so the citizen can perform sovereign final review.
   - On LOGIN / GATEWAY screens (DigiLocker, ServicePlus login, OTP verification, Security PIN verification): YOU MUST CLICK "Sign In", "Submit", "Verify", "Next", "Continue", or the verified account card! Clicking "Verify" or "Submit" on a PIN/OTP/login screen is intermediate navigation REQUIRED to authenticate into the portal.
4. On login/OTP/PIN screens:
   - If OTP or PIN input is empty, pause with action `otp_checkpoint` so citizen enters it.
   - If citizen has already entered their OTP or PIN (or just resumed from a pause), your immediate action MUST BE to click the "Verify", "Submit", or "Sign In" button to submit the code!
5. If the page looks broken, has an error, or isn't loading, describe it in analysis.
6. Be concise in analysis (1-2 sentences max).

## Response Format (strict JSON, no markdown):
{
  "analysis": "Brief description of what you see on the current page",
  "action": "click|fill|select|check|scroll|wait|otp_checkpoint|subjective_checkpoint|captcha_checkpoint|done",
  "selector_or_text": "The visible label/text of the target element",
  "fill_value": null,
  "requires_human": false,
  "reason_for_human": "",
  "citizen_guidance": "Clear plain-English instruction for what the citizen should notice or do right now",
  "citizen_guidance_hindi": "Same instruction translated to simple Hindi (Devanagari script)"
}

7. For EVERY action, provide `citizen_guidance` (English) and `citizen_guidance_hindi` (Hindi) explaining in simple, empathetic language what is happening or what the citizen needs to do. Write as if explaining to a farmer who has never used a computer. Use emoji for clarity.
8. For checkpoint actions (otp_checkpoint, subjective_checkpoint, captcha_checkpoint), provide DETAILED step-by-step instructions in both languages."""


# ---------------------------------------------------------------------------
# Data Pool Formatter
# ---------------------------------------------------------------------------

def _format_data_pool(profile: CitizenProfile) -> str:
    """
    Formats the citizen's profile as a human-readable data pool string
    for the Vision LLM. Only includes non-null fields.
    """
    data = profile.model_dump() if hasattr(profile, "model_dump") else profile.dict()

    # Filter out None/empty/metadata fields
    skip_keys = {
        "source_documents", "uncertain_fields", "verified_by_user",
        "target_portal_url", "target_service_id", "target_portal_id",
    }
    lines = []
    for key, val in data.items():
        if key in skip_keys or val is None or val == "" or val == []:
            continue
        # Pretty-print key
        display_key = key.replace("_", " ").title()
        lines.append(f"- {display_key}: {val}")

    return "\n".join(lines) if lines else "- No data extracted yet."


# ---------------------------------------------------------------------------
# Core Vision-Action Loop
# ---------------------------------------------------------------------------

async def run_vision_loop(
    page: Page,
    profile: CitizenProfile,
    target_goal: str,
    on_step: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Runs the autonomous Vision-Perception-Action loop on a live Playwright page.

    Args:
        page: Live Playwright page (visible Chromium browser).
        profile: Citizen's extracted & verified data pool.
        target_goal: What the citizen wants to accomplish (e.g., "Register on ServicePlus").
        on_step: Optional async callback(step_log: str, screenshot_b64: str) for live updates.

    Returns:
        {
            "status": "done" | "otp_checkpoint" | "subjective_checkpoint" | "captcha_checkpoint" | "max_turns" | "error",
            "steps_completed": [...],
            "reason_for_pause": "..." | None,
            "turn_count": int,
        }
    """
    data_pool_text = _format_data_pool(profile)
    action_history: List[str] = []
    steps_completed: List[str] = []
    consecutive_waits = 0

    for turn in range(1, MAX_VISION_TURNS + 1):
        # 1. Capture screenshot
        try:
            screenshot_bytes = await page.screenshot(type="jpeg", quality=75, full_page=False)
        except Exception as exc:
            logger.error("Failed to capture screenshot on turn %d: %s", turn, exc)
            steps_completed.append(f"❌ Screenshot capture failed: {exc}")
            return {
                "status": "error",
                "steps_completed": steps_completed,
                "reason_for_pause": str(exc),
                "turn_count": turn,
                "citizen_guidance": "",
                "citizen_guidance_hindi": "",
            }

        # 2. Build the user prompt for the Vision LLM
        history_text = "\n".join(action_history[-5:]) if action_history else "None yet."
        current_url = page.url

        user_prompt = f"""## Current Page URL
{current_url}

## Target Goal
{target_goal}

## Citizen Data Pool (ONLY use these values for filling)
{data_pool_text}

## Previous Actions Taken
{history_text}

## Instructions
Look at the attached screenshot and decide the single best next action. Respond with strict JSON only."""

        # 3. Call Vision LLM
        vision_response = chat_json_vision(
            system_prompt=_VISION_AGENT_SYSTEM_PROMPT,
            user_text=user_prompt,
            images=[screenshot_bytes],
        )

        if not vision_response or "action" not in vision_response:
            # Vision LLM failed (e.g. rate limit reached) — engage zero-shot DOM Text Reasoner fallback
            logger.warning("Vision LLM unavailable or rate-limited on turn %d. Engaging DOM Text Reasoner fallback.", turn)
            steps_completed.append(f"🤖 Turn {turn}: Vision LLM rate-limited (daily quota). Engaging DOM Text Reasoner...")

            try:
                try:
                    from app.ai_form_agent import distill_form_dom
                except ImportError:
                    from backend.app.ai_form_agent import distill_form_dom

                blueprint = await distill_form_dom(page)
                dom_summary = json.dumps(blueprint, indent=2)

                text_prompt = f"""## Current Page URL
{current_url}

## Target Goal
{target_goal}

## Citizen Data Pool (ONLY use these values for filling)
{data_pool_text}

## Interactive Form Elements on Page (Extracted from DOM)
{dom_summary}

## Previous Actions Taken
{history_text}

## Instructions
Analyze the interactive DOM fields and the citizen data pool. Decide the single best next action (e.g., fill a field with matching citizen data, click Next/Submit, or pause at OTP/CAPTCHA).
Respond with strict JSON matching the required schema."""

                vision_response = chat_json(
                    system_prompt=_VISION_AGENT_SYSTEM_PROMPT,
                    user_content=text_prompt,
                )
            except Exception as dom_err:
                logger.error("DOM fallback also failed: %s", dom_err)

            if not vision_response or "action" not in vision_response:
                steps_completed.append("❌ Both Vision and DOM Text Reasoners could not analyze the page. Pausing for human guidance.")
                return {
                    "status": "error",
                    "steps_completed": steps_completed,
                    "reason_for_pause": "AI agent reached daily rate limits and could not analyze the page.",
                    "turn_count": turn,
                    "citizen_guidance": "Agent reached daily rate limits. Please complete this step manually on the browser.",
                    "citizen_guidance_hindi": "एजेंट की दैनिक सीमा समाप्त हो गई है। कृपया स्क्रीन पर मैन्युअल रूप से भरें।",
                }

        # 4. Parse the action
        action = vision_response.get("action", "wait")
        analysis = vision_response.get("analysis", "")
        selector_or_text = vision_response.get("selector_or_text", "")
        fill_value = vision_response.get("fill_value")
        reason_for_human = vision_response.get("reason_for_human", "")
        citizen_guidance = vision_response.get("citizen_guidance", "")
        citizen_guidance_hindi = vision_response.get("citizen_guidance_hindi", "")

        step_log = f"🤖 Turn {turn}: [{action.upper()}] {analysis}"
        if selector_or_text:
            step_log += f" → Target: '{selector_or_text}'"
        if fill_value:
            step_log += f" → Value: '{fill_value}'"

        steps_completed.append(step_log)
        action_history.append(f"Turn {turn}: {action} on '{selector_or_text}'" + (f" with value '{fill_value}'" if fill_value else ""))

        # Notify frontend in real-time if callback provided
        if on_step:
            try:
                import base64
                screenshot_b64 = base64.b64encode(screenshot_bytes).decode()
                await on_step(step_log, screenshot_b64, citizen_guidance, citizen_guidance_hindi)
            except Exception:
                pass

        # 5. Execute the action
        try:
            if action == "done":
                steps_completed.append("✅ [FORM COMPLETE] Agent stopped before final submission for sovereign human review.")
                return {
                    "status": "done",
                    "steps_completed": steps_completed,
                    "reason_for_pause": "Form fully filled. Ready for human review before submission.",
                    "turn_count": turn,
                    "citizen_guidance": citizen_guidance,
                    "citizen_guidance_hindi": citizen_guidance_hindi,
                }

            elif action == "otp_checkpoint":
                # Highlight the OTP input field in gold
                await _highlight_element_by_text(page, selector_or_text, color="#f59e0b")
                steps_completed.append(f"⏸️ [OTP CHECKPOINT] {reason_for_human or 'Please enter the OTP in the browser.'}")
                return {
                    "status": "otp_checkpoint",
                    "steps_completed": steps_completed,
                    "reason_for_pause": reason_for_human or "OTP verification required. Please enter the OTP you received.",
                    "turn_count": turn,
                    "citizen_guidance": citizen_guidance,
                    "citizen_guidance_hindi": citizen_guidance_hindi,
                }

            elif action == "subjective_checkpoint":
                await _highlight_element_by_text(page, selector_or_text, color="#f59e0b")
                steps_completed.append(f"⏸️ [HUMAN CHOICE NEEDED] {reason_for_human or 'Please make your selection on the portal.'}")
                return {
                    "status": "subjective_checkpoint",
                    "steps_completed": steps_completed,
                    "reason_for_pause": reason_for_human or "This field requires your personal choice.",
                    "turn_count": turn,
                    "citizen_guidance": citizen_guidance,
                    "citizen_guidance_hindi": citizen_guidance_hindi,
                }

            elif action == "captcha_checkpoint":
                await _highlight_element_by_text(page, selector_or_text, color="#f59e0b")
                steps_completed.append(f"⏸️ [CAPTCHA DETECTED] {reason_for_human or 'Please solve the CAPTCHA in the browser.'}")
                return {
                    "status": "captcha_checkpoint",
                    "steps_completed": steps_completed,
                    "reason_for_pause": reason_for_human or "CAPTCHA detected. Please solve it in the browser.",
                    "turn_count": turn,
                    "citizen_guidance": citizen_guidance,
                    "citizen_guidance_hindi": citizen_guidance_hindi,
                }

            elif action == "click":
                consecutive_waits = 0
                await _click_by_text(page, selector_or_text)
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=3000)
                except Exception:
                    pass
                await asyncio.sleep(2.0)  # Wait for page/AJAX transitions

            elif action == "fill":
                consecutive_waits = 0
                if fill_value:
                    await _fill_by_text(page, selector_or_text, str(fill_value))
                    steps_completed.append(f"✍️ Filled '{selector_or_text}': {fill_value}")
                    await asyncio.sleep(1.2)  # Visual pause so citizen can review

            elif action == "select":
                consecutive_waits = 0
                if fill_value:
                    await _select_by_text(page, selector_or_text, str(fill_value))
                    await asyncio.sleep(0.8)

            elif action == "check":
                consecutive_waits = 0
                await _check_by_text(page, selector_or_text)
                await asyncio.sleep(0.5)

            elif action == "scroll":
                consecutive_waits = 0
                direction = (selector_or_text or "down").lower()
                delta = 400 if direction == "down" else -400
                await page.mouse.wheel(0, delta)
                await asyncio.sleep(1.0)

            elif action == "wait":
                consecutive_waits += 1
                if consecutive_waits > 2:
                    steps_completed.append("⚠️ Waited too many times. Moving on.")
                    consecutive_waits = 0
                else:
                    await asyncio.sleep(2.5)

        except Exception as exec_err:
            logger.warning("Turn %d action '%s' failed: %s", turn, action, exec_err)
            steps_completed.append(f"⚠️ Turn {turn}: Action '{action}' failed — {exec_err}")
            # Don't crash, let the loop try the next action with a fresh screenshot

        # Pacing buffer between turns to protect API rate limits and allow viewport to settle
        await asyncio.sleep(1.0)

    # Max turns exhausted
    steps_completed.append(f"⚠️ Reached maximum {MAX_VISION_TURNS} turns. Pausing for human guidance.")
    return {
        "status": "max_turns",
        "steps_completed": steps_completed,
        "reason_for_pause": f"Agent completed {MAX_VISION_TURNS} turns without finishing. Please guide the agent.",
        "turn_count": MAX_VISION_TURNS,
        "citizen_guidance": "",
        "citizen_guidance_hindi": "",
    }


# ---------------------------------------------------------------------------
# Playwright Action Helpers (robust text-based element resolution)
# ---------------------------------------------------------------------------

async def _find_element_by_text(page: Page, text: str):
    """
    Find a clickable/interactive element by its visible text.
    Tries multiple strategies in order of specificity.
    """
    if not text:
        return None

    strategies = [
        # 1. Exact text match on buttons and links
        f"button:has-text('{text}')",
        f"a:has-text('{text}')",
        f"[role='button']:has-text('{text}')",
        # 2. Input/select by associated label text
        f"label:has-text('{text}') >> input",
        f"label:has-text('{text}') >> select",
        f"label:has-text('{text}') >> textarea",
        # 3. Placeholder or aria-label match
        f"input[placeholder*='{text}' i]",
        f"input[aria-label*='{text}' i]",
        f"textarea[placeholder*='{text}' i]",
        # 4. Generic text match (any element)
        f"text='{text}'",
        f"text={text}",
    ]

    for selector in strategies:
        try:
            el = await page.wait_for_selector(selector, state="visible", timeout=2000)
            if el:
                return el
        except Exception:
            continue

    # 5. Fallback: find by label's for-id linkage
    try:
        el = await page.evaluate(f"""() => {{
            const labels = Array.from(document.querySelectorAll('label'));
            const match = labels.find(l => l.innerText.toLowerCase().includes('{text.lower()}'));
            if (match && match.htmlFor) {{
                const target = document.getElementById(match.htmlFor);
                if (target) return true;
            }}
            return false;
        }}""")
        if el:
            label_el = await page.query_selector(f"label:has-text('{text}')")
            if label_el:
                for_id = await label_el.get_attribute("for")
                if for_id:
                    target = await page.query_selector(f"#{for_id}")
                    if target:
                        return target
    except Exception:
        pass

    return None


async def _click_by_text(page: Page, text: str) -> None:
    """Click an element identified by visible text, label, or selector using native trusted hardware clicks."""
    if not text:
        return

    clean_text = text.strip()

    # Tier 1: Look for physical screen coordinates via in-browser DOM search
    # Normalizes whitespace, expands asterisks to regex wildcards, and bubbles up to clickable card container
    coords = await page.evaluate("""(targetText) => {
        const norm = (s) => (s || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const search = norm(targetText);
        if (!search) return null;

        // Create wildcard regex for masked text like 'K***s* D***t' or 'Verified'
        const regexPattern = search
            .replace(/[.+?^${}()|[\\]\\\\]/g, '\\\\$&')
            .replace(/\\*+/g, '.*');
        let regex = null;
        try { regex = new RegExp(regexPattern, 'i'); } catch(e) {}

        const candidates = Array.from(document.querySelectorAll(
            'button, a, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"], div, span, p, li, h1, h2, h3, h4, h5, h6'
        ));

        const matches = [];
        for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;

            const elText = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '');
            if (!elText) continue;

            if (elText.includes(search) || (regex && regex.test(elText))) {
                matches.push({ el, len: elText.length, tag: el.tagName.toLowerCase() });
            }
        }

        if (matches.length > 0) {
            // Pick most specific match
            matches.sort((a, b) => a.len - b.len);
            let target = matches[0].el;

            // Climb up to clickable container/card if inner text was matched
            let curr = target;
            while (curr && curr !== document.body && curr !== document.documentElement) {
                const style = window.getComputedStyle(curr);
                const isCardOrClickable = (
                    style.cursor === 'pointer' ||
                    curr.tagName === 'BUTTON' ||
                    curr.tagName === 'A' ||
                    curr.getAttribute('role') === 'button' ||
                    curr.hasAttribute('onclick') ||
                    curr.hasAttribute('(click)') ||
                    curr.hasAttribute('ng-click') ||
                    (curr.className && typeof curr.className === 'string' && /card|account|user|item|option|btn|row/i.test(curr.className))
                );
                if (isCardOrClickable) {
                    target = curr;
                    break;
                }
                curr = curr.parentElement;
            }

            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.style.outline = '3px solid #3b82f6';
            target.style.boxShadow = '0 0 15px rgba(59,130,246,0.7)';

            const r = target.getBoundingClientRect();
            return {
                x: r.left + r.width / 2,
                y: r.top + r.height / 2
            };
        }
        return null;
    }""", clean_text)

    if coords and coords.get("x") is not None:
        # Perform REAL trusted hardware mouse click
        await page.mouse.move(coords["x"], coords["y"])
        await asyncio.sleep(0.06)
        await page.mouse.down()
        await asyncio.sleep(0.06)
        await page.mouse.up()
        await page.mouse.click(coords["x"], coords["y"])
        return

    # Tier 2: Try Playwright native get_by_role (trusted click)
    for role in ["button", "link", "menuitem", "tab"]:
        try:
            loc = page.get_by_role(role, name=clean_text).first
            if await loc.is_visible(timeout=500):
                box = await loc.bounding_box()
                if box:
                    await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                    return
                await loc.click(timeout=2500, force=True)
                return
        except Exception:
            pass

    # Tier 3: Try Playwright native get_by_text (trusted click)
    try:
        loc = page.get_by_text(clean_text, exact=False).first
        if await loc.is_visible(timeout=500):
            box = await loc.bounding_box()
            if box:
                await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                return
            await loc.click(timeout=2500, force=True)
            return
    except Exception:
        pass

    # Tier 4: Direct selector click
    if clean_text.startswith(("#", ".", "[", "button", "a")):
        try:
            el = await page.wait_for_selector(clean_text, state="visible", timeout=1000)
            if el:
                box = await el.bounding_box()
                if box:
                    await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                    return
                await el.click(timeout=2500, force=True)
                return
        except Exception:
            pass

    # Tier 5: Word-by-word decomposition for multi-word targets (e.g. "Verify PIN" -> "Verify")
    words = clean_text.split()
    if len(words) > 1:
        for word in sorted(words, key=len, reverse=True):
            if len(word) >= 3:
                try:
                    loc = page.get_by_text(word, exact=False).first
                    if await loc.is_visible(timeout=500):
                        box = await loc.bounding_box()
                        if box:
                            await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                            return
                        await loc.click(timeout=2500, force=True)
                        return
                except Exception:
                    continue

    raise RuntimeError(f"Could not find clickable element matching: '{text}'")


async def _fill_by_text(page: Page, label_text: str, value: str) -> None:
    """Fill an input field identified by its label text or selector."""
    el = await _find_element_by_text(page, label_text)
    if not el:
        try:
            el = await page.wait_for_selector(
                f"input[name*='{label_text}' i], input[id*='{label_text}' i], input[placeholder*='{label_text}' i], input[aria-label*='{label_text}' i]",
                state="visible",
                timeout=1200
            )
        except Exception:
            pass
    if el:
        await el.scroll_into_view_if_needed()
        await page.evaluate(
            "(el) => { el.style.outline = '2px solid #10b981'; el.style.boxShadow = '0 0 10px rgba(16,185,129,0.6)'; }",
            el,
        )
        try:
            await el.click(force=True)
        except Exception:
            pass
        await el.fill("")
        await el.type(value, delay=30)
        await page.evaluate(
            "(e) => { e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }",
            el,
        )
    else:
        raise RuntimeError(f"Could not find input with label: '{label_text}'")


async def _select_by_text(page: Page, label_text: str, option_text: str) -> None:
    """Select a dropdown option by its label text."""
    el = await _find_element_by_text(page, label_text)
    if el:
        await el.scroll_into_view_if_needed()
        await page.evaluate(
            "(el) => { el.style.outline = '2px solid #10b981'; el.style.boxShadow = '0 0 10px rgba(16,185,129,0.6)'; }",
            el,
        )
        try:
            await el.select_option(label=option_text, timeout=2000)
        except Exception:
            try:
                await el.select_option(value=option_text, timeout=2000)
            except Exception:
                # Try clicking the dropdown and then clicking the option text
                await el.click()
                await asyncio.sleep(0.5)
                try:
                    opt_el = await page.wait_for_selector(f"text='{option_text}'", timeout=2000)
                    if opt_el:
                        await opt_el.click()
                except Exception:
                    raise RuntimeError(f"Could not select option '{option_text}' in dropdown '{label_text}'")

        await page.evaluate(
            "(e) => { e.dispatchEvent(new Event('change', { bubbles: true })); }",
            el,
        )
    else:
        raise RuntimeError(f"Could not find dropdown with label: '{label_text}'")


async def _check_by_text(page: Page, text: str) -> None:
    """Check a checkbox identified by its label text."""
    el = await _find_element_by_text(page, text)
    if el:
        await el.scroll_into_view_if_needed()
        tag = await el.evaluate("(e) => e.tagName.toLowerCase()")
        if tag == "input":
            if not await el.is_checked():
                await el.check()
        else:
            # It's a label or wrapper — find the checkbox inside
            checkbox = await el.query_selector("input[type='checkbox']")
            if checkbox and not await checkbox.is_checked():
                await checkbox.check()
            else:
                await el.click()
    else:
        # Try generic checkbox selector
        try:
            checkbox = await page.wait_for_selector("input[type='checkbox']", state="visible", timeout=2000)
            if checkbox and not await checkbox.is_checked():
                await checkbox.check()
        except Exception:
            raise RuntimeError(f"Could not find checkbox with text: '{text}'")


async def _highlight_element_by_text(page: Page, text: str, color: str = "#f59e0b") -> None:
    """Highlight an element with a glowing border to draw human attention."""
    el = await _find_element_by_text(page, text)
    if el:
        await el.scroll_into_view_if_needed()
        await page.evaluate(
            f"(el) => {{ el.style.border = '3px solid {color}'; el.style.boxShadow = '0 0 25px {color}'; }}",
            el,
        )

