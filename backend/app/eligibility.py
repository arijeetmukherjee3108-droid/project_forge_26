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

from app.schemas import (
    Category,
    CitizenProfile,
    EligibilityResponse,
    RuleResult,
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
                        "mobile_number",
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
}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

UNKNOWN_SERVICE_NAME = "Unknown Service"


def check_eligibility(
    profile: CitizenProfile, service_id: str
) -> EligibilityResponse:
    """
    Run deterministic eligibility rules for `service_id` against `profile`.

    - Raises ValueError for unknown service_id (caller converts to 404).
    - Never crashes on None/missing fields; each rule handles None gracefully.
    - No network calls, no file I/O, no personal-data logging.
    """
    if service_id not in SERVICE_RULES:
        raise ValueError(
            f"Unknown service_id: '{service_id}'. "
            f"Supported: {list(SERVICE_RULES.keys())}"
        )

    service_cfg = SERVICE_RULES[service_id]
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
