"""
portal_maps.py — Declarative Portal Configuration Registry

Pure data definitions mapping government portals to their DOM selectors
and navigation steps. No browser execution logic lives here.

Used by browser_agent.py to drive any portal generically.
"""

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Action primitives
# ---------------------------------------------------------------------------

class ActionType(str, Enum):
    """Every atomic thing the browser agent can do on a page."""
    NAVIGATE = "navigate"       # Go to URL, wait for DOM ready
    FILL = "fill"               # Clear + type into a text/email/password input
    SELECT = "select"           # Pick an option from a <select> dropdown
    CHECK = "check"             # Toggle a checkbox or radio button
    UPLOAD = "upload"           # Attach file via input[type="file"]
    CLICK = "click"             # Click a button / tab / link
    CHECKPOINT = "checkpoint"   # Pause for human (CAPTCHA / final approval)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class PortalStep(BaseModel):
    """A single atomic action the agent must perform on the portal."""
    action: ActionType
    field_key: Optional[str] = None          # Maps to CitizenProfile key
    value: Optional[str] = None              # Static/default value
    selectors: List[str] = Field(default_factory=list)  # CSS/XPath, tried in order
    timeout_ms: int = 10000
    description: str = ""


class PortalConfig(BaseModel):
    """Full navigation blueprint for one government portal / form."""
    portal_id: str
    name: str
    entry_url: str
    ignore_https_errors: bool = True
    steps: List[PortalStep]
    captcha_image_selectors: List[str] = Field(default_factory=list)
    captcha_input_selectors: List[str] = Field(default_factory=list)
    submit_button_selectors: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Portal definitions
# ---------------------------------------------------------------------------

_SERVICE_PLUS = PortalConfig(
    portal_id="SERVICE_PLUS_REGISTRATION",
    name="ServicePlus — NIC Citizen Registration",
    entry_url="https://serviceonline.gov.in/citizenRegistration.html",
    captcha_image_selectors=["#captchaImage", "img[src*='captchaImage']"],
    captcha_input_selectors=["#captchaAnswer", "input[name='captchaAnswer']"],
    submit_button_selectors=["#btnSubmit", "button.btn-success"],
    steps=[
        PortalStep(
            action=ActionType.NAVIGATE,
            description="Open ServicePlus citizen registration page",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="full_name",
            selectors=["#spdvCitizenName", "input[name='spdvCitizenName']"],
            description="Enter applicant full name",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="email",
            selectors=["#EmailText", "input[name='spdvCitizenEmailId']"],
            description="Enter email address",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="mobile",
            selectors=["#mobileNumberText", "input[name='spdvCitizenMobileNo']"],
            description="Enter mobile number",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="password",
            selectors=["#PasswordText", "input[name='PasswordText']"],
            description="Set account password",
        ),
        PortalStep(
            action=ActionType.SELECT,
            field_key="state",
            selectors=["#selectState", "select[name='selectState']"],
            description="Select applicant state",
        ),
        PortalStep(
            action=ActionType.CHECK,
            field_key=None,
            value="true",
            selectors=["input[name='tc']", "input[type='checkbox']"],
            description="Accept terms and conditions",
        ),
        PortalStep(
            action=ActionType.CHECKPOINT,
            field_key="captcha",
            selectors=["#captchaImage", "img[src*='captchaImage']"],
            description="Pause — human solves CAPTCHA",
        ),
    ],
)

_LOCAL_MOCK = PortalConfig(
    portal_id="LOCAL_MOCK_PORTAL",
    name="Local Mock Portal — Offline Demo Fallback",
    entry_url="http://localhost:8000/mock_portal.html",
    ignore_https_errors=False,
    captcha_image_selectors=["#captchaImage"],
    captcha_input_selectors=["#captchaAnswer"],
    submit_button_selectors=["#btnSubmit"],
    steps=[
        PortalStep(
            action=ActionType.NAVIGATE,
            description="Open local mock portal",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="full_name",
            selectors=["#spdvCitizenName"],
            description="Enter applicant full name",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="email",
            selectors=["#EmailText"],
            description="Enter email address",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="mobile",
            selectors=["#mobileNumberText"],
            description="Enter mobile number",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="password",
            selectors=["#PasswordText"],
            description="Set account password",
        ),
        PortalStep(
            action=ActionType.SELECT,
            field_key="state",
            selectors=["#selectState"],
            description="Select applicant state",
        ),
        PortalStep(
            action=ActionType.UPLOAD,
            field_key="document_path",
            selectors=["#documentUpload", "input[type='file']"],
            description="Upload supporting document",
        ),
        PortalStep(
            action=ActionType.CHECK,
            value="true",
            selectors=["input[name='tc']"],
            description="Accept terms and conditions",
        ),
        PortalStep(
            action=ActionType.CHECKPOINT,
            field_key="captcha",
            selectors=["#captchaImage"],
            description="Pause — human solves CAPTCHA",
        ),
    ],
)

_VIDYA_LAKSHMI = PortalConfig(
    portal_id="VIDYA_LAKSHMI_PORTAL",
    name="Vidya Lakshmi — Scholarship & Education Loan Portal",
    entry_url="https://www.vidyalakshmi.co.in/Students/",
    captcha_image_selectors=["#imgCaptcha", "img[alt='captcha']"],
    captcha_input_selectors=["#txtCaptcha", "input[name='captcha']"],
    submit_button_selectors=["#btnRegister", "input[type='submit']"],
    steps=[
        PortalStep(
            action=ActionType.NAVIGATE,
            description="Open Vidya Lakshmi student registration",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="full_name",
            selectors=["#txtName", "input[name='StudentName']"],
            description="Enter student name",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="email",
            selectors=["#txtEmail", "input[name='EmailId']"],
            description="Enter email address",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="mobile",
            selectors=["#txtMobile", "input[name='MobileNo']"],
            description="Enter mobile number",
        ),
        PortalStep(
            action=ActionType.FILL,
            field_key="dob",
            selectors=["#txtDOB", "input[name='DateOfBirth']"],
            description="Enter date of birth",
        ),
        PortalStep(
            action=ActionType.SELECT,
            field_key="state",
            selectors=["#ddlState", "select[name='State']"],
            description="Select state of domicile",
        ),
        PortalStep(
            action=ActionType.CHECKPOINT,
            field_key="captcha",
            selectors=["#imgCaptcha"],
            description="Pause — human solves CAPTCHA",
        ),
    ],
)


# ---------------------------------------------------------------------------
# Registry & helpers
# ---------------------------------------------------------------------------

PORTAL_REGISTRY: Dict[str, PortalConfig] = {
    cfg.portal_id: cfg for cfg in [_SERVICE_PLUS, _LOCAL_MOCK, _VIDYA_LAKSHMI]
}


def get_portal_config(portal_id: str) -> PortalConfig:
    """Return config for the given portal or raise a helpful KeyError."""
    if portal_id not in PORTAL_REGISTRY:
        available = ", ".join(PORTAL_REGISTRY.keys())
        raise KeyError(
            f"Portal '{portal_id}' not found. Available: {available}"
        )
    return PORTAL_REGISTRY[portal_id]


def list_available_portals() -> List[Dict[str, str]]:
    """Return a summary list of all registered portals."""
    return [
        {"portal_id": cfg.portal_id, "name": cfg.name, "url": cfg.entry_url}
        for cfg in PORTAL_REGISTRY.values()
    ]

