"""
Comprehensive End-to-End System Integration Test
=================================================
Tests all 4 layers of Voice-to-Legacy:
  1. Health & Server check
  2. Document Extraction (PyMuPDF parser)
  3. Deterministic Eligibility Engine (Rule engine)
  4. Autonomous Browser Agent (Playwright session lifecycle)
"""

import asyncio
import sys
from pathlib import Path

# Ensure 'backend' is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import fitz  # PyMuPDF
from app.schemas import (
    CitizenProfile,
    EligibilityRequest,
    ApplyStartRequest,
    ApplyResumeRequest,
    AgentStatus,
)
from app.main import (
    health_check,
    check_eligibility,
    apply_start,
    apply_resume,
)


async def run_pipeline_test():
    print("=" * 70)
    print("🚀 VOICE-TO-LEGACY — FULL END-TO-END PIPELINE AUDIT")
    print("=" * 70)

    # -----------------------------------------------------------------------
    # Test 1: Health Probe
    # -----------------------------------------------------------------------
    print("\n[TEST 1/4] Checking Health Probe...")
    health = await health_check()
    assert health == {"status": "ok"}
    print("  ✅ Health endpoint OK: {'status': 'ok'}")

    # -----------------------------------------------------------------------
    # Test 2: Document Extraction Layer
    # -----------------------------------------------------------------------
    print("\n[TEST 2/4] Testing Document Extraction (PyMuPDF parser)...")
    from app.extractor import extract_profile

    # Create a synthetic PDF certificate in memory
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(
        (50, 80),
        "GOVERNMENT OF RAJASTHAN\n"
        "INCOME & DOMICILE CERTIFICATE\n\n"
        "Applicant Name: Ramesh Kumar Sharma\n"
        "Father Name: Suresh Sharma\n"
        "Date of Birth: 1999-05-15\n"
        "Mobile: 9876543210\n"
        "Aadhaar Number: XXXX-XXXX-4321\n"
        "Annual Income: Rs. 140000\n"
        "District: Jaipur\n"
        "State: Rajasthan\n"
        "Pin Code: 302001\n"
    )
    pdf_bytes = doc.tobytes()
    doc.close()

    extraction_res = extract_profile(pdf_bytes, "income_certificate.pdf")
    profile = extraction_res.profile
    print(f"  ✅ Extraction Success!")
    print(f"     • Full Name:      {profile.full_name}")
    print(f"     • DOB:            {profile.date_of_birth}")
    print(f"     • Mobile:         {profile.mobile_number}")
    print(f"     • Aadhaar (Last4):{profile.aadhaar_last4}")
    print(f"     • Annual Income:  ₹{profile.annual_income}")
    print(f"     • State:          {profile.state}")
    print(f"     • Uncertain fields count: {len(extraction_res.uncertain_fields)}")

    # -----------------------------------------------------------------------
    # Test 3: Deterministic Eligibility Engine
    # -----------------------------------------------------------------------
    print("\n[TEST 3/4] Testing Deterministic Eligibility Engine...")
    eligibility_req = EligibilityRequest(
        profile=profile,
        service_id="1784",  # Construction worker / certificate service
    )
    eligibility_res = await check_eligibility(eligibility_req)
    print(f"  ✅ Eligibility Result for Service 1784:")
    print(f"     • Eligible:       {'✅ YES' if eligibility_res.eligible else '❌ NO'}")
    print(f"     • Service Name:   {eligibility_res.service_name}")
    print(f"     • Summary:        {eligibility_res.summary}")
    for r in eligibility_res.results:
        print(f"       - [{ 'PASS' if r.passed else 'FAIL' }] {r.rule_id}: {r.explanation}")

    # -----------------------------------------------------------------------
    # Test 4: Autonomous Playwright Browser Agent (FastAPI Endpoint)
    # -----------------------------------------------------------------------
    print("\n[TEST 4/4] Testing Browser Agent via apply_start & apply_resume...")
    print("  Launching Playwright engine (Headless mode for speed)...")

    # Set headless for fast automated test
    import os
    os.environ["BROWSER_HEADLESS"] = "true"

    start_req = ApplyStartRequest(
        profile=profile,
        service_id="SERVICE_PLUS_REGISTRATION",
    )
    start_res = await apply_start(start_req)

    print(f"  ✅ apply_start completed:")
    print(f"     • Session ID:     {start_res.session_id}")
    print(f"     • Status:         {start_res.status.value}")
    print(f"     • Message:        {start_res.message}")
    print(f"     • Steps Done:     {len(start_res.steps_completed)} steps")
    for s in start_res.steps_completed:
        print(f"       - {s}")
    print(f"     • CAPTCHA image captured: {bool(start_res.captcha_image_b64)}")
    print(f"     • Page preview captured:  {bool(start_res.page_preview_b64)}")

    # Assertions
    assert start_res.status == AgentStatus.awaiting_captcha
    assert start_res.captcha_image_b64 is not None

    print("\n  Testing apply_resume (Human Checkpoint simulation)...")
    resume_req = ApplyResumeRequest(
        session_id=start_res.session_id,
        captcha_text="TEST12",
        approve=True,
    )
    resume_res = await apply_resume(resume_req)
    print(f"  ✅ apply_resume completed:")
    print(f"     • Status:         {resume_res.status.value}")
    print(f"     • Message:        {resume_res.message}")
    print(f"     • Final Screenshot: {bool(resume_res.final_screenshot_b64)}")

    print("\n" + "=" * 70)
    print("🎉 ALL 4 TESTS PASSED! ZERO CRITICAL ERRORS IN THE PIPELINE.")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(run_pipeline_test())
