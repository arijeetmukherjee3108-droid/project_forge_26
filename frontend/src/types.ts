// src/types.ts
// ── Single source of truth mirroring backend/app/schemas.py ──────────────────
// IMPORTANT: field names MUST stay 1-to-1 with CitizenProfile in schemas.py

/**
 * Mirrors CitizenProfile in backend/app/schemas.py
 */
export interface ApplicantProfile {
  // Personal identification
  full_name?: string;
  father_or_guardian_name?: string;
  date_of_birth?: string;           // ISO-8601: YYYY-MM-DD
  gender?: string;                  // 'male' | 'female' | 'other'

  // Contact
  mobile_number?: string;           // 10-digit, digits only
  email?: string;

  // Identity
  aadhaar_last4?: string;

  // Address
  address_line?: string;
  village_or_city?: string;
  district?: string;
  state?: string;
  pincode?: string;                 // 6-digit

  // Socioeconomic
  occupation?: string;
  annual_income?: number;           // INR, >= 0
  category?: string;                // 'general' | 'obc' | 'sc' | 'st' | 'ews'

  // Metadata
  source_documents?: string[];
}

/**
 * Mirrors ExtractResponse in backend/app/schemas.py
 * Returned by POST /api/documents/extract and POST /api/documents/google-fetch
 */
export interface ExtractionResponse {
  profile: ApplicantProfile;        // was extracted_profile — now matches backend
  uncertain_fields: string[];
  raw_text_preview: string;
  message: string;
}

export interface RuleResult {
  rule_id: string;
  description?: string;
  passed: boolean;
  explanation: string;
}

/**
 * Mirrors EligibilityResponse in backend/app/schemas.py
 * Returned by POST /api/eligibility
 */
export interface EligibilityResponse {
  eligible?: boolean;
  service_name?: string;
  results?: RuleResult[];
  summary?: string;
  // Legacy / mock fallback support
  status?: string;
  scheme_name?: string;
  reasons?: string[];
  missing_fields?: string[];
  required_documents?: string[];
}

/**
 * Mirrors ApplyStartResponse in backend/app/schemas.py
 * Returned by POST /api/apply/start
 */
export interface ApplyStartResponse {
  session_id: string;
  status: 'running' | 'awaiting_captcha' | 'submitted' | 'failed';
  message: string;
  captcha_image_b64?: string;
  page_preview_b64?: string;
  log_steps?: string[];
}

/**
 * Mirrors ApplyResumeResponse in backend/app/schemas.py
 * Returned by POST /api/apply/resume
 */
export interface ApplyResumeResponse {
  session_id: string;
  status: 'running' | 'awaiting_captcha' | 'submitted' | 'failed';
  message: string;
  tracking_receipt?: string;
  final_screenshot_b64?: string;
}

/**
 * Mirrors ResumeRequest (used internally by App.tsx for CAPTCHA step)
 */
export interface ResumeRequest {
  session_id: string;
  captcha_text?: string;
  approve: boolean;
}

// ── Google Vault (Drive + Gmail) ──────────────────────────────────────────────

/**
 * Mirrors VaultCandidate in backend/app/schemas.py
 * One file found in Google Drive or Gmail
 */
export interface GoogleVaultFile {
  id: string;
  name: string;
  source: string;                   // 'Google Drive' | 'Gmail'
  mime_type?: string;
  size_kb?: number;
  modified_date?: string;
  // Legacy frontend-only compat field (used in file-card display)
  size?: string;
}

/**
 * Request body for POST /api/documents/google-search
 */
export interface GoogleSearchRequest {
  access_token?: string;
  query: string;
  demo_mode?: boolean;
}

/**
 * Response from POST /api/documents/google-search
 */
export interface GoogleSearchResponse {
  query: string;
  candidates: GoogleVaultFile[];
}

/**
 * Request body for POST /api/documents/google-fetch
 */
export interface GoogleFetchRequest {
  access_token?: string;
  file_id: string;
  source: string;
  demo_mode?: boolean;
}
