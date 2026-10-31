// src/api.ts
import axios from 'axios';
import {
  ApplicantProfile,
  ExtractionResponse,
  EligibilityResponse,
  ResumeRequest,
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
 * Launch the live Playwright agent – only used after Milestone A is verified.
 */
export const startApplication = async (
  profile: ApplicantProfile
): Promise<any> => {
  const resp = await axios.post(`${BASE_URL}/api/apply/start`, profile);
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
