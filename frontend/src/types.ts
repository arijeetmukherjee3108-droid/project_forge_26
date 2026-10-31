// src/types.ts

/**
 * Universal applicant profile used across all government forms.
 * The fields cover the superset of data most portals require.
 */
export interface ApplicantProfile {
  // Personal details
  full_name?: string;
  first_name?: string;
  last_name?: string;
  father_name?: string;
  date_of_birth?: string; // DD/MM/YYYY
  gender?: string;

  // Contact details
  mobile?: string;
  email?: string;

  // Address details
  state?: string;
  district?: string;
  pin_code?: string;
  address_line?: string;

  // Socio‑economic details (optional for many schemes)
  annual_family_income?: number;
  category?: string; // e.g., General, OBC, SC, ST

  // Uploaded document path – the agent will re‑attach this file
  uploaded_doc_path?: string;

  // Intent – which portal / service the user wants to use
  target_intent?: string; // free‑text or a short id (e.g., "serviceonline:directApply")

  // Verification flag – required before launching the browser agent
  user_verified?: boolean;
}

/** Response from the document‑extraction endpoint */
export interface ExtractionResponse {
  extracted_profile: ApplicantProfile;
  uncertain_fields: string[]; // names of fields that need human review
  raw_text_preview: string; // a short snippet of the raw PDF text
  message: string;
}

/** Response from the eligibility‑checking endpoint */
export interface EligibilityResponse {
  status: 'ELIGIBLE' | 'INELIGIBLE' | 'MISSING_INFO';
  scheme_name?: string; // name of the scheme if applicable
  reasons: string[]; // why eligible / why not
  missing_fields?: string[]; // fields that still need input
  required_documents?: string[]; // any extra docs the portal asks for
}

/** Payload sent when the user resumes after the CAPTCHA checkpoint */
export interface ResumeRequest {
  session_id: string;
  captcha_text?: string;
  otp_text?: string;
  action: 'FILL_ONLY' | 'SUBMIT' | 'CLOSE';
}
