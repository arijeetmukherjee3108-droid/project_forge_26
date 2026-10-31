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
} from './types';

const BASE_URL = 'http://127.0.0.1:8000';

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
 */
export const checkEligibility = async (
  profile: ApplicantProfile
): Promise<EligibilityResponse> => {
  const resp = await axios.post<EligibilityResponse>(`${BASE_URL}/api/eligibility`, {
    profile,
    service_id: '1784',
  });
  return resp.data;
};

// ── Browser Agent ─────────────────────────────────────────────────────────────

/**
 * Start the Playwright browser agent to fill the government portal.
 * POST /api/apply/start  →  { profile, service_id, document_filename? }
 */
export const startApplication = async (
  profile: ApplicantProfile,
  documentFilename?: string
): Promise<ApplyStartResponse> => {
  const resp = await axios.post<ApplyStartResponse>(`${BASE_URL}/api/apply/start`, {
    profile,
    service_id: 'SERVICE_PLUS_REGISTRATION',
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
