"""
eligibility.py — Deterministic rule-based eligibility engine.

NO AI, NO randomness. Same profile + service_id always → same result.

The entire rule configuration lives in SERVICE_RULES (one dict, easy to edit).
Add new services by inserting a new key. Each rule function receives the
CitizenProfile and returns a RuleResult.

Public API: check_eligibility(profile, service_id) -> EligibilityResponse

IMPORTANT: Every threshold below is marked with
  # ASSUMPTION: verify against the official form/guidelines
because the real criteria for each service have NOT been confirmed on the
live portal. These are sensible generic placeholders only.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Callable, Optional

try:
    from app.schemas import (
        Category,
        CitizenProfile,
        EligibilityResponse,
        RuleResult,
        IntentClassifyResponse,
    )
except ImportError:
    from backend.app.schemas import (
        Category,
        CitizenProfile,
        EligibilityResponse,
        RuleResult,
        IntentClassifyResponse,
    )

# ---------------------------------------------------------------------------
# Rule helpers
# ---------------------------------------------------------------------------

RuleFunc = Callable[[CitizenProfile, dict[str, Any]], RuleResult]


def _age_from_dob(dob_iso: Optional[str]) -> Optional[int]:
    """Return age in full years today, or None if dob is missing/invalid."""
    if not dob_iso:
        return None
    try:
        bd = date.fromisoformat(dob_iso)
        today = date.today()
        return (today - bd).days // 365
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Individual rule functions
# (each takes profile + rule_config dict from SERVICE_RULES)
# ---------------------------------------------------------------------------

def _rule_min_age(profile: CitizenProfile, cfg: dict) -> RuleResult:
    """Citizen must be at least cfg['min_age'] years old."""
    min_age: int = cfg["min_age"]
    age = _age_from_dob(profile.date_of_birth)
    if age is None:
        return RuleResult(
            rule_id="min_age",
            description=f"Age must be at least {min_age} years",
            passed=False,
            explanation="Missing: date_of_birth, please add it so we can verify your age.",
        )
    if age >= min_age:
        return RuleResult(
            rule_id="min_age",
            description=f"Age must be at least {min_age} years",
            passed=True,
            explanation=f"Your age is {age} years, which meets the minimum of {min_age} years.",
        )
    return RuleResult(
        rule_id="min_age",
        description=f"Age must be at least {min_age} years",
        passed=False,
        explanation=f"Your age is {age} years. This service requires applicants to be at least {min_age} years old.",
    )


def _rule_max_age(profile: CitizenProfile, cfg: dict) -> RuleResult:
    """Citizen must be at most cfg['max_age'] years old."""
    max_age: int = cfg["max_age"]
    age = _age_from_dob(profile.date_of_birth)
    if age is None:
        return RuleResult(
            rule_id="max_age",
            description=f"Age must be at most {max_age} years",
            passed=False,
            explanation="Missing: date_of_birth, please add it.",
        )
    if age <= max_age:
        return RuleResult(
            rule_id="max_age",
            description=f"Age must be at most {max_age} years",
            passed=True,
            explanation=f"Your age is {age} years, which is within the maximum of {max_age} years.",
        )
    return RuleResult(
        rule_id="max_age",
        description=f"Age must be at most {max_age} years",
        passed=False,
        explanation=f"Your age is {age} years. This service is available only up to age {max_age}.",
    )


def _rule_required_fields(profile: CitizenProfile, cfg: dict) -> RuleResult:
    """All fields listed in cfg['fields'] must be non-None."""
    fields: list[str] = cfg["fields"]
    missing = [f for f in fields if getattr(profile, f, None) is None]
    if not missing:
        return RuleResult(
            rule_id="required_fields",
            description="Mandatory profile fields must be present",
            passed=True,
            explanation="All required fields (name, mobile, address, etc.) are filled in.",
        )
    pretty = ", ".join(missing)
    return RuleResult(
        rule_id="required_fields",
        description="Mandatory profile fields must be present",
        passed=False,
        explanation=f"The following required fields are missing: {pretty}. Please complete your profile.",
    )


def _rule_income_ceiling(profile: CitizenProfile, cfg: dict) -> RuleResult:
    """Annual income must be ≤ cfg['ceiling_inr']."""
    ceiling: int = cfg["ceiling_inr"]
    # ASSUMPTION: verify against the official form/guidelines
    if profile.annual_income is None:
        return RuleResult(
            rule_id="income_ceiling",
            description=f"Annual income must be ≤ Rs {ceiling:,}",
            passed=False,
            explanation="Missing: annual_income, please add it.",
        )
    inc = profile.annual_income
    formatted_inc = f"Rs {inc:,}"
    formatted_ceil = f"Rs {ceiling:,}"
    if inc <= ceiling:
        return RuleResult(
            rule_id="income_ceiling",
            description=f"Annual income must be ≤ Rs {ceiling:,}",
            passed=True,
            explanation=f"Your annual income is {formatted_inc}, which is within the {formatted_ceil} limit.",
        )
    return RuleResult(
        rule_id="income_ceiling",
        description=f"Annual income must be ≤ Rs {ceiling:,}",
        passed=False,
        explanation=f"Your annual income is {formatted_inc}, which exceeds the limit of {formatted_ceil} for this service.",
    )


def _rule_allowed_states(profile: CitizenProfile, cfg: dict) -> RuleResult:
    """Citizen's state must be in cfg['states'] (case-insensitive)."""
    allowed: list[str] = [s.lower() for s in cfg["states"]]
    # ASSUMPTION: verify against the official form/guidelines
    if not profile.state:
        return RuleResult(
            rule_id="allowed_states",
            description="Must be a resident of an eligible state",
            passed=False,
            explanation="Missing: state, please add your state of residence.",
        )
    if profile.state.lower() in allowed:
        return RuleResult(
            rule_id="allowed_states",
            description="Must be a resident of an eligible state",
            passed=True,
            explanation=f"Your state ({profile.state}) is eligible for this service.",
        )
    pretty_allowed = ", ".join(cfg["states"])
    return RuleResult(
        rule_id="allowed_states",
        description="Must be a resident of an eligible state",
        passed=False,
        explanation=(
            f"Your state ({profile.state}) is not in the list of eligible states: {pretty_allowed}."
        ),
    )


def _rule_allowed_categories(profile: CitizenProfile, cfg: dict) -> RuleResult:
    """Citizen's category must be in cfg['categories']."""
    allowed: list[str] = [c.lower() for c in cfg["categories"]]
    # ASSUMPTION: verify against the official form/guidelines
    if not profile.category:
        return RuleResult(
            rule_id="allowed_categories",
            description="Must belong to an eligible social category",
            passed=False,
            explanation="Missing: category (e.g. General, OBC, SC, ST, EWS). Please fill it in.",
        )
    cat_val = profile.category.value if hasattr(profile.category, "value") else str(profile.category)
    if cat_val.lower() in allowed:
        return RuleResult(
            rule_id="allowed_categories",
            description="Must belong to an eligible social category",
            passed=True,
            explanation=f"Your category ({cat_val.upper()}) is eligible for this service.",
        )
    pretty_allowed = ", ".join(c.upper() for c in cfg["categories"])
    return RuleResult(
        rule_id="allowed_categories",
        description="Must belong to an eligible social category",
        passed=False,
        explanation=f"Your category ({cat_val.upper()}) is not eligible. Eligible categories: {pretty_allowed}.",
    )


def _rule_occupation(profile: CitizenProfile, cfg: dict) -> RuleResult:
    """Citizen's occupation must match one of cfg['allowed_occupations'] (case-insensitive)."""
    allowed: list[str] = [o.lower() for o in cfg["allowed_occupations"]]
    if not profile.occupation:
        return RuleResult(
            rule_id="occupation",
            description=f"Must work in an eligible occupation: {', '.join(cfg['allowed_occupations'])}",
            passed=False,
            explanation="Missing: occupation, please specify your occupation.",
        )
    occ = profile.occupation.lower()
    if any(a in occ or occ in a for a in allowed):
        return RuleResult(
            rule_id="occupation",
            description=f"Must work in an eligible occupation: {', '.join(cfg['allowed_occupations'])}",
            passed=True,
            explanation=f"Your occupation ({profile.occupation}) is eligible for this scheme.",
        )
    return RuleResult(
        rule_id="occupation",
        description=f"Must work in an eligible occupation: {', '.join(cfg['allowed_occupations'])}",
        passed=False,
        explanation=f"Your occupation ({profile.occupation}) is not eligible. Required: {', '.join(cfg['allowed_occupations'])}.",
    )


def _rule_required_documents(profile: CitizenProfile, cfg: dict) -> RuleResult:
    """At least one document from cfg['doc_tags'] must appear in source_documents."""
    required_any: list[str] = cfg["doc_tags"]
    # ASSUMPTION: verify against the official form/guidelines
    found = [d for d in required_any if d in profile.source_documents]
    if found:
        return RuleResult(
            rule_id="required_documents",
            description=f"At least one of these documents must be uploaded: {', '.join(required_any)}",
            passed=True,
            explanation=f"Found the required document(s): {', '.join(found)}.",
        )
    return RuleResult(
        rule_id="required_documents",
        description=f"At least one of these documents must be uploaded: {', '.join(required_any)}",
        passed=False,
        explanation=(
            f"None of the required documents were detected in your upload. "
            f"Please provide at least one of: {', '.join(required_any)}."
        ),
    )


# ---------------------------------------------------------------------------
# SERVICE_RULES — add new services here. Easy to edit and extend.
# ---------------------------------------------------------------------------
# Structure for each entry:
# {
#   "name": str,           — human-readable service name
#   "rules": [             — list of (rule_func, config_dict) pairs
#       (func, {"key": value, ...}),
#   ]
# }
#
# ASSUMPTION: ALL thresholds below are placeholders.
# They must be verified against the real ServicePlus portal pages:
#   https://serviceonline.gov.in/directApply.do?serviceId=1784
#   https://serviceonline.gov.in/citizenRegistration.html

SERVICE_RULES: dict[str, dict] = {
    "1784": {
        # Construction Worker / Citizen Certificate — ServiceId 1784
        "name": "Construction Worker Registration / Citizen Certificate (ServicePlus 1784)",
        "rules": [
            (
                _rule_min_age,
                {
                    "min_age": 18,
                    # ASSUMPTION: verify against the official form/guidelines
                },
            ),
            (
                _rule_max_age,
                {
                    "max_age": 60,
                    # ASSUMPTION: verify against the official form/guidelines
                },
            ),
            (
                _rule_required_fields,
                {
                    "fields": [
                        "full_name",
                        "father_or_guardian_name",
                        "mobile_number",
                        "email",
                        "state",
                        "district",
                        "pincode",
                        "address_line",
                    ],
                    # ASSUMPTION: verify against the official form/guidelines
                },
            ),
            (
                _rule_income_ceiling,
                {
                    "ceiling_inr": 300_000,
                    # ASSUMPTION: verify against the official form/guidelines
                    # Commonly Rs 3,00,000 for labour-welfare schemes
                },
            ),
            (
                _rule_required_documents,
                {
                    "doc_tags": ["income_certificate", "aadhaar"],
                    # ASSUMPTION: verify against the official form/guidelines
                },
            ),
        ],
    },
    "citizen_registration": {
        # ServicePlus Citizen Registration
        "name": "ServicePlus Citizen Self-Registration",
        "rules": [
            (
                _rule_min_age,
                {
                    "min_age": 18,
                    # ASSUMPTION: verify against the official form/guidelines
                },
            ),
            (
                _rule_required_fields,
                {
                    "fields": [
                        "full_name",
                        "mobile_number",
                        "email",
                        "state",
                        "district",
                    ],
                    # ASSUMPTION: verify against the official form/guidelines
                },
            ),
        ],
    },
    "vidyalakshmi": {
        # Vidya Lakshmi Higher Education Scholarship & Education Loan
        "name": "Vidya Lakshmi Higher Education Scholarship & Education Loan Portal",
        "rules": [
            (
                _rule_min_age,
                {
                    "min_age": 16,
                },
            ),
            (
                _rule_max_age,
                {
                    "max_age": 35,
                },
            ),
            (
                _rule_income_ceiling,
                {
                    "ceiling_inr": 450_000,
                },
            ),
            (
                _rule_required_fields,
                {
                    "fields": [
                        "full_name",
                        "date_of_birth",
                        "mobile_number",
                        "email",
                        "state",
                        "pincode",
                        "annual_income",
                    ],
                },
            ),
            (
                _rule_required_documents,
                {
                    "doc_tags": ["marksheet", "income_certificate", "aadhaar"],
                },
            ),
        ],
    },
    "pm_kisan": {
        # Pradhan Mantri Kisan Samman Nidhi (PM-KISAN)
        "name": "Pradhan Mantri Kisan Samman Nidhi (PM-KISAN ₹6,000/yr Direct Support)",
        "rules": [
            (
                _rule_min_age,
                {
                    "min_age": 18,
                },
            ),
            (
                _rule_income_ceiling,
                {
                    "ceiling_inr": 250_000,
                },
            ),
            (
                _rule_required_fields,
                {
                    "fields": [
                        "full_name",
                        "father_or_guardian_name",
                        "mobile_number",
                        "state",
                        "district",
                        "pincode",
                    ],
                },
            ),
            (
                _rule_required_documents,
                {
                    "doc_tags": ["land_record", "bank_passbook", "aadhaar", "income_certificate"],
                },
            ),
        ],
    },
    "ration_card": {
        # NFSA Priority Household / BPL Ration Card
        "name": "National Food Security (NFSA) Priority Household / BPL Ration Card",
        "rules": [
            (
                _rule_min_age,
                {
                    "min_age": 18,
                },
            ),
            (
                _rule_income_ceiling,
                {
                    "ceiling_inr": 150_000,
                },
            ),
            (
                _rule_required_fields,
                {
                    "fields": [
                        "full_name",
                        "father_or_guardian_name",
                        "mobile_number",
                        "state",
                        "district",
                        "address_line",
                        "pincode",
                        "annual_income",
                    ],
                },
            ),
            (
                _rule_required_documents,
                {
                    "doc_tags": ["income_certificate", "aadhaar", "domicile"],
                },
            ),
        ],
    },
}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

UNKNOWN_SERVICE_NAME = "Unknown Service"

_SERVICE_ALIASES: dict[str, str] = {
    "pmkisan": "pm_kisan",
    "pm-kisan": "pm_kisan",
    "pm_kisan_samman_nidhi": "pm_kisan",
    "vidya_lakshmi": "vidyalakshmi",
    "vidya-lakshmi": "vidyalakshmi",
    "vidyalaxmi": "vidyalakshmi",
    "scholarship": "vidyalakshmi",
    "ration": "ration_card",
    "ration-card": "ration_card",
    "rashan": "ration_card",
    "bpl": "ration_card",
    "nfsa": "ration_card",
    "service_plus_registration": "citizen_registration",
    "serviceplus_registration": "citizen_registration",
    "serviceplus": "citizen_registration",
}


def check_eligibility(
    profile: CitizenProfile, service_id: str
) -> EligibilityResponse:
    """
    Run deterministic eligibility rules for `service_id` against `profile`.

    - Raises ValueError for unknown service_id (caller converts to 404).
    - Never crashes on None/missing fields; each rule handles None gracefully.
    - No network calls, no file I/O, no personal-data logging.
    """
    normalized_id = _SERVICE_ALIASES.get(service_id.lower().strip(), service_id.strip())
    if normalized_id not in SERVICE_RULES:
        raise ValueError(
            f"Unknown service_id: '{service_id}'. "
            f"Supported: {list(SERVICE_RULES.keys())}"
        )

    service_cfg = SERVICE_RULES[normalized_id]
    service_name: str = service_cfg["name"]
    rule_pairs: list[tuple[RuleFunc, dict]] = service_cfg["rules"]

    results: list[RuleResult] = []
    for rule_func, rule_cfg in rule_pairs:
        results.append(rule_func(profile, rule_cfg))

    passed_count = sum(1 for r in results if r.passed)
    total_count = len(results)
    all_passed = passed_count == total_count

    failed_rules = [r for r in results if not r.passed]
    if all_passed:
        summary = (
            f"You meet all {total_count} requirements for '{service_name}'. "
            "You can proceed to apply."
        )
    else:
        failed_desc = "; ".join(r.rule_id for r in failed_rules)
        summary = (
            f"You meet {passed_count} of {total_count} requirements for '{service_name}'. "
            f"Issues: {failed_desc}. Please review the details below."
        )

    return EligibilityResponse(
        eligible=all_passed,
        service_name=service_name,
        results=results,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Intent Classification Helper
# ---------------------------------------------------------------------------

_INTENT_KEYWORD_MAP: dict[str, dict] = {
    "vidyalakshmi": {
        "keywords": [
            "scholarship", "vidya", "lakshmi", "laxmi", "student", "education",
            "study", "college", "school", "loan", "university", "fee", "tuition",
            "padhai", "chhatravritti", "vidyarthi", "shiksha", "degree", "higher education",
        ],
        "default_docs": ["marksheet", "income_certificate", "aadhaar"],
        "description": "Matched higher education, scholarship, or student loan intent.",
    },
    "pm_kisan": {
        "keywords": [
            "kisan", "farmer", "agriculture", "cultivator", "farming", "samman nidhi",
            "6000", "6,000", "kheti", "fasal", "krishi", "landholder", "patwari",
            "khasra", "khatauni", "crop", "seed", "fertilizer", "dbt",
        ],
        "default_docs": ["land_record", "bank_passbook", "aadhaar"],
        "description": "Matched small/marginal farmer income support scheme (PM-KISAN).",
    },
    "ration_card": {
        "keywords": [
            "ration", "rashan", "food", "grain", "bpl", "nfsa", "antyodaya",
            "ration card", "khadya", "gehun", "chawal", "fair price shop", "pds",
            "food security", "khadyann", "subsidy food",
        ],
        "default_docs": ["income_certificate", "aadhaar", "domicile"],
        "description": "Matched food security, subsidized grains, or ration card intent.",
    },
    "1784": {
        "keywords": [
            "construction", "labour", "labor", "worker", "shramik", "majdur",
            "mazdoor", "building worker", "welfare board", "certificate", "bhavan",
            "construction worker", "unorganized", "karigar",
        ],
        "default_docs": ["income_certificate", "aadhaar"],
        "description": "Matched construction / unorganized labour welfare certificate (Service 1784).",
    },
    "citizen_registration": {
        "keywords": [
            "register", "registration", "signup", "sign up", "account", "login",
            "serviceplus", "service online", "create account", "new user",
        ],
        "default_docs": ["aadhaar"],
        "description": "Matched general ServicePlus citizen self-registration intent.",
    },
}


def classify_citizen_intent(text: str) -> IntentClassifyResponse:
    """
    Classify the citizen's prompt/voice transcript to the closest government scheme.
    Uses bilingual (English + Hindi) semantic keyword matching with zero network latency.
    """
    raw = (text or "").strip().lower()
    if not raw:
        svc_cfg = SERVICE_RULES["1784"]
        return IntentClassifyResponse(
            matched_service_id="1784",
            service_name=svc_cfg["name"],
            confidence=0.5,
            explanation="No query text provided; defaulted to ServicePlus 1784.",
            suggested_documents=["income_certificate", "aadhaar"],
        )

    best_service_id = "1784"
    best_score = 0
    matched_reason = "General citizen application"

    for svc_id, data in _INTENT_KEYWORD_MAP.items():
        score = 0
        for kw in data["keywords"]:
            if " " in kw and kw in raw:
                score += 3  # Multi-word phrase exact match gets higher weight
            elif kw in raw.split() or kw in raw:
                score += 1
        if score > best_score:
            best_score = score
            best_service_id = svc_id
            matched_reason = data["description"]

    svc_cfg = SERVICE_RULES.get(best_service_id, SERVICE_RULES["1784"])
    service_name = svc_cfg["name"]

    if best_score >= 3:
        confidence = 0.95
    elif best_score == 2:
        confidence = 0.88
    elif best_score == 1:
        confidence = 0.78
    else:
        confidence = 0.60
        matched_reason = "Query did not strongly match a specific scheme; defaulted to ServicePlus 1784."

    suggested_docs = _INTENT_KEYWORD_MAP.get(best_service_id, {}).get("default_docs", ["aadhaar"])

    return IntentClassifyResponse(
        matched_service_id=best_service_id,
        service_name=service_name,
        confidence=confidence,
        explanation=matched_reason,
        suggested_documents=suggested_docs,
    )
