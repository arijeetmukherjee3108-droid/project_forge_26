// src/api.ts
// ── All HTTP calls to FastAPI backend at http://127.0.0.1:8000 ───────────────
import axios from 'axios';
import {
  ApplicantProfile,
  ExtractionResponse,
  EligibilityResponse,
  ApplyStartResponse,
  ApplyResumeResponse,
  GoogleSearchRequest,
  GoogleSearchResponse,
  GoogleVaultFile,
  GoogleFetchRequest,
  IntentClassificationResponse,
  DynamicScanResponse,
} from './types';

// ── Base URL Configuration ──────────────────────────────────────────────────
// Put your live Render backend URL here (e.g. 'https://your-backend.onrender.com')
// or configure VITE_API_URL in Render static site environment variables.
export const RENDER_BACKEND_URL = '';

const getBaseUrl = (): string => {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() !== '') {
    return envUrl.trim().replace(/\/+$/, '');
  }
  if (RENDER_BACKEND_URL && RENDER_BACKEND_URL.trim() !== '') {
    return RENDER_BACKEND_URL.trim().replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost') {
    return `http://${window.location.hostname}:8000`;
  }
  return 'http://127.0.0.1:8000';
};
const BASE_URL = getBaseUrl();

// ── 0. Intent Classification (Bugs 1 & 2: Dynamic Search Routing) ─────────────

export interface BackendIntentClassifyResponse {
  matched_service_id: string;
  service_name: string;
  confidence: number;
  explanation: string;
  suggested_documents?: string[];
  portal_name?: string;
  portal_url?: string;
  category?: string;
  ai_advice?: string;
  can_automate?: boolean;
  cta_message?: string;
  message_type?: 'chat' | 'scheme_info' | 'ready_to_route';
  reason_chosen?: string;
  limitations?: string;
  fields_to_fill?: string[];
  requires_login?: boolean;
  login_url?: string;
  workflow_steps?: string[];
}

/**
 * Known Government Services catalog for client-side fallback
 * and UI metadata augmentation.
 */
export const KNOWN_SERVICES_CATALOG: IntentClassificationResponse[] = [
  {
    service_id: 'vidyalakshmi',
    service_name: 'Vidya Lakshmi — Higher Education Loan & Scholarship Portal',
    portal_id: 'VIDYA_LAKSHMI_PORTAL',
    portal_name: 'Vidya Lakshmi Portal (Ministry of Education & NSDL)',
    portal_url: 'https://www.vidyalakshmi.co.in/Students/login',
    category: 'education',
    required_documents: ['High School Marksheet', 'College Admission Proof', 'Income Certificate'],
    confidence: 0.95,
    description: 'National single-window portal for students seeking education loans, interest subsidies, and national scholarships.',
  },
  {
    service_id: '1784',
    service_name: 'Construction Worker Registration / Welfare Scheme (ServicePlus 1784)',
    portal_id: 'SERVICE_PLUS_REGISTRATION',
    portal_name: 'National ServicePlus Portal — Labour Welfare Board',
    portal_url: 'https://serviceonline.gov.in/citizenRegistration.html',
    category: 'welfare',
    required_documents: ['Income Certificate', 'Aadhaar Card', 'Age Proof'],
    confidence: 0.98,
    description: 'Direct welfare assistance, health support, and official certificate registration for registered construction workers.',
  },
  {
    service_id: 'pmkisan',
    service_name: 'PM-KISAN — Pradhan Mantri Kisan Samman Nidhi',
    portal_id: 'PM_KISAN_PORTAL',
    portal_name: 'PM-KISAN Official Government Portal',
    portal_url: 'https://pmkisan.gov.in/',
    category: 'agriculture',
    required_documents: ['Land Records (Khatauni/Khasra)', 'Aadhaar Card', 'Bank Account Passbook'],
    confidence: 0.92,
    description: 'Direct income support of ₹6,000 per year in three equal installments to all landholding farmer families.',
  },
  {
    service_id: 'ayushman_bharat',
    service_name: 'Ayushman Bharat — PM-JAY Free Healthcare Scheme',
    portal_id: 'PM_JAY_PORTAL',
    portal_name: 'National Health Authority (NHA) Beneficiary Portal',
    portal_url: 'https://beneficiary.nha.gov.in/',
    category: 'health',
    required_documents: ['Ration Card', 'Aadhaar Card / Family ID'],
    confidence: 0.93,
    description: 'Cashless healthcare coverage of up to ₹5,00,000 per family per year for secondary and tertiary hospitalization.',
  },
  {
    service_id: 'ration_card',
    service_name: 'National Food Security (NFSA) Subsidized Food & Ration Card',
    portal_id: 'SERVICE_PLUS_REGISTRATION',
    portal_name: 'National Food Security Portal / State e-District',
    portal_url: 'https://serviceonline.gov.in/citizenRegistration.html',
    category: 'general',
    required_documents: ['Income Certificate', 'Aadhaar Card', 'Family Domicile Proof'],
    confidence: 0.92,
    description: 'Subsidized grain distribution, Antyodaya Anna Yojana, and NFSA ration card issuance.',
  },
  {
    service_id: 'citizen_registration',
    service_name: 'National ServicePlus — Citizen General e-Services & Certificates',
    portal_id: 'SERVICE_PLUS_REGISTRATION',
    portal_name: 'National ServicePlus Portal (NIC)',
    portal_url: 'https://serviceonline.gov.in/citizenRegistration.html',
    category: 'general',
    required_documents: ['Aadhaar Card / Photo ID', 'Address Proof', 'Recent Photograph'],
    confidence: 0.88,
    description: 'Universal unified digital portal for applying to state certificates (income, caste, domicile) and citizen welfare schemes.',
  },
  {
    service_id: 'digilocker_apaar',
    service_name: 'DigiLocker — APAAR ID / ABC ID Issuance',
    portal_id: 'DIGILOCKER_APAAR_PORTAL',
    portal_name: 'DigiLocker (Academic Bank of Credits / Ministry of Education)',
    portal_url: 'https://www.digilocker.gov.in/web/login',
    category: 'education',
    required_documents: [],
    confidence: 0.99,
    description: 'APAAR (Automated Permanent Academic Account Registry) ID is the One Nation One Student ID created under NEP 2020 by the Ministry of Education. Digitally issued directly via DigiLocker from official school & university records without requiring physical document uploads.',
    ai_advice: 'I will help you issue your APAAR ID through DigiLocker. The process is completely paperless (0 document uploads required). Our autonomous agent will assist you with logging into DigiLocker, automatically navigate directly to the APAAR / Academic Bank of Credits issuance form, select the academic options, pause at the Human-in-the-Loop checkpoint for you to select your specific School / Board, autofill your student details, and safely stop right before final submission.',
    cta_message: 'Proceed to Verification & Launch Agent',
    workflow_steps: [
      '1. Live Citizen Authentication & Sign-In on DigiLocker',
      '2. Autonomous Deep Navigation to APAAR ID Form',
      '3. Human-in-the-Loop Selection: Pick your School/Board',
      '4. Form Pre-fill & Sovereign Final Review (Pre-Submit Stop)'
    ]
  },
  {
    service_id: 'digilocker',
    service_name: 'DigiLocker — National Digital Document Wallet & Citizen Sign-up',
    portal_id: 'DIGILOCKER_PORTAL',
    portal_name: 'DigiLocker Official Portal (MeitY)',
    portal_url: 'https://www.digilocker.gov.in/web/login',
    category: 'general',
    required_documents: [],
    confidence: 0.98,
    description: 'DigiLocker is the Government of India\'s flagship digital identity and document wallet under Digital India (MeitY), providing every citizen with a secure cloud account for authentic digital documents issued directly by government authorities.',
    ai_advice: 'DigiLocker lets you store, access, and share your important documents (Aadhaar, PAN, marksheets, certificates) digitally. You can register or sign in directly with your mobile number or Aadhaar linked with real-time OTP verification.',
    cta_message: 'Launch DigiLocker Portal',
  },
];

/**
 * Intelligent keyword matcher to classify citizen intent
 * when teammate's endpoint is pending or offline.
 */
export const matchIntentFallback = (query: string): IntentClassificationResponse => {
  const q = (query || '').toLowerCase().trim();

  // DigiLocker APAAR / ABC ID
  if (/apaar|abc\s*id|academic\s*bank|student\s*id.*digilocker|digilocker.*apaar/i.test(q)) {
    return KNOWN_SERVICES_CATALOG.find((k) => k.service_id === 'digilocker_apaar') || KNOWN_SERVICES_CATALOG[0];
  }

  // DigiLocker Citizen Sign-up
  if (/digilocker|digi\s*locker|digital\s*locker/i.test(q)) {
    const base = KNOWN_SERVICES_CATALOG.find((k) => k.service_id === 'digilocker') || KNOWN_SERVICES_CATALOG[0];
    return {
      ...base,
      description: 'DigiLocker is the Government of India\'s flagship digital identity and document wallet under Digital India (MeitY), providing every citizen with a secure cloud account for authentic digital documents issued directly by government authorities.',
      ai_advice: 'DigiLocker lets you store, view, and share government-issued documents digitally (including Aadhaar, PAN card, vehicle registration, and academic marksheets). You can register or log in using your mobile number or Aadhaar with live OTP verification. All documents issued in DigiLocker are legally recognized on par with original physical documents under Rule 9A of the Information Technology Rules.',
      cta_message: 'Launch DigiLocker Portal',
    };
  }

  // Education & Scholarships
  if (/scholarship|vidya|lakshmi|loan|student|college|school|university|fees|study|matric|degree|education|btech|mbbs/i.test(q)) {
    return KNOWN_SERVICES_CATALOG[0]; // Vidya Lakshmi
  }

  // Farmers & Agriculture
  if (/kisan|farmer|krishi|agriculture|khet|land|crop|fasal|pmkisan|pm-kisan/i.test(q)) {
    return KNOWN_SERVICES_CATALOG[2]; // PM-KISAN
  }

  // Healthcare
  if (/ayushman|health|hospital|medical|treatment|doctor|pm-jay|pmjay|bima|swasthya/i.test(q)) {
    return KNOWN_SERVICES_CATALOG[3]; // Ayushman Bharat
  }

  // Labour & Construction Workers
  if (/construction|worker|labour|labor|mazdoor|bhavan|shramik|karamchari|1784|welfare/i.test(q)) {
    return KNOWN_SERVICES_CATALOG[1]; // ServicePlus 1784
  }

  // Subsidized Ration & Food Security
  if (/ration|rashan|food|grain|bpl|nfsa|antyodaya/i.test(q)) {
    return KNOWN_SERVICES_CATALOG[4]; // Ration Card
  }

  // Citizen Certificates (Income, Caste, Domicile, Residence)
  if (/certificate|caste|income|domicile|residence|praman|patra|birth|death|bonafide/i.test(q)) {
    return KNOWN_SERVICES_CATALOG[5]; // General ServicePlus e-District
  }

  // Default: General ServicePlus Citizen Registration
  return KNOWN_SERVICES_CATALOG[5];
};

/**
 * Classifies citizen intent into target government service.
 * Connects directly to backend POST /api/intent/classify with intelligent fallback.
 */
export const classifyIntent = async (query: string): Promise<IntentClassificationResponse> => {
  try {
    const resp = await axios.post<BackendIntentClassifyResponse & { portal_name?: string; portal_url?: string; category?: string }>(
      `${BASE_URL}/api/intent/classify`,
      { text: query, query },
      { timeout: 15000 }
    );
    if (resp.data && resp.data.matched_service_id) {
      const b = resp.data;
      const rawId = b.matched_service_id.toLowerCase();
      const sid = rawId.replace(/[-_]/g, '');

      const match =
        KNOWN_SERVICES_CATALOG.find((k) => k.service_id.toLowerCase().replace(/[-_]/g, '') === sid);

      const isChat = b.message_type === 'chat' || b.matched_service_id === 'general_chat';

      return {
        service_id: b.matched_service_id,
        service_name: b.service_name || match?.service_name || b.matched_service_id,
        portal_id: match?.portal_id || b.matched_service_id.toUpperCase(),
        portal_name: b.portal_name || match?.portal_name || b.service_name,
        portal_url: b.portal_url || match?.portal_url || '',
        category: (b.category as any) || match?.category || 'general',
        required_documents: Array.isArray(b.suggested_documents) ? b.suggested_documents : (match?.required_documents || []),
        confidence: b.confidence ?? 0.95,
        description: b.explanation || match?.description || 'AI classified citizen intent.',
        ai_advice: b.ai_advice || b.explanation || match?.description,
        can_automate: b.can_automate ?? !isChat,
        cta_message: b.cta_message || `Apply for ${b.service_name || 'Scheme'}`,
        message_type: b.message_type || (isChat ? 'chat' : 'scheme_info'),
        reason_chosen: b.reason_chosen,
        limitations: b.limitations,
        fields_to_fill: b.fields_to_fill || [],
        requires_login: b.requires_login ?? true,
        login_url: b.login_url || b.portal_url,
        workflow_steps: b.workflow_steps || [
          '1. Citizen Portal Authentication & Sign-In',
          '2. Scheme Application Form',
          '3. CAPTCHA Verification & Final Submission',
        ],
      };
    }
  } catch (err) {
    console.warn('Backend intent classification error; using heuristic fallback', err);
  }

  // Pure client-side fallback if backend is unreachable
  return matchIntentFallback(query);
};
export const extractDocument = async (file: File): Promise<ExtractionResponse> => {
  const form = new FormData();
  form.append('file', file);
  const resp = await axios.post<ExtractionResponse>(
    `${BASE_URL}/api/documents/extract`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return resp.data;
};

// ── Eligibility ───────────────────────────────────────────────────────────────

/**
 * Check if the citizen profile is eligible for the service.
 * POST /api/eligibility  →  { profile, service_id }
 * Dynamically resolves service_id instead of hardcoding 1784.
 */
export const checkEligibility = async (
  profile: ApplicantProfile,
  serviceId?: string
): Promise<EligibilityResponse> => {
  const targetId = serviceId || profile.target_service_id || '1784';
  const resp = await axios.post<EligibilityResponse>(`${BASE_URL}/api/eligibility`, {
    profile,
    service_id: targetId,
  });
  return resp.data;
};

// ── Browser Agent ─────────────────────────────────────────────────────────────

/**
 * Start the Playwright browser agent to fill the government portal.
 * POST /api/apply/start  →  { profile, service_id, document_filename? }
 * Dynamically resolves portal/service target instead of hardcoding.
 */
export const startApplication = async (
  profile: ApplicantProfile,
  serviceOrPortalId?: string,
  documentFilename?: string
): Promise<ApplyStartResponse> => {
  const targetId = serviceOrPortalId || profile.target_portal_id || profile.target_service_id || 'SERVICE_PLUS_REGISTRATION';
  const resp = await axios.post<ApplyStartResponse>(`${BASE_URL}/api/apply/start`, {
    profile,
    service_id: targetId,
    document_filename: documentFilename ?? null,
  });
  return resp.data;
};

/**
 * Resume a paused browser-agent session after CAPTCHA entry.
 * POST /api/apply/resume  →  { session_id, captcha_text, approve }
 */
export const resumeApplication = async (
  sessionId: string,
  captchaText: string,
  approve: boolean = true,
  submitFinal?: boolean
): Promise<ApplyResumeResponse> => {
  const isFinal = submitFinal !== undefined ? submitFinal : approve;
  const resp = await axios.post<ApplyResumeResponse>(`${BASE_URL}/api/apply/resume`, {
    session_id: sessionId,
    captcha_text: captchaText,
    approve,
    submit_final: isFinal,
  });
  return resp.data;
};

// ── Google Vault (Drive + Gmail) ──────────────────────────────────────────────

/**
 * Call 1: Search Google Drive & Gmail for matching documents.
 * POST /api/documents/google-search  →  GoogleSearchResponse { query, candidates[] }
 */
export const searchGoogleVault = async (
  payload: GoogleSearchRequest
): Promise<GoogleVaultFile[]> => {
  const resp = await axios.post<GoogleSearchResponse>(
    `${BASE_URL}/api/documents/google-search`,
    payload
  );
  // Backend returns { query, candidates: VaultCandidate[] }
  return resp.data?.candidates ?? [];
};

/**
 * Call 2: Download the chosen file, save to backend/uploads/, and return CitizenProfile.
 * POST /api/documents/google-fetch  →  ExtractResponse { profile, uncertain_fields, ... }
 */
export const fetchGoogleVaultFile = async (
  payload: GoogleFetchRequest
): Promise<ExtractionResponse> => {
  const resp = await axios.post<ExtractionResponse>(
    `${BASE_URL}/api/documents/google-fetch`,
    payload
  );
  return resp.data;
};

/**
 * Task 3: Zero-Shot Dynamic DOM Reasoner for Any Indian Portal
 * POST /api/form/scan-dom → DynamicScanResponse { portal_url, title, fields, required_documents, action_plan }
 */
export const scanPortalDom = async (
  portalUrl: string,
  profile?: ApplicantProfile
): Promise<DynamicScanResponse> => {
  const resp = await axios.post<DynamicScanResponse>(`${BASE_URL}/api/form/scan-dom`, {
    portal_url: portalUrl,
    profile,
  });
  return resp.data;
};

/**
 * Autonomous Deep-Navigation for DigiLocker APAAR ID form post-login.
 * POST /api/apply/digilocker-navigate
 */
export const navigateDigilockerApaar = async (sessionId: string): Promise<ApplyStartResponse> => {
  const resp = await axios.post<ApplyStartResponse>(`${BASE_URL}/api/apply/digilocker-navigate`, {
    session_id: sessionId,
  });
  return resp.data;
};

/**
 * Autonomous autofill after Human-in-the-Loop Institution/Board selection.
 * POST /api/apply/digilocker-autofill
 */
export const autofillDigilockerApaar = async (
  sessionId: string,
  selectedBoard?: string
): Promise<ApplyResumeResponse> => {
  const resp = await axios.post<ApplyResumeResponse>(`${BASE_URL}/api/apply/digilocker-autofill`, {
    session_id: sessionId,
    selected_board: selectedBoard || null,
  });
  return resp.data;
};

/**
 * Check live browser session state and current URL.
 * GET /api/apply/session-status/{session_id}
 */
export const checkSessionStatus = async (sessionId: string): Promise<{
  session_id: string;
  status: string;
  current_url: string;
  is_logged_in: boolean;
  steps_completed: string[];
  page_preview_b64?: string;
  citizen_guidance?: string;
  citizen_guidance_hindi?: string;
  message?: string;
}> => {
  const resp = await axios.get(`${BASE_URL}/api/apply/session-status/${sessionId}`);
  return resp.data;
};


