// src/api.ts
import axios from 'axios';
import {
  ApplicantProfile,
  ExtractionResponse,
  EligibilityResponse,
  ResumeRequest,
  GoogleSearchRequest,
  GoogleVaultFile,
  GoogleFetchRequest,
  GoogleFetchResponse,
} from './types';

// Base URL of the FastAPI server – change if you run it on a different host/port.
const BASE_URL = 'http://127.0.0.1:8000';

/**
 * Upload a PDF/Image and receive the extracted profile.
 */
export const extractDocument = async (file: File): Promise<ExtractionResponse> => {
  const form = new FormData();
  form.append('file', file);
  const resp = await axios.post<ExtractionResponse>(
    `${BASE_URL}/api/documents/extract`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    }
  );
  return resp.data;
};

/**
 * Send the (possibly edited) profile to the eligibility engine.
 */
export const checkEligibility = async (
  profile: ApplicantProfile
): Promise<EligibilityResponse> => {
  const resp = await axios.post<EligibilityResponse>(
    `${BASE_URL}/api/eligibility`,
    profile
  );
  return resp.data;
};

/**
 * Launch the live Playwright agent – only used after Milestone A is verified.
 */
export const startApplication = async (
  profile: ApplicantProfile
): Promise<any> => {
  const resp = await axios.post(`${BASE_URL}/api/apply/start`, profile);
  return resp.data;
};

/**
 * Call 1: Search citizen's Google Drive & Gmail for matching documents.
 * POST /api/documents/google-search
 */
export const searchGoogleVault = async (
  payload: GoogleSearchRequest
): Promise<GoogleVaultFile[]> => {
  const resp = await axios.post<any>(
    `${BASE_URL}/api/documents/google-search`,
    payload
  );
  if (Array.isArray(resp.data)) return resp.data;
  if (Array.isArray(resp.data?.files)) return resp.data.files;
  return [];
};

/**
 * Call 2: Download the selected file, save to backend uploads, and return CitizenProfile.
 * POST /api/documents/google-fetch
 */
export const fetchGoogleVaultFile = async (
  payload: GoogleFetchRequest
): Promise<GoogleFetchResponse> => {
  const resp = await axios.post<GoogleFetchResponse>(
    `${BASE_URL}/api/documents/google-fetch`,
    payload
  );
  return resp.data;
};

/**
 * Resume a paused session after the user fills the CAPTCHA/OTP.
 */
export const resumeApplication = async (
  payload: ResumeRequest
): Promise<any> => {
  const resp = await axios.post(`${BASE_URL}/api/apply/resume`, payload);
  return resp.data;
};
