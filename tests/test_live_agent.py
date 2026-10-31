"""
Quick manual test script to run the Playwright Browser Agent live on desktop.
"""

import asyncio
import sys
from pathlib import Path

# Add project root to sys.path so 'backend' is always importable
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.schemas import CitizenProfile
from backend.app.browser_agent import start_application, resume_application


async def main():
    print("=" * 60)
    print("🚀 VOICE-TO-LEGACY: AUTONOMOUS BROWSER AGENT TEST")
    print("=" * 60)

    # 1. Create a sample citizen profile
    profile = CitizenProfile(
        full_name="Ramesh Kumar Sharma",
        email="ramesh.sharma2026@example.com",
        mobile_number="9876543210",
        state="RAJASTHAN",  # ServicePlus uses UPPERCASE state names
    )

    print(f"\n[1/3] Launching agent for {profile.full_name}...")
    print("      Target: ServicePlus (NIC Citizen Registration)")
    print("      Watch your screen for the Chromium window!\n")

    response = await start_application(
        profile=profile,
        service_id="SERVICE_PLUS_REGISTRATION",
    )

    print("-" * 60)
    print(f"Status:          {response.status.value}")
    print(f"Message:         {response.message}")
    print(f"Session ID:      {response.session_id}")
    print(f"Steps Completed: {len(response.steps_completed)}")
    for i, step in enumerate(response.steps_completed, 1):
        print(f"  {i}. {step}")

    has_captcha = bool(response.captcha_image_b64)
    has_preview = bool(response.page_preview_b64)
    print(f"CAPTCHA cropped: {'✅ YES' if has_captcha else '❌ NO'} ({len(response.captcha_image_b64 or '')} chars)")
    print(f"Page Preview:    {'✅ YES' if has_preview else '❌ NO'} ({len(response.page_preview_b64 or '')} chars)")
    print("-" * 60)

    if has_captcha:
        print("\n[2/3] Agent successfully reached the CAPTCHA checkpoint!")
        print("      To resume with human verification:")
        captcha_input = input("\nEnter the CAPTCHA text shown on screen (or press Enter to abort): ").strip()
        
        if captcha_input:
            print(f"\n[3/3] Resuming session {response.session_id} with CAPTCHA: '{captcha_input}'...")
            resume_res = await resume_application(
                session_id=response.session_id,
                captcha_text=captcha_input,
                approve=True,
            )
            print(f"Final Status:  {resume_res.status.value}")
            print(f"Final Message: {resume_res.message}")
            print(f"Screenshot:    {'✅ Captured' if resume_res.final_screenshot_b64 else 'None'}")
        else:
            print("Aborted by user. Cleaning up session...")
            await resume_application(
                session_id=response.session_id,
                captcha_text="",
                approve=False,
            )

    print("\n✅ Test finished.")


if __name__ == "__main__":
    asyncio.run(main())

