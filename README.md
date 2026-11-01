# Voice-to-Legacy (NagrikAI / SetuAI)

> **Autonomous Multilingual Voice Agent Bridging Citizens to Indian Government Portals**  
> *Transforming conversational speech and citizen documents into live, authenticated, and submitted public service applications.*

---

## 📌 Table of Contents
- [1. Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
- [2. System Architecture](#2-system-architecture)
- [3. End-to-End Workflow (The 4-Step Pipeline)](#3-end-to-end-workflow-the-4-step-pipeline)
  - [Step 1: Multilingual Intent Classification & Scheme Advisory](#step-1-multilingual-intent-classification--scheme-advisory)
  - [Step 2: Unified Document Hub & Smart Extraction](#step-2-unified-document-hub--smart-extraction)
  - [Step 3: Verification & Deterministic Eligibility Engine](#step-3-verification--deterministic-eligibility-engine)
  - [Step 4: Live Mission Control & Autonomous Browser Agent](#step-4-live-mission-control--autonomous-browser-agent)
- [4. Key Technical Features & Algorithms](#4-key-technical-features--algorithms)
- [5. API Reference](#5-api-reference)
- [6. Project Directory Structure](#6-project-directory-structure)
- [7. Getting Started (Local Setup)](#7-getting-started-local-setup)
- [8. Test Suite](#8-test-suite)
- [9. Recent Updates on Main Branch](#9-recent-updates-on-main-branch)

---

## 1. Executive Summary & Problem Statement

### The Problem
* **Bureaucratic Digital Divide:** Over 1.4 billion Indian citizens interact with hundreds of fragmented central and state government portals (*ServicePlus, National Scholarship Portal, Vidya Lakshmi, PM-KISAN, DigiLocker, BOCW Welfare Boards, e-District*).
* **Legacy Portal UX Friction:** Most `.gov.in` portals rely on 15–20 year-old server-rendered architectures with session timeouts, rigid validation, obscure form fields, cascading select dropdowns, and complex document constraints.
* **Non-Tech Citizens Excluded:** Rural citizens, gig workers, and students often struggle with English forms, resulting in heavy dependency on CSC/cyber café middlemen who charge high fees.

### The Solution
**Voice-to-Legacy** is an autonomous AI GovTech agent that:
1. **Listens in Any Language:** Understands natural citizen queries in Hindi, English, and Hinglish via voice or text.
2. **Auto-Discovers & Verifies Documents:** Extracts structured identity and financial records from multi-format files (PDFs, scans, images) or fetches them directly via Google Drive / Google Vault.
3. **Reasoning-Driven Zero-Shot Portal Distillation:** Scrapes and distills arbitrary `.gov.in` portal forms into compact ~400-token semantic representations.
4. **Handles Multi-Stage Portal Lifecycles:** Navigates the mandatory authentication gateway (Login / OTP / Auto-Registration) before driving the live form.
5. **Maintains Human-in-the-Loop Integrity:** Safely pauses at CAPTCHA and declaration checkpoints for citizen authorization.

---

## 2. System Architecture

```
[ Citizen (Voice/Text) ] ──> [ Web Speech API / TTS ]
                                    │
                                    ▼
                          [ React 18 + Vite UI ]
                          (Split-Screen Dashboard)
                                    │
                                    ├── REST API
                                    ▼
                         [ FastAPI Backend (Python) ]
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
[ Groq LLM Brain ]        [ Document Extractor ]       [ Browser Agent ]
• Intent Classifier       • Vision OCR (Qwen 3.8)      • Playwright (Chromium)
• Scheme Advisor          • Multi-doc Precedence       • DOM Distiller (~400 tokens)
• Zero-Shot Action Plan   • DOB Issue Date Filter      • Smart Dropdown / Calendar
• Anti-Hallucination      • Google Vault Hunter        • Session Gateway / Auth
```

### Technology Stack
* **Frontend:** React 18, TypeScript, Vite, Modern Responsive Glassmorphism CSS, Web Speech API (`SpeechRecognition` & `SpeechSynthesis`).
* **Backend:** FastAPI (Python 3.11), Uvicorn, Pydantic v2 schemas.
* **LLM Engine:** Groq Cloud:
  * Primary: `openai/gpt-oss-20b` (low-latency semantic routing & JSON action plans)
  * Fallback: `openai/gpt-oss-120b`
  * Vision / Multimodal OCR: `qwen/qwen3.8-27b`
* **Browser Automation:** Playwright (Python asynchronous Chromium engine).
* **Cloud Document Hunter:** Google Drive API & Google Vault integration for automated citizen document discovery.

---

## 3. End-to-End Workflow (The 4-Step Pipeline)

```
[ 1. Intent / Chat ] ──> [ 2. Documents Hub ] ──> [ 3. Verification ] ──> [ 4. Live Mission Control ]
```

### Step 1: Multilingual Intent Classification & Scheme Advisory
* **Voice & Text Input:** Citizens speak naturally: *"Mujhe college fees ke liye scholarship chahiye"* or *"Apply for construction worker welfare certificate"*.
* **LLM Brain (`/api/intent/classify`):**
  * Evaluates 4 interaction types:
    1. `chat`: Conversational guidance and assistance.
    2. `scheme_info`: Fact-checked criteria, income ceilings, and document checklists with an agent takeover proposal.
    3. `why_portal` / `portal_dispute`: Justification of chosen authority with transparent biometric/CSC limitation disclosures.
    4. `ready_to_route`: Scheme blueprint generation.
* **Authentication-Aware Routing:** Enforces government portal architecture knowledge (`requires_login: true`, `login_url`, and ordered `workflow_steps`).
* **Anti-Hallucination Engine:** Strictly eliminates hallucinated domains (e.g. non-existent `cwws.gov.in` is routed to official ServicePlus Form 1784; NSP is kept at `scholarships.gov.in` instead of fake subpaths like `/vidyalakshmi`).
* **Offline Fallback:** Heuristic keyword-scoring fallback ensures 100% uptime even if LLM APIs encounter rate limits.

---

### Step 2: Unified Document Hub & Smart Extraction
* **Universal Upload & Google Vault:** Upload local files (PDF, JPG, PNG) or click **"Google Vault Auto-Document Hunter"** to scan Google Drive for matching keywords (`marksheet`, `income`, `aadhaar`, `caste`).
* **Document-Free Bypass:** If a service requires no document uploads (e.g., DigiLocker citizen sign-up or voter roll lookup), Step 2 is automatically bypassed directly to Step 3.
* **Enforced Validation:** If a scheme requires document proof, the user is prevented from proceeding until documents are attached.
* **Strict Aadhaar Priority for Date of Birth:**
  * Solves the common discrepancy where marksheet printing/declaration dates (e.g. `2022-05-18`) overwrite birth dates.
  * Filters out dates from within the last 3 years and pre-1920 dates.
  * Aadhaar legally binding identity fields (`date_of_birth`, `full_name`, `aadhaar_last4`) strictly take highest precedence in multi-document batches.
* **Uncertain Field Flagging:** Fields extracted with ambiguity are highlighted for citizen verification in Step 3.

---

### Step 3: Verification & Deterministic Eligibility Engine
* **Profile Verification:** Citizen reviews and edits pre-filled data (Full Name, Father's Name, DOB, Gender, Category, Mobile, Email, State, Pincode, Income).
* **Live DOM Reader Badge:** Indicates whether fields were distilled live from a target portal DOM or structured registries.
* **Deterministic Rule Checker (`/api/eligibility`):**
  * Evaluates Min/Max Age, Income ceiling, State domicile, and required fields.
  * General education loans support optional income ceilings (synced in recent updates).
  * Returns human-readable explanations per rule.
* **Explicit Legal Confirmation:** Requires the citizen to check *"I confirm and verify the accuracy of this data"* before unlocking the live agent.

---

### Step 4: Live Mission Control & Autonomous Browser Agent
* **Split-Screen Mission Control:**
  * **Left Column (Agent Terminal):** Real-time execution logs with timestamps, stage indicators, and human checkpoints.
  * **Right Column (Live Portal Frame):** Interactive form view with an option to toggle to a raw Playwright browser screenshot.
* **Multi-Stage Portal Lifecycle (Login $\rightarrow$ Form $\rightarrow$ Submit):**
  1. **Stage 1: Citizen Sign-In / Authentication Gateway (`portalPhase: 'LOGIN'`):**
     * Solves the real-world requirement that portals require authentication before application access.
     * Offers **Existing Account Sign-In** (Mobile/Email + Password or OTP with instant delivery) or **⚡ One-Click Auto-Register** (agent creates portal account from verified documents).
     * Establishing a session generates an authentic session token (`GOV_SESSION_...`) and automatically advances to Stage 2.
  2. **Stage 2: Scheme Application Form (`portalPhase: 'FORM'`):**
     * Displays the authenticated form (Vidya Lakshmi CELAF, ServicePlus Form 1784, or live distilled DOM fields) with an active `● AUTHENTICATED SESSION` indicator.
     * Injects verified profile details and attached documents into portal fields.
     * Citizen clicks **"Proceed to Final Verification & CAPTCHA Checkpoint →"** to proceed.
  3. **Stage 3: Verification Checkpoint & Submission (`portalPhase: 'SUBMIT'`):**
     * Human-in-the-loop CAPTCHA solver with reload and **text-to-speech audio CAPTCHA playback** for accessibility.
     * Mandatory terms & conditions declaration.
     * **"Approve & Submit Registration"** finalizes submission and displays the official acknowledgement receipt.
* **Honest Offline / Unreachable Screen:**
  * Completely removes silent mock fallbacks. If a remote government server is down or fails DNS (`DNS_PROBE_FINISHED_NXDOMAIN`), an offline diagnostic card displays the error, a **"Verify in Real Browser ↗"** button, a **"🔄 Retry Connection"** button, and a **"Switch to Verified Portal"** fallback.

---

## 4. Key Technical Features & Algorithms

| Feature | Technical Implementation | Purpose |
| :--- | :--- | :--- |
| **Zero-Shot DOM Distillation** | `distill_form_dom()` evaluates interactive inputs, dropdowns, and file fields, compressing large HTML DOMs into a ~400-token JSON schema. | Allows the agent to automate unmapped portals without hardcoding selectors. |
| **Smart Cascading Dropdown** | Playwright listens for AJAX network muting after selecting state/district before populating child options. | Handles asynchronous cascading dropdowns on Indian government portals. |
| **Smart Calendar Handler** | Formats ISO dates (`YYYY-MM-DD` / `DD/MM/YYYY`) and fires explicit `input`, `change`, and `blur` events. | Prevents calendar JavaScript plugins from clearing automated entries. |
| **Aadhaar DOB Precedence** | Rejects issue/declaration dates from within the last 3 years; Aadhaar DOB strictly overrides marksheet dates. | Eliminates date-of-birth discrepancies between academic certificates and identity cards. |
| **Audio CAPTCHA Accessibility** | Web Speech API synthesis formats CAPTCHA text with character spacing for auditory verification. | Enhances accessibility for visually impaired citizens. |

---

## 5. API Reference

### Intent & Scheme Classification
* **`POST /api/intent/classify`**
  * **Input:** `{"text": "I want a scholarship for college"}`
  * **Output:** `matched_service_id`, `service_name`, `portal_name`, `portal_url`, `requires_login`, `login_url`, `workflow_steps`, `suggested_documents`, `ai_advice`.

### Document Extraction
* **`POST /api/documents/extract`**
  * **Input:** Multipart form upload (`file: File`).
  * **Output:** `profile: CitizenProfile`, `raw_text_preview`, `uncertain_fields`, `method: "groq_vision" | "pypdf"`.

### Eligibility Rules
* **`POST /api/eligibility`**
  * **Input:** `{"profile": {...}, "service_id": "vidyalakshmi"}`
  * **Output:** `eligible: bool`, `results: RuleResult[]`, `summary: string`.

### Google Vault Integration
* **`POST /api/vault/search`**
  * **Input:** `{"keywords": ["income", "marksheet"]}`
  * **Output:** Matched Drive file metadata.
* **`POST /api/vault/fetch`**
  * **Input:** `{"file_id": "..."}`
  * **Output:** Downloaded document path and extraction response.

### Autonomous Browser Agent
* **`POST /api/agent/start`**
  * **Input:** `{"profile": {...}, "service_id": "1784", "document_filename": "..."}`
  * **Output:** `session_id`, `status: "awaiting_captcha" | "running" | "failed"`, `captcha_image_b64`, `page_preview_b64`, `steps_completed`.
* **`POST /api/agent/resume`**
  * **Input:** `{"session_id": "...", "captcha_text": "...", "approve_submit": true}`
  * **Output:** `status: "submitted"`, `tracking_receipt`, `final_screenshot_b64`.

---

## 6. Project Directory Structure

```
project_forge_26/
├── backend/
│   ├── app/
│   │   ├── ai_form_agent.py    # Zero-Shot DOM Reasoner & Dynamic Action Plan Executor
│   │   ├── browser_agent.py    # Autonomous Playwright Chromium Engine & Session Store
│   │   ├── eligibility.py      # LLM Intent Router, Scheme Advisor & Deterministic Rules
│   │   ├── extractor.py        # Vision OCR & PDF Document Precedence Engine
│   │   ├── google_vault.py     # Google Drive & Document Hunter Integration
│   │   ├── llm_client.py       # Groq Cloud API Wrapper with Fallback Models
│   │   ├── main.py             # FastAPI App, CORS, and Endpoints
│   │   ├── portal_maps.py      # Deterministic Fast-Path Portal Configs
│   │   └── schemas.py          # Pydantic v2 Models & API Request/Response Types
│   ├── static/                 # Offline Sandbox Mock Portal Templates
│   └── requirements.txt        # Backend Python Dependencies
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # 4-Step Pipeline, Split-Screen Dashboard & Mission Control
│   │   ├── App.css             # High-Tech Glassmorphism Design & Responsive Styles
│   │   ├── api.ts              # Axios Backend API Client & Fallback Catalogs
│   │   └── types.ts            # TypeScript Definitions & Shared Interfaces
│   ├── package.json
│   └── vite.config.ts
├── tests/
│   ├── test_intent_llm.py      # Intent Classifier & Scheme Advisor Unit Tests
│   ├── test_extractor_llm.py   # OCR Extraction & Aadhaar Priority Tests
│   └── test_ai_form_agent.py   # Zero-Shot DOM Reasoner & Dynamic Form Agent Tests
└── README.md                   # Project Documentation
```

---

## 7. Getting Started (Local Setup)

### Prerequisites
* **Python:** 3.11+
* **Node.js:** 18+ & npm
* **Groq Cloud API Key:** Obtain from [console.groq.com](https://console.groq.com)

### 1. Clone the Repository
```bash
git clone https://github.com/arijeetmukherjee3108-droid/project_forge_26.git
cd project_forge_26
```

### 2. Backend Setup
```bash
cd backend
python -m venv .venv

# On Windows:
.\.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
playwright install chromium
```

Create `backend/.env`:
```env
GROQ_API_KEY=your_groq_api_key_here
BROWSER_HEADLESS=false
```

Run the backend server:
```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
* **Swagger API Documentation:** `http://127.0.0.1:8000/docs`

### 3. Frontend Setup
In a new terminal:
```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```
* **Web Application:** `http://127.0.0.1:5173/`

---

## 8. Test Suite

Run the full automated test suite:
```bash
# From project root:
backend\.venv\Scripts\pytest tests/test_intent_llm.py tests/test_extractor_llm.py
```

Run the frontend production build verification:
```bash
cd frontend
npm run build
```

---

## 9. Recent Updates on Main Branch

* **Multi-Stage Portal Authentication:** Integrated portal sign-in gateway and auto-registration directly into Step 4 before application form filling.
* **Document-Free Flow Optimization:** Services like DigiLocker auto-bypass document upload steps directly to Step 3.
* **Vidya Lakshmi Enhancements:** Added annual family income and postal pincode fields to the CELAF form; made loan ceilings flexible.
* **Deterministic Aadhaar Priority:** Enforced Aadhaar precedence over all secondary marksheets for Date of Birth.
* **Honest Government Portal Down/NXDOMAIN Screen:** Real-time unreachability badge and retry actions replace silent mock template fallbacks.
