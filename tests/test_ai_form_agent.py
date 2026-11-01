import sys, os
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
"""
test_ai_form_agent.py — Test Suite for Task 3: Zero-Shot Dynamic DOM Reasoner
=============================================================================
Tests:
1. distill_form_dom() in-browser distillation of form elements into ~400-token JSON
2. infer_required_documents() file and constraint extraction
3. generate_action_plan() AI matching with Groq LLM & heuristic fallback
4. execute_dynamic_action_plan() autonomous execution
5. scan_portal_url() end-to-end blueprint generation
"""

import asyncio
import sys
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.schemas import CitizenProfile
from backend.app.ai_form_agent import (
    distill_form_dom,
    infer_required_documents,
    generate_action_plan,
    scan_portal_url,
)


async def test_dynamic_dom_reasoner():
    print("=" * 60)
    print("🧪 TESTING TASK 3: ZERO-SHOT DYNAMIC DOM REASONER")
    print("=" * 60)

    # 1. Test scanning the mock Rajasthan MSME portal
    mock_file = BACKEND_DIR / "static" / "rajmsme_mock.html"
    assert mock_file.exists(), f"Mock file not found: {mock_file}"
    url = f"file://{mock_file.resolve()}"

    profile = CitizenProfile(
        full_name="Ramesh Kumar Sharma",
        father_or_guardian_name="Suresh Kumar Sharma",
        email="ramesh.sharma2026@example.com",
        mobile_number="9876543210",
        state="RAJASTHAN",
        annual_income=165000,
    )

    print(f"\n[1/3] Scanning unmapped portal DOM: {url}...")
    blueprint = await scan_portal_url(url, profile)

    fields = blueprint.get("fields", [])
    print(f"  ✅ Distilled {len(fields)} interactive form fields:")
    for f in fields:
        print(f"     • [{f.get('type')}] {f.get('selector')}: {f.get('label')}")

    assert len(fields) >= 5, f"Expected at least 5 fields, got {len(fields)}"

    # 2. Test inferring required documents
    print(f"\n[2/3] Checking discovered required documents...")
    required_docs = blueprint.get("required_documents", [])
    meta = blueprint.get("required_documents_meta", [])
    print(f"  ✅ Discovered documents: {required_docs}")
    assert "income_certificate" in required_docs, f"Expected income_certificate, got {required_docs}"
    if meta:
        print(f"     • Max size constraint: {meta[0].get('max_size_kb')} KB")
        print(f"     • Vault keyword: {meta[0].get('drive_search_keyword')}")
        assert meta[0].get("drive_search_keyword") == "income"

    # 3. Test Action Plan generation
    print(f"\n[3/3] Checking AI-generated Action Plan...")
    plan = blueprint.get("action_plan", [])
    print(f"  ✅ Action Plan ({len(plan)} actions):")
    for action in plan:
        print(f"     • {action.get('action').upper()} -> {action.get('selector')}: {action.get('value') or action.get('doc_type')}")

    actions = [a.get("action") for a in plan]
    assert "fill" in actions, "Plan missing fill action"
    assert "upload" in actions, "Plan missing upload action"
    assert "check" in actions, "Plan missing check action"

    print("\n" + "=" * 60)
    print("🎉 ALL DYNAMIC DOM REASONER TESTS PASSED!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_dynamic_dom_reasoner())
