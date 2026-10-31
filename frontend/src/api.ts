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
} from './types';

const BASE_URL = 'http://127.0.0.1:8000';

// ── 0. Intent Classification (Bugs 1 & 2: Dynamic Search Routing) ─────────────

/**
 * Known Government Services catalog for client-side fallback
 * when teammate's endpoint is being developed.
 */
export const KNOWN_SERVICES_CATALOG: IntentClassificationResponse[] = [
  {
    service_id: 'vidyalakshmi',
    service_name: 'Vidya Lakshmi — Higher Education Loan & Scholarship Portal',
    portal_id: 'VIDYA_LAKSHMI_PORTAL',
    portal_name: 'Vidya Lakshmi Portal (Ministry of Education & NSDL)',
    portal_url: 'https://www.vidyalakshmi.co.in/Students/',
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
];

/**
 * Intelligent keyword matcher to classify citizen intent
 * when teammate's endpoint is pending or offline.
 */
export const matchIntentFallback = (query: string): IntentClassificationResponse => {
  const q = (query || '').toLowerCase().trim();

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

  // Citizen Certificates (Income, Caste, Domicile, Residence)
  if (/certificate|caste|income|domicile|residence|praman|patra|birth|death|bonafide/i.test(q)) {
    return KNOWN_SERVICES_CATALOG[4]; // General ServicePlus e-District
  }

  // Default: General ServicePlus Citizen Registration
  return KNOWN_SERVICES_CATALOG[4];
};

/**
 * Classifies citizen intent into target government service.
 * Tries teammate's POST /api/intent/classify first; falls back smoothly if pending.
 */
export const classifyIntent = async (query: string): Promise<IntentClassificationResponse> => {
  try {
    const resp = await axios.post<IntentClassificationResponse>(
      `${BASE_URL}/api/intent/classify`,
      { query },
      { timeout: 2500 }
    );
    if (resp.data && resp.data.service_id) {
      return resp.data;
    }
  } catch {
    // Teammate's endpoint not yet up: use intelligent fallback
  }
  return matchIntentFallback(query);
};

// ── Document Extraction ───────────────────────────────────────────────────────

/**
 * Upload a PDF/image and receive the extracted CitizenProfile.
 * POST /api/documents/extract
 */
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
  approve: boolean = true
): Promise<ApplyResumeResponse> => {
  const resp = await axios.post<ApplyResumeResponse>(`${BASE_URL}/api/apply/resume`, {
    session_id: sessionId,
    captcha_text: captchaText,
    approve,
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
