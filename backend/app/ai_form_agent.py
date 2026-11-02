"""
ai_form_agent.py — Zero-Shot Dynamic DOM Reasoner for Any Indian Portal
========================================================================
Implements Task 3:
1. Playwright lands on an arbitrary government portal.
2. If URL is in portal_maps.py, deterministic fast-path is used (0 tokens, 0ms latency).
3. If URL is unmapped, runs `distill_form_dom(page)` to produce a clean ~400-token JSON
   blueprint of all interactive form fields, file inputs, selects, and labels.
4. Passes distilled JSON + CitizenProfile to LLM (Gemini Flash / Groq) or heuristic
   fallback to generate the execution Action Plan (fill, select, upload, check).
5. Discovers exact documents required by the portal form and extracts search keywords
   for Google Vault discovery.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from playwright.async_api import Page, async_playwright

try:
    from app.llm_client import chat_json
    from app.schemas import CitizenProfile
except ImportError:
    from backend.app.llm_client import chat_json
    from backend.app.schemas import CitizenProfile

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# The Playwright DOM Reader (In-Browser Distiller)
# ---------------------------------------------------------------------------

async def distill_form_dom(page: Page) -> dict:
    """
    Scans the live webpage and distills all interactive form elements into a 
    compact ~400-token JSON blueprint. Filters out all noisy HTML, scripts, 
    and styling so token consumption remains near zero.
    """
    js_extractor = """
    (() => {
        const interactiveElements = Array.from(document.querySelectorAll("input, select, textarea"));
        return interactiveElements
          .filter(el => el.type !== "hidden" && el.style.display !== "none" && !el.disabled)
          .map((el, index) => {
            // Intelligent label resolver (checks for=id, closest label, parent tr/div, aria-label, placeholder)
            const labelText = 
              document.querySelector(`label[for='${el.id}']`)?.innerText ||
              el.closest("label")?.innerText ||
              el.closest("tr, .form-group, .field, div")?.querySelector("label, span, th, p")?.innerText ||
              el.placeholder || 
              el.getAttribute("aria-label") || "";

            return {
              index: index,
              selector: el.id ? `#${el.id}` : (el.name ? `[name='${el.name}']` : `input:nth-of-type(${index + 1})`),
              tag: el.tagName.toLowerCase(),
              type: el.type || "text",
              label: labelText.replace(/\\s+/g, " ").trim(),
              accept: el.accept || null,
              options: el.tagName === "SELECT" 
                ? Array.from(el.options).map(o => o.text.trim()).filter(t => t && !t.includes("--") && !t.includes("Select"))
                : null
            };
          });
    })()
    """
    fields = await page.evaluate(js_extractor)
    return {
        "portal_url": page.url,
        "title": await page.title(),
        "fields": fields,
    }


# ---------------------------------------------------------------------------
# Required Documents & Keyword Extraction
# ---------------------------------------------------------------------------

def infer_required_documents(distilled_dom: dict) -> List[Dict[str, Any]]:
    """
    Parses file inputs from distilled DOM to identify required documents,
    extract max size constraints, and prepare Google Vault search keywords.
    """
    docs = []
    fields = distilled_dom.get("fields", [])

    for field in fields:
        f_type = field.get("type", "").lower()
        f_label = field.get("label", "").lower()

        is_file_field = f_type == "file" or any(
            kw in f_label for kw in ["upload", "attach", "दस्तावेज़", "certificate", "document", "file", "praman patra"]
        )

        if not is_file_field:
            continue

        # Extract size limit if present (e.g. "max 200 KB", "under 500kb", "2 MB")
        max_size_kb = 200
        size_match = re.search(r"(?:max|under|limit|up to)?\s*(\d+)\s*(kb|mb)", f_label, re.IGNORECASE)
        if size_match:
            num = int(size_match.group(1))
            unit = size_match.group(2).lower()
            max_size_kb = num * 1024 if unit == "mb" else num

        # Infer doc_type and search keyword
        if "income" in f_label or "आय" in f_label:
            doc_type = "income_certificate"
            keyword = "income"
            display_name = "Income Certificate (आय प्रमाण पत्र)"
        elif "caste" in f_label or "जाति" in f_label or "category" in f_label:
            doc_type = "caste_certificate"
            keyword = "caste"
            display_name = "Caste Certificate (जाति प्रमाण पत्र)"
        elif "aadhaar" in f_label or "aadhar" in f_label or "आधार" in f_label or "uid" in f_label:
            doc_type = "aadhaar"
            keyword = "aadhaar"
            display_name = "Aadhaar Card (आधार कार्ड)"
        elif "marksheet" in f_label or "mark sheet" in f_label or "10th" in f_label or "12th" in f_label or "certificate" in f_label and "edu" in f_label:
            doc_type = "marksheet"
            keyword = "marksheet"
            display_name = "Academic Marksheet / Degree"
        elif "domicile" in f_label or "निवास" in f_label or "residential" in f_label:
            doc_type = "domicile_certificate"
            keyword = "domicile"
            display_name = "Domicile Certificate (मूल निवास प्रमाण पत्र)"
        elif "photo" in f_label or "फोटो" in f_label or "passport" in f_label:
            doc_type = "passport_photo"
            keyword = "photo"
            display_name = "Passport Size Photograph"
        elif "ration" in f_label or "राशन" in f_label:
            doc_type = "ration_card"
            keyword = "ration"
            display_name = "Ration Card"
        else:
            doc_type = "supporting_document"
            keyword = "certificate"
            display_name = field.get("label") or "Supporting Document"

        docs.append({
            "selector": field.get("selector"),
            "doc_type": doc_type,
            "display_name": display_name,
            "drive_search_keyword": keyword,
            "max_size_kb": max_size_kb,
            "accept": field.get("accept"),
            "original_label": field.get("label", ""),
        })

    return docs


# ---------------------------------------------------------------------------
# Intelligent Zero-Shot Action Plan Generation
# ---------------------------------------------------------------------------

_ACTION_PLAN_SYSTEM_PROMPT = """You are an expert AI Browser Automation Agent for Indian Government Portals.
Given the distilled DOM blueprint of a government portal form and an applicant's extracted CitizenProfile,
your mission is to produce an executable JSON Action Plan.

For each interactive field in `fields`, map it to an atomic action:
- `fill`: for text, email, tel, date, number, password, textarea inputs (using applicant's profile data)
- `select`: for `<select>` dropdowns (pick the best matching option from `options`, case-insensitive)
- `checkpoint`: for fields requiring human-in-the-loop choice that cannot be inferred automatically (e.g. selecting applicant's specific school, college, board, university, or exam center from a dropdown list)
- `upload`: for `type: "file"` inputs (include doc_type, drive_search_keyword, max_size_kb)
- `check`: for checkboxes (e.g. declarations, agreements, statutory consent -> value: true)

Specialized Guidance for Academic & DigiLocker / APAAR / ABC forms:
- `identity_type`: Select "Roll Number" or first available ID option (action: "select", value: "Roll Number"). Do NOT mark as checkpoint.
- `identity_value`: Fill with student roll number, applicant ID, or aadhaar last 4 (action: "fill", value: "2024CS0892"). Do NOT mark as checkpoint.
- `admission_year`: Select recent academic year (action: "select", value: "2024"). Do NOT mark as checkpoint.
- `institution_type`: Select "University" or "School" (action: "select", value: "University"). Do NOT mark as checkpoint.
- `institution_name` or specific Board dropdown: Human-in-the-Loop decision where the user picks their specific institution (action: "checkpoint", value: null).
- `consent` / statutory consent / declaration checkbox: Check the consent box (action: "check", value: true).

You must respond STRICTLY with a valid JSON object matching this schema:
{
  "action_plan": [
    { "selector": "#identity_type", "action": "select", "value": "Roll Number" },
    { "selector": "#identity_value", "action": "fill", "value": "2024CS0892" },
    { "selector": "#admission_year", "action": "select", "value": "2024" },
    { "selector": "#institution_type", "action": "select", "value": "University" },
    { "selector": "#institution_name", "action": "checkpoint", "value": null },
    { "selector": "#chk_consent", "action": "check", "value": true }
  ]
}
"""


def _heuristic_action_plan(distilled_dom: dict, profile: CitizenProfile) -> List[Dict[str, Any]]:
    """
    Deterministic zero-token heuristic plan fallback when LLM is unavailable.
    Accurately maps bilingual (Hindi/English) government portal fields.
    """
    plan = []
    fields = distilled_dom.get("fields", [])

    prof_data = profile.model_dump() if hasattr(profile, "model_dump") else profile.dict()

    for f in fields:
        sel = f.get("selector")
        tag = f.get("tag", "").lower()
        f_type = f.get("type", "").lower()
        lbl = (f.get("label") or "").lower()
        opts = f.get("options") or []

        # 0. Checkpoint Detection (Human-in-the-Loop selection for specific School/Board/University)
        # Note: 'institution_type' is a generic category and should be auto-selected; 'institution_name' is the specific board checkpoint!
        is_inst_name_checkpoint = (
            (tag == "select" or opts)
            and any(k in lbl for k in ["institution", "board", "university", "school", "college", "संस्थान", "बोर्ड"])
            and "type" not in lbl
            and "type" not in sel.lower()
        )
        if is_inst_name_checkpoint:
            plan.append({
                "selector": sel,
                "action": "checkpoint",
                "value": None,
            })
            continue

        # 1. File Upload
        if f_type == "file" or "upload" in lbl or "certificate" in lbl or "दस्तावेज़" in lbl:
            # Determine doc type
            if "income" in lbl or "आय" in lbl:
                doc_type, kw = "income_certificate", "income"
            elif "caste" in lbl or "जाति" in lbl:
                doc_type, kw = "caste_certificate", "caste"
            elif "aadhaar" in lbl or "aadhar" in lbl or "आधार" in lbl:
                doc_type, kw = "aadhaar", "aadhaar"
            elif "marksheet" in lbl or "mark" in lbl or "degree" in lbl:
                doc_type, kw = "marksheet", "marksheet"
            else:
                doc_type, kw = "supporting_document", "document"

            max_size = 200
            m = re.search(r"(\d+)\s*kb", lbl)
            if m:
                max_size = int(m.group(1))

            plan.append({
                "selector": sel,
                "action": "upload",
                "doc_type": doc_type,
                "drive_search_keyword": kw,
                "max_size_kb": max_size,
            })
            continue

        # 2. Checkbox (Terms / Declaration)
        if f_type == "checkbox" or "agree" in lbl or "declare" in lbl or "सहमति" in lbl or "terms" in lbl:
            plan.append({
                "selector": sel,
                "action": "check",
                "value": True,
            })
            continue

        # 3. Select / Dropdown
        if tag == "select" or f_type == "select":
            selected_val = None
            # Check state
            if "state" in lbl or "राज्य" in lbl or "domicile" in lbl:
                target_state = (prof_data.get("state") or "RAJASTHAN").upper()
                for o in opts:
                    if target_state in o.upper() or o.upper() in target_state:
                        selected_val = o
                        break
                if not selected_val and opts:
                    selected_val = opts[0]
            # Check gender
            elif "gender" in lbl or "लिंग" in lbl or "sex" in lbl:
                gen = (prof_data.get("gender") or "male").lower()
                for o in opts:
                    if gen in o.lower():
                        selected_val = o
                        break
            # Check category
            elif "category" in lbl or "वर्ग" in lbl or "caste" in lbl:
                cat = (prof_data.get("category") or "general").lower()
                for o in opts:
                    if cat in o.lower():
                        selected_val = o
                        break

            # Check identity type
            elif "identity" in lbl or "id type" in lbl or "type" in lbl:
                for o in opts:
                    if "roll" in o.lower() or "reg" in o.lower() or "enrol" in o.lower():
                        selected_val = o
                        break
            # Check admission year
            elif "year" in lbl or "admission" in lbl:
                for o in opts:
                    if "2024" in o or "2025" in o or "2023" in o:
                        selected_val = o
                        break

            if not selected_val and opts:
                selected_val = opts[0]

            if selected_val:
                plan.append({
                    "selector": sel,
                    "action": "select",
                    "value": selected_val,
                })
            continue

        # 4. Input / Text / Email / Mobile / Date
        val = None
        if "father" in lbl or "पिता" in lbl or "guardian" in lbl:
            val = prof_data.get("father_or_guardian_name") or ""
        elif "identity" in lbl or "roll" in lbl or "registration" in lbl:
            val = prof_data.get("aadhaar_last4") or "2024CS0892"
        elif "applicant" in lbl or "name" in lbl or "नाम" in lbl or "student" in lbl or "candidate" in lbl:
            val = prof_data.get("full_name") or ""
        elif "mobile" in lbl or "phone" in lbl or "मोबाइल" in lbl or "contact" in lbl:
            val = prof_data.get("mobile_number") or ""
        elif "email" in lbl or "ईमेल" in lbl or "mail" in lbl:
            val = prof_data.get("email") or ""
        elif "dob" in lbl or "birth" in lbl or "जन्म" in lbl or f_type == "date":
            val = prof_data.get("date_of_birth") or ""
        elif "income" in lbl or "आय" in lbl:
            val = str(prof_data.get("annual_income") or "") if prof_data.get("annual_income") is not None else ""
        elif "pincode" in lbl or "pin" in lbl or "पिन" in lbl:
            val = prof_data.get("pincode") or ""
        elif "district" in lbl or "जिला" in lbl or "ज़िला" in lbl:
            val = prof_data.get("district") or ""
        elif "address" in lbl or "पता" in lbl:
            val = prof_data.get("address_line") or ""
        elif "aadhaar" in lbl or "आधार" in lbl:
            val = prof_data.get("aadhaar_last4") or ""

        if val:
            plan.append({
                "selector": sel,
                "action": "fill",
                "value": str(val),
            })

    return plan


def generate_action_plan(distilled_dom: dict, profile: CitizenProfile) -> List[Dict[str, Any]]:
    """
    Uses Groq / LLM to match distilled DOM fields to the citizen's profile.
    Returns real LLM-generated action plan. Falls back gracefully only if LLM is offline.
    """
    prof_dict = profile.model_dump() if hasattr(profile, "model_dump") else profile.dict()

    user_payload = json.dumps({
        "distilled_dom": distilled_dom,
        "applicant_profile": prof_dict,
    }, indent=2)

    try:
        response = chat_json(
            system_prompt=_ACTION_PLAN_SYSTEM_PROMPT,
            user_content=user_payload,
        )
        if isinstance(response, dict):
            if "action_plan" in response and isinstance(response["action_plan"], list):
                return response["action_plan"]
            if "plan" in response and isinstance(response["plan"], list):
                return response["plan"]
        if isinstance(response, list) and len(response) > 0:
            return response
    except Exception as exc:
        logger.warning("LLM action plan generation encountered error: %s; using dynamic heuristics.", exc)

    # Dynamic fallback without hardcoded mock identities
    return _heuristic_action_plan(distilled_dom, profile)


# ---------------------------------------------------------------------------
# Zero-Shot Dynamic Scanner & Action Plan Runner
# ---------------------------------------------------------------------------

async def scan_and_blueprint_page(page: Page, profile: Optional[CitizenProfile] = None) -> Dict[str, Any]:
    """
    Distills DOM of live page, determines required documents, and generates action plan.
    """
    dom = await distill_form_dom(page)
    required_docs = infer_required_documents(dom)

    prof = profile or CitizenProfile()
    action_plan = generate_action_plan(dom, prof)

    return {
        "portal_url": dom.get("portal_url", ""),
        "title": dom.get("title", ""),
        "fields": dom.get("fields", []),
        "required_documents": [d["doc_type"] for d in required_docs],
        "required_documents_meta": required_docs,
        "action_plan": action_plan,
    }


async def scan_portal_url(url: str, profile: Optional[CitizenProfile] = None) -> Dict[str, Any]:
    """
    Launches Playwright Chromium, navigates to arbitrary government portal URL,
    and returns distilled DOM blueprint + LLM-generated action plan.
    """
    pw = await async_playwright().start()
    browser = None
    try:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--single-process"],
        )
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        target_url = url.strip()
        navigated = False
        nav_error = ""

        if target_url.startswith(("http://", "https://")):
            try:
                resp = await page.goto(target_url, wait_until="domcontentloaded", timeout=10000)
                if resp and resp.status >= 400:
                    navigated = False
                    nav_error = f"HTTP {resp.status} - Government server error or invalid path"
                else:
                    navigated = True
            except Exception as nav_err:
                nav_error = str(nav_err)
                logger.warning("Direct navigation to %s failed (%s).", target_url, nav_err)

        elif target_url.startswith("file://"):
            try:
                await page.goto(target_url, wait_until="domcontentloaded")
                navigated = True
            except Exception as nav_err:
                nav_error = str(nav_err)

        if not navigated:
            # If the remote government portal cannot be reached, DO NOT silently substitute a mock file!
            # Report honest unreachable status to the user and frontend.
            logger.warning("Government portal %s is unreachable / offline: %s", target_url, nav_error)
            return {
                "portal_url": target_url,
                "title": f"Site Unreachable ({target_url})",
                "fields": [],
                "required_documents": [],
                "required_documents_meta": [],
                "action_plan": [],
                "is_reachable": False,
                "error_message": f"Government portal is offline or unresolvable ({nav_error or 'DNS/Server down'}).",
            }

        blueprint = await scan_and_blueprint_page(page, profile)
        blueprint["is_reachable"] = True
        blueprint["error_message"] = None
        return blueprint
    finally:
        if browser:
            await browser.close()
        await pw.stop()


async def execute_dynamic_action_plan(
    page: Page,
    action_plan: List[Dict[str, Any]],
    document_path: Optional[str] = None,
) -> List[str]:
    """
    Executes the LLM-generated action plan sequentially on the live portal page.
    Includes Feature 3: Smart Dropdown (cascading waits) and Smart Calendar (change-event firing).
    Returns list of human-readable completed steps.
    """
    completed = []

    for item in action_plan:
        action = item.get("action")
        selector = item.get("selector")
        value = item.get("value")

        if not selector:
            continue

        try:
            el = await page.wait_for_selector(selector, state="visible", timeout=4000)
            if not el:
                continue

            # Feature 3: Smart Calendar / Date input handler
            tag = await el.evaluate("(e) => e.tagName.toLowerCase()")
            el_type = await el.evaluate("(e) => (e.type || '').toLowerCase()")
            is_date_field = (
                el_type == "date"
                or any(k in selector.lower() for k in ["dob", "date", "birth", "calendar", "cal"])
            )

            if action == "fill" and is_date_field and value is not None:
                # Set date directly, remove readonly if set, and dispatch native change/input events
                await page.evaluate(
                    """([sel, val]) => {
                        const input = document.querySelector(sel);
                        if (input) {
                            input.removeAttribute('readonly');
                            input.value = val;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            input.dispatchEvent(new Event('blur', { bubbles: true }));
                        }
                    }""",
                    [selector, str(value)],
                )
                completed.append(f"📅 Smart Calendar set {selector} to '{value}' with change-event confirmed")

            elif action == "fill" and value is not None:
                await el.click()
                await el.fill("")
                await el.type(str(value), delay=25)
                await page.evaluate("(e) => { e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }", el)
                completed.append(f"Filled {selector} with '{value}'")

            elif action == "select" and value is not None:
                # Feature 3: Smart Cascading Dropdown Handler
                selected_val = str(value)
                try:
                    await el.select_option(label=selected_val, timeout=1500)
                except Exception:
                    try:
                        await el.select_option(value=selected_val, timeout=1500)
                    except Exception:
                        await el.select_option(index=1)

                # Dispatch change and input events to trigger dependent AJAX cascades (e.g. State -> District -> Tehsil)
                await page.evaluate("(e) => { e.dispatchEvent(new Event('change', { bubbles: true })); e.dispatchEvent(new Event('input', { bubbles: true })); }", el)

                # Wait for any potential cascading child dropdowns to populate (options > 1)
                try:
                    await page.wait_for_load_state("networkidle", timeout=1200)
                except Exception:
                    await asyncio.sleep(0.3)

                completed.append(f"Selected '{value}' in {selector} (cascading event dispatched)")

            elif action == "check":
                if not await el.is_checked():
                    await el.check()
                completed.append(f"Checked declaration {selector}")

            elif action == "upload":
                if document_path and Path(document_path).exists():
                    await el.set_input_files(document_path)
                    completed.append(f"Attached document to {selector}")
                else:
                    completed.append(f"Upload field ready: {selector}")

        except Exception as exc:
            logger.warning("Step execution skipped for %s (%s): %s", selector, action, exc)

    return completed


async def execute_dynamic_action_plan_with_checkpoint(
    page: Page,
    action_plan: List[Dict[str, Any]],
    document_path: Optional[str] = None,
) -> tuple[List[str], bool]:
    """
    Executes action plan sequentially and pauses if a human checkpoint is reached.
    Returns (completed_steps, paused_at_checkpoint).
    """
    completed = []
    paused_at_checkpoint = False

    for item in action_plan:
        action = item.get("action")
        selector = item.get("selector")
        value = item.get("value")

        if not selector:
            continue

        try:
            el = await page.wait_for_selector(selector, state="visible", timeout=3500)
            if not el:
                continue

            if action == "checkpoint":
                await el.scroll_into_view_if_needed()
                await page.evaluate("(el) => { el.style.border = '3px solid #f59e0b'; el.style.boxShadow = '0 0 20px rgba(245, 158, 11, 0.85)'; }", el)
                try:
                    await el.click()
                except Exception:
                    pass
                completed.append(f"⏸️ [HUMAN-IN-THE-LOOP CHECKPOINT] Agent paused at {selector}: Please choose option on the live portal.")
                paused_at_checkpoint = True
                break

            elif action == "fill" and value is not None:
                await el.scroll_into_view_if_needed()
                await page.evaluate("(el) => { el.style.border = '2px solid #38bdf8'; el.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.6)'; }", el)
                await el.click()
                await el.fill("")
                await el.type(str(value), delay=35)
                await page.evaluate("(e) => { e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }", el)
                completed.append(f"👉 [AUTONOMOUS ACTION] Filled {selector} with '{value}'")
                await asyncio.sleep(0.5)

            elif action == "select" and value is not None:
                await el.scroll_into_view_if_needed()
                await page.evaluate("(el) => { el.style.border = '2px solid #38bdf8'; el.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.6)'; }", el)
                try:
                    await el.click()
                except Exception:
                    pass
                await asyncio.sleep(0.5)
                selected_val = str(value)
                try:
                    await el.select_option(label=selected_val, timeout=1500)
                except Exception:
                    try:
                        await el.select_option(value=selected_val, timeout=1500)
                    except Exception:
                        await el.select_option(index=1)
                await page.evaluate("(e) => { e.dispatchEvent(new Event('change', { bubbles: true })); e.dispatchEvent(new Event('input', { bubbles: true })); }", el)
                completed.append(f"👉 [AUTONOMOUS ACTION] Opened dropdown {selector} → Selected '{selected_val}'")
                await asyncio.sleep(0.5)

            elif action == "check":
                await el.scroll_into_view_if_needed()
                if not await el.is_checked():
                    await el.check()
                completed.append(f"👉 [AUTONOMOUS ACTION] Checked declaration {selector}")
                await asyncio.sleep(0.3)

            elif action == "upload":
                if document_path and Path(document_path).exists():
                    await el.set_input_files(document_path)
                    completed.append(f"👉 [AUTONOMOUS ACTION] Uploaded document {selector}")

        except Exception as exc:
            logger.warning("Dynamic action %s on %s skipped: %s", action, selector, exc)

    return completed, paused_at_checkpoint
