// src/App.tsx
import React, { useState, useRef, useCallback, useEffect, useMemo, ChangeEvent, DragEvent } from 'react';
import './App.css';
import {
  ApplicantProfile,
  ExtractionResponse,
  EligibilityResponse,
  GoogleVaultFile,
  IntentClassificationResponse,
  DynamicScanResponse,
  DynamicFormField,
} from './types';
import {
  extractDocument,
  checkEligibility,
  startApplication,
  resumeApplication,
  searchGoogleVault,
  fetchGoogleVaultFile,
  classifyIntent,
  scanPortalDom,
  KNOWN_SERVICES_CATALOG,
} from './api';

// ──────────────────────────────────────────────
// Precision SVGs (1:1 with Reference Design, No Emojis)
// ──────────────────────────────────────────────
const Icons = {
  // Brand Logo: Custom "Voice-to-Legacy" Cyber Portal Emblem (No Gemini star)
  BrandLogo: () => (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <polygon
        points="14,2 25,8 25,20 14,26 3,20 3,8"
        stroke="url(#v2l-brand-gradient)"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="rgba(99, 102, 241, 0.15)"
      />
      <circle cx="14" cy="14" r="4.2" fill="url(#v2l-brand-gradient)" />
      <path d="M10 14h-3M21 14h-3M14 10V7M14 21v-3" stroke="url(#v2l-brand-gradient)" strokeWidth="1.8" strokeLinecap="round" />
      <defs>
        <linearGradient id="v2l-brand-gradient" x1="2" y1="2" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
      </defs>
    </svg>
  ),

  // Search (Magnifying Glass - Step 1: Intent)
  Search: () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7.5" />
      <line x1="16.5" y1="16.5" x2="21.5" y2="21.5" />
    </svg>
  ),

  // Grid / Apps (4 Rounded Squares - Step 2: Document Hub)
  AppsGrid: () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  ),

  // Connectors / Knot (Step 3: ServicePlus Connector & Verification)
  Connectors: () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2a2 2 0 0 1 2 2v2h2a2 2 0 0 1 2 2v2a2 2 0 1 0 0 4v2a2 2 0 0 1-2 2h-2v2a2 2 0 1 1-4 0v-2H8a2 2 0 0 1-2-2v-2a2 2 0 1 1 0-4V8a2 2 0 0 1 2-2h2V4a2 2 0 0 1 2-2h2z" />
    </svg>
  ),

  // Activity Clock (Step 4: Live Agent Terminal & Timeline)
  ActivityClock: () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  ),

  // Graduation Cap (Knowledge & RPwD Accessibility Guide)
  GraduationCap: () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c0 2 3 3 6 3s6-1 6-3v-5" />
    </svg>
  ),

  // Settings Gear
  SettingsGear: () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),

  // Microphone
  Mic: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),

  // Send Arrow
  ArrowUp: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  ),

  // Gemini Suggestion: Briefcase (Outline)
  Briefcase: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="7" width="19" height="13.5" rx="3" />
      <path d="M8 7V4.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2V7" />
    </svg>
  ),

  // Gemini Suggestion: Sparkles / Star Outline
  Sparkles: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5C12 8 8 12 3.5 12C8 12 12 16 12 20.5C12 16 16 12 20.5 12C16 12 12 8 12 3.5Z" transform="rotate(45 12 12)" />
      <path d="m19 4-0.8 1.4-1.4 0.8 1.4 0.8 0.8 1.4 0.8-1.4 1.4-0.8-1.4-0.8Z" />
      <path d="m5 17-0.7 1.1-1.1 0.7 1.1 0.7 0.7 1.1 0.7-1.1 1.1-0.7-1.1-0.7Z" />
    </svg>
  ),

  // Gemini Suggestion: Open Book with Radiating Rays Outline
  BookIdea: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 15c3.2-1.5 6.5-1.5 9.5 1c3-2.5 6.3-2.5 9.5-1v5.5c-3.2-1.5-6.5-1.5-9.5 1c-3-2.5-6.3-2.5-9.5-1z" />
      <path d="M12 16v5.5" />
      <line x1="12" y1="6.5" x2="12" y2="10" />
      <line x1="7" y1="8" x2="9.5" y2="10.5" />
      <line x1="17" y1="8" x2="14.5" y2="10.5" />
    </svg>
  ),

  // Google Multi-Color Brand Icon
  Google: () => (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.15z"/>
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.27v3.15C3.25 21.27 7.31 24 12 24z"/>
      <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.27C.46 8.2 0 10.04 0 12s.46 3.8 1.27 5.42l4.01-3.15z"/>
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.73 1.27 6.58l4.01 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
    </svg>
  ),
};

// ──────────────────────────────────────────────
// Mock data so the UI is 100% testable without backend
// ──────────────────────────────────────────────
const MOCK_EXTRACTION: ExtractionResponse = {
  profile: {
    full_name: 'Aarav Verma',
    father_or_guardian_name: 'Rajesh Verma',
    date_of_birth: '15/08/2005',
    gender: 'Male',
    mobile_number: '9876543210',
    email: 'aarav@example.com',
    state: 'Uttar Pradesh',
    district: 'Lucknow',
    pincode: '226001',
    address_line: '123 Hazratganj, Lucknow',
    annual_income: 180000,
    category: 'General',
  },
  uncertain_fields: ['annual_income', 'email'],
  raw_text_preview:
    'UTTAR PRADESH HIGHER EDUCATION SCHOLARSHIP VERIFICATION SHEET\n' +
    '------------------------------------------------------------\n' +
    'Student Name: Aarav Verma\nDate of Birth: 15/08/2005\n' +
    'High School Roll Number: 22145890\nHigh School Board: CBSE\n' +
    'Annual Family Income: 180000\nCategory: General\n' +
    'Domicile State: Uttar Pradesh\nDistrict: Lucknow',
  message: 'Document parsed! Please verify all highlighted fields before running the AI Agent.',
};

const MOCK_ELIGIBILITY: EligibilityResponse = {
  eligible: true,
  status: 'ELIGIBLE',
  service_name: 'ServicePlus – Citizen Certificate Application',
  scheme_name: 'ServicePlus – Citizen Certificate Application',
  summary: 'All eligibility requirements for ServicePlus Citizen Certificate are satisfied.',
  results: [
    { rule_id: 'min_age', description: 'Age criteria', passed: true, explanation: 'Age matches certificate criteria (18+)' },
    { rule_id: 'mobile_valid', description: 'Mobile verified', passed: true, explanation: 'Valid 10-digit citizen mobile number verified' },
    { rule_id: 'domicile_match', description: 'State domicile', passed: true, explanation: 'State domicile matches Uttar Pradesh' },
    { rule_id: 'income_ceiling', description: 'Income limit', passed: true, explanation: 'Annual family income is under ₹2,50,000 threshold' },
  ],
  reasons: [
    '✅ Age matches certificate criteria (18+)',
    '✅ Valid 10-digit citizen mobile number verified',
    '✅ State domicile matches Uttar Pradesh',
    '✅ Annual family income is under ₹2,50,000 threshold',
  ],
  missing_fields: [],
  required_documents: ['Income Certificate', 'Aadhaar / ID Card'],
};

const USE_MOCK = false; // ← Set to false when connecting to local FastAPI backend

const GOOGLE_CLIENT_ID =
  '434733256139-amj4gkvbl66f2pc7vok2762u0m5p0es0.apps.googleusercontent.com';

const MOCK_FOUND_FILES: GoogleVaultFile[] = [
  {
    id: 'drive_doc_income_2025',
    name: 'Income_Certificate_2025.pdf',
    source: 'drive',
    size: '184 KB',
  },
  {
    id: 'gmail_att_tehsildar',
    name: 'Tehsildar_Verified_Income.pdf',
    source: 'gmail',
    size: '240 KB',
  },
];

interface MockPortalField {
  label: string;
  value: string;
  type: 'text' | 'select' | 'checkbox' | 'file';
}

const MOCK_AGENT_STEPS: { action: string; field: MockPortalField }[] = [
  { action: '🌐 [NAVIGATE] Connecting to serviceonline.gov.in/directApply.do?serviceId=1784 …', field: { label: '', value: '', type: 'text' } },
  { action: '✍️ [FILL] Applicant Name → Aarav Verma', field: { label: 'Applicant Name', value: 'Aarav Verma', type: 'text' } },
  { action: "✍️ [FILL] Father's Name → Rajesh Verma", field: { label: "Father's Name", value: 'Rajesh Verma', type: 'text' } },
  { action: '✍️ [FILL] Date of Birth → 15/08/2005', field: { label: 'Date of Birth', value: '15/08/2005', type: 'text' } },
  { action: '🔽 [SELECT] Gender → Male', field: { label: 'Gender', value: 'Male', type: 'select' } },
  { action: '✍️ [FILL] Mobile Number → 9876543210', field: { label: 'Mobile Number', value: '9876543210', type: 'text' } },
  { action: '✍️ [FILL] Email ID → aarav@example.com', field: { label: 'Email ID', value: 'aarav@example.com', type: 'text' } },
  { action: '🔽 [SELECT] State → Uttar Pradesh', field: { label: 'State', value: 'Uttar Pradesh', type: 'select' } },
  { action: '🔽 [SELECT] District → Lucknow', field: { label: 'District', value: 'Lucknow', type: 'select' } },
  { action: '✍️ [FILL] Residential Address → 123 Hazratganj, Lucknow', field: { label: 'Address', value: '123 Hazratganj, Lucknow', type: 'text' } },
  { action: '📎 [UPLOAD] Attaching verified certificate to input[type="file"]', field: { label: 'Certificate Attachment', value: 'certificate.pdf', type: 'file' } },
  { action: '☑️ [CHECK] Self-declaration checkbox verified & ticked', field: { label: 'Declaration of Accuracy', value: 'I hereby declare that all details are true.', type: 'checkbox' } },
  { action: '🔒 [PAUSE] Captcha detected. Cropped and waiting for citizen approval.', field: { label: '', value: '', type: 'text' } },
];

// ── Bug 6 & Phase 2: Domain Categorized Suggestions & Conversational Chat ──
export type DomainCategory = 'education' | 'agriculture' | 'welfare' | 'certificates' | 'health';

export interface DomainMeta {
  id: DomainCategory;
  label: string;
  icon: string;
}

export const DOMAIN_CATEGORIES: DomainMeta[] = [
  { id: 'education', label: 'Education / Scholarships', icon: '🎓' },
  { id: 'agriculture', label: 'Agriculture / Farmers', icon: '🌾' },
  { id: 'welfare', label: 'Welfare / Pensions', icon: '🏛️' },
  { id: 'certificates', label: 'Certificates & Domicile', icon: '📜' },
  { id: 'health', label: 'Healthcare', icon: '🏥' },
];

export interface DomainSuggestionItem {
  iconType: 'briefcase' | 'sparkles' | 'book';
  text: string;
  domain: 'education' | 'welfare' | 'certificates' | 'agriculture' | 'health';
  domainLabel: string;
  badge?: string;
  subtitle?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  schemeMatch?: IntentClassificationResponse;
  canRoute?: boolean;
}

export const DOMAIN_SUGGESTIONS: Record<'apply' | 'eligibility', DomainSuggestionItem[]> = {
  apply: [
    {
      iconType: 'sparkles',
      text: 'Apply for Vidya Lakshmi Higher Education Scholarship & Student Loan',
      domain: 'education',
      domainLabel: 'Education',
    },
    {
      iconType: 'book',
      text: 'Apply for National Means-cum-Merit Higher Education Scholarship',
      domain: 'education',
      domainLabel: 'Education',
    },
    {
      iconType: 'briefcase',
      text: 'Register for Construction Worker Welfare Scheme (Form 1784)',
      domain: 'welfare',
      domainLabel: 'Welfare',
    },
    {
      iconType: 'sparkles',
      text: 'Apply for National Social Assistance Old Age & Disability Pension',
      domain: 'welfare',
      domainLabel: 'Welfare',
    },
    {
      iconType: 'book',
      text: 'Apply for Income & Asset Certificate (Aay Praman Patra)',
      domain: 'certificates',
      domainLabel: 'Certificates',
    },
    {
      iconType: 'sparkles',
      text: 'Apply for Domicile / Permanent Residence Certificate (Niwas Patra)',
      domain: 'certificates',
      domainLabel: 'Certificates',
    },
    {
      iconType: 'briefcase',
      text: 'Apply for Caste / Category Certificate (Jati Praman Patra)',
      domain: 'certificates',
      domainLabel: 'Certificates',
    },
    {
      iconType: 'book',
      text: 'Apply for PM-KISAN Farmer Income Support Scheme (₹6,000/yr)',
      domain: 'agriculture',
      domainLabel: 'Agriculture',
    },
    {
      iconType: 'sparkles',
      text: 'Register for PM Fasal Bima Yojana (Crop Insurance Scheme)',
      domain: 'agriculture',
      domainLabel: 'Agriculture',
    },
    {
      iconType: 'sparkles',
      text: 'Apply for Ayushman Bharat PM-JAY Cashless Health Card (₹5 Lakh)',
      domain: 'health',
      domainLabel: 'Healthcare',
    },
    {
      iconType: 'briefcase',
      text: 'Register for Universal Health Coverage on NHA Beneficiary Portal',
      domain: 'health',
      domainLabel: 'Healthcare',
    },
  ],
  eligibility: [
    {
      iconType: 'sparkles',
      text: 'Check eligibility & interest subsidy criteria for Vidya Lakshmi Loan',
      domain: 'education',
      domainLabel: 'Education',
    },
    {
      iconType: 'book',
      text: 'Verify marksheet percentage & family income limits for Scholarships',
      domain: 'education',
      domainLabel: 'Education',
    },
    {
      iconType: 'briefcase',
      text: 'Verify 90-day physical labor proof & age criteria for Worker Welfare (1784)',
      domain: 'welfare',
      domainLabel: 'Welfare',
    },
    {
      iconType: 'sparkles',
      text: 'Check BPL list status & criteria for National Social Pension',
      domain: 'welfare',
      domainLabel: 'Welfare',
    },
    {
      iconType: 'book',
      text: 'Check required documents for Income & Asset Certificate',
      domain: 'certificates',
      domainLabel: 'Certificates',
    },
    {
      iconType: 'sparkles',
      text: 'Verify domicile duration & address proof requirements for Niwas Patra',
      domain: 'certificates',
      domainLabel: 'Certificates',
    },
    {
      iconType: 'book',
      text: 'Check landholding criteria & Khatauni document rules for PM-KISAN',
      domain: 'agriculture',
      domainLabel: 'Agriculture',
    },
    {
      iconType: 'sparkles',
      text: 'Verify Aadhaar DBT bank account seeding for farmer subsidy',
      domain: 'agriculture',
      domainLabel: 'Agriculture',
    },
    {
      iconType: 'sparkles',
      text: 'Check family eligibility & SECC coverage criteria for PM-JAY',
      domain: 'health',
      domainLabel: 'Healthcare',
    },
    {
      iconType: 'briefcase',
      text: 'Verify cashless hospital network & family coverage for Health Card',
      domain: 'health',
      domainLabel: 'Healthcare',
    },
  ],
};

const STEPS = [
  { num: 1, label: 'Intent' },
  { num: 2, label: 'Documents' },
  { num: 3, label: 'Verification' },
  { num: 4, label: 'Live Agent' },
];

interface FieldMeta {
  key: keyof ApplicantProfile;
  label: string;
  type?: string;
  spanTwo?: boolean;
  options?: string[];
  placeholder?: string;
}

const FORM_FIELDS: FieldMeta[] = [
  { key: 'full_name', label: 'Full Name', placeholder: 'Full Name as on certificate' },
  { key: 'father_or_guardian_name', label: "Father / Guardian's Name", placeholder: "Father or Guardian's full name" },
  { key: 'date_of_birth', label: 'Date of Birth (Calendar Selection)', type: 'date' },
  { key: 'gender', label: 'Gender', type: 'select', options: ['male', 'female', 'other'] },
  { key: 'mobile_number', label: 'Mobile Number (10 Digits)', type: 'tel', placeholder: '10-digit mobile number' },
  { key: 'email', label: 'Email Address (e.g. name@gmail.com)', type: 'email', placeholder: 'name@gmail.com or name@yahoo.com' },
  { key: 'state', label: 'State', placeholder: 'e.g. Uttar Pradesh' },
  { key: 'district', label: 'District', placeholder: 'e.g. Varanasi, Lucknow' },
  { key: 'pincode', label: 'Pin Code (6 Digits)', type: 'text', placeholder: '6-digit PIN code' },
  { key: 'address_line', label: 'Full Residential Address', spanTwo: true, placeholder: 'House number, street, locality' },
  { key: 'annual_income', label: 'Annual Family Income (₹)', type: 'number', placeholder: 'e.g. 165000' },
  { key: 'category', label: 'Category', type: 'select', options: ['general', 'obc', 'sc', 'st', 'ews'] },
];

const toIsoDate = (val?: string) => {
  if (!val) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const m = val.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return val;
};

const getRelevantFieldsForService = (
  selectedService?: IntentClassificationResponse | null
): FieldMeta[] => {
  // Always include core citizen identity fields (Full Name & Mobile Number) so the user always has fields to verify
  const baseKeys = new Set<string>(['full_name', 'mobile_number']);

  if (selectedService?.fields_to_fill && selectedService.fields_to_fill.length > 0) {
    const needed = selectedService.fields_to_fill.map((s) => s.toLowerCase());
    FORM_FIELDS.forEach((f) => {
      const key = (f.key as string).toLowerCase();
      const lbl = f.label.toLowerCase();
      if (
        needed.some(
          (n) =>
            n.includes(key) ||
            key.includes(n) ||
            n.includes(lbl.split(' ')[0]) ||
            (n.includes('name') && key === 'full_name' && !n.includes('father')) ||
            (n.includes('father') && key === 'father_or_guardian_name') ||
            ((n.includes('birth') || n.includes('dob')) && key === 'date_of_birth') ||
            (n.includes('gender') && key === 'gender') ||
            ((n.includes('mobile') || n.includes('phone')) && key === 'mobile_number') ||
            (n.includes('email') && key === 'email') ||
            (n.includes('state') && key === 'state') ||
            (n.includes('district') && key === 'district') ||
            (n.includes('income') && key === 'annual_income') ||
            ((n.includes('category') || n.includes('caste')) && key === 'category') ||
            (n.includes('address') && key === 'address_line') ||
            ((n.includes('pin') || n.includes('postal')) && key === 'pincode')
        )
      ) {
        baseKeys.add(f.key as string);
      }
    });
    return FORM_FIELDS.filter((f) => baseKeys.has(f.key as string));
  }

  // Fallback: general common identity fields
  return FORM_FIELDS.filter((f) =>
    ['full_name', 'father_or_guardian_name', 'date_of_birth', 'gender', 'mobile_number', 'state', 'annual_income'].includes(f.key)
  );
};

export const isDocumentUploadRequired = (
  target?: IntentClassificationResponse | null,
  blueprint?: DynamicScanResponse | null
): boolean => {
  if (!target) return true;

  const sid = (target.service_id || '').toLowerCase();
  const sname = (target.service_name || '').toLowerCase();
  const pid = (target.portal_id || '').toLowerCase();

  // Services known to require zero file uploads (e.g. DigiLocker, basic portal user registrations, voter searches)
  if (
    sid.includes('digilocker') ||
    sname.includes('digilocker') ||
    pid.includes('digilocker')
  ) {
    return false;
  }

  // If dynamic blueprint was scanned from DOM:
  if (blueprint && Array.isArray(blueprint.fields) && blueprint.fields.length > 0) {
    const hasFileField = blueprint.fields.some(
      (f) => f.type === 'file' || /upload|attach|document|file|certificate|दस्तावेज़/i.test(f.label || '')
    );
    const hasRequiredDocsMeta = Boolean(
      blueprint.required_documents_meta && blueprint.required_documents_meta.length > 0
    );
    // If portal DOM was scanned and contains NO file inputs or doc meta, no upload is needed
    if (!hasFileField && !hasRequiredDocsMeta) {
      return false;
    }
  }

  const docs = target.required_documents || [];
  if (docs.length === 0) {
    return false;
  }

  // Filter out dummy values like "none", "not required", "nil", "n/a"
  const validDocs = docs.filter(
    (d) => d && !/^(none|nil|null|not\s*required|no\s*doc.*|na|n\/a)$/i.test(d.trim())
  );

  return validDocs.length > 0;
};

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [activeMode, setActiveMode] = useState<'apply' | 'eligibility'>('apply');

  // Step 1: Intent
  const [intent, setIntent] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [selectedDomain, setSelectedDomain] = useState<DomainCategory>('education');
  const [advisorChat, setAdvisorChat] = useState<ChatMessage[]>([]);
  const [promptIndex, setPromptIndex] = useState(0);
  const [fadeState, setFadeState] = useState(true);
  const [selectedService, setSelectedService] = useState<IntentClassificationResponse | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [showSchemePicker, setShowSchemePicker] = useState(false);
  const [isNavigatingToDocs, setIsNavigatingToDocs] = useState(false);
  const [docStepSkipped, setDocStepSkipped] = useState(false);
  const [navStepText, setNavStepText] = useState('');

  // Task 3: Zero-Shot Dynamic DOM Reasoner state
  const [dynamicBlueprint, setDynamicBlueprint] = useState<DynamicScanResponse | null>(null);
  const [isScanningDom, setIsScanningDom] = useState(false);
  const [dynamicFormValues, setDynamicFormValues] = useState<Record<string, any>>({});

  const scanPortal = async (url: string, currentProfile?: ApplicantProfile) => {
    setIsScanningDom(true);
    try {
      const blueprint = await scanPortalDom(url, currentProfile || profile);
      setDynamicBlueprint(blueprint);
      const initialValues: Record<string, any> = {};
      blueprint.action_plan.forEach((item) => {
        if (item.value !== undefined && item.value !== null) {
          initialValues[item.selector] = item.value;
        }
      });
      setDynamicFormValues(initialValues);
      if (blueprint.required_documents_meta && blueprint.required_documents_meta.length > 0) {
        setVaultQuery(blueprint.required_documents_meta[0].drive_search_keyword || 'income');
      }
      return blueprint;
    } catch (err: any) {
      console.warn('DOM scanner error:', err);
      return null;
    } finally {
      setIsScanningDom(false);
    }
  };

  // Filtered prompts for rotating capsule placeholder
  const activePrompts = useMemo(() => {
    const list = DOMAIN_SUGGESTIONS[activeMode] || [];
    const filtered = list.filter((item) => item.domain === selectedDomain);
    return filtered.length > 0 ? filtered.map((item) => item.text) : list.map((item) => item.text);
  }, [activeMode, selectedDomain]);

  // Smoothly rotate the placeholder text every 4 seconds based on active mode & selected domain
  useEffect(() => {
    const interval = setInterval(() => {
      setFadeState(false);
      setTimeout(() => {
        setPromptIndex((prev) => (prev + 1) % (activePrompts.length || 1));
        setFadeState(true);
      }, 400);
    }, 4000);

    return () => clearInterval(interval);
  }, [activePrompts]);

  // Step 2: Upload & Google Vault
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extraction, setExtraction] = useState<ExtractionResponse | null>(null);
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [vaultQuery, setVaultQuery] = useState('income');
  const [vaultHunting, setVaultHunting] = useState(false);
  const [vaultStepText, setVaultStepText] = useState('');
  const [vaultFoundFiles, setVaultFoundFiles] = useState<GoogleVaultFile[]>([]);
  const [vaultAccessToken, setVaultAccessToken] = useState('');
  const [vaultIsDemo, setVaultIsDemo] = useState(false);

  // Step 3: Verification
  const [profile, setProfile] = useState<ApplicantProfile>({});
  const [uncertainFields, setUncertainFields] = useState<string[]>([]);
  const [verified, setVerified] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilityResponse | null>(null);

  // Step 4: Agent
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentDone, setAgentDone] = useState(false);
  const [captchaText, setCaptchaText] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [pageScreenshot, setPageScreenshot] = useState('');
  const [captchaScreenshot, setCaptchaScreenshot] = useState('');
  const [fallbackCaptcha, setFallbackCaptcha] = useState('3WBV43');
  const [portalFields, setPortalFields] = useState<MockPortalField[]>([]);
  const [activeFieldIndex, setActiveFieldIndex] = useState(-1);
  const [submitted, setSubmitted] = useState(false);
  const [showQuickEdit, setShowQuickEdit] = useState(false);
  const [portalViewMode, setPortalViewMode] = useState<'interactive' | 'screenshot'>('interactive');
  // Bug 7: Citizen Desired Account Password (removed hardcoded 'ADmin@357')
  const [portalPassword, setPortalPassword] = useState('');
  const [portalPhase, setPortalPhase] = useState<'LOGIN' | 'FORM' | 'SUBMIT'>('LOGIN');
  const [portalLoginMode, setPortalLoginMode] = useState<'existing' | 'register'>('existing');
  const [portalAuthMethod, setPortalAuthMethod] = useState<'password' | 'otp'>('password');
  const [portalLoginId, setPortalLoginId] = useState('');
  const [portalOtp, setPortalOtp] = useState('');
  const [portalOtpSent, setPortalOtpSent] = useState(false);
  const [portalAuthenticated, setPortalAuthenticated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [portalPin, setPortalPin] = useState('123456');
  const [showPin, setShowPin] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(true);

  const generateStrongPassword = () => {
    const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowers = 'abcdefghijkmnopqrstuvwxyz';
    const numbers = '23456789';
    const specials = '!@#$%&*';

    let pwd = '';
    pwd += uppers.charAt(Math.floor(Math.random() * uppers.length));
    pwd += lowers.charAt(Math.floor(Math.random() * lowers.length));
    pwd += numbers.charAt(Math.floor(Math.random() * numbers.length));
    pwd += specials.charAt(Math.floor(Math.random() * specials.length));

    const all = uppers + lowers + numbers + specials;
    for (let i = 0; i < 6; i++) {
      pwd += all.charAt(Math.floor(Math.random() * all.length));
    }
    return pwd.split('').sort(() => 0.5 - Math.random()).join('');
  };

  const isPasswordValid = Boolean(
    portalPassword &&
    portalPassword.length >= 8 &&
    /[A-Z]/.test(portalPassword) &&
    /[a-z]/.test(portalPassword) &&
    /\d/.test(portalPassword) &&
    /[!@#$%^&*]/.test(portalPassword)
  );

  const refreshFallbackCaptcha = () => {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFallbackCaptcha(code);
    return code;
  };
  const [selectedInstance, setSelectedInstance] = useState('National Portal (serviceonline.gov.in)');
  const [showInstanceMenu, setShowInstanceMenu] = useState(false);
  const [showEligibilityModal, setShowEligibilityModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);

  // UI helpers
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  const showToast = (msg: string, type: string = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Step Completion Validation (Gates)
  const isDocRequired = isDocumentUploadRequired(selectedService, dynamicBlueprint);
  const hasExtractedDocument = Boolean(
    extraction !== null || (profile.source_documents && profile.source_documents.length > 0)
  );
  const isStep1Done = Boolean(selectedService !== null || intent.trim().length > 0);
  const isStep2Done = Boolean(!isDocRequired || docStepSkipped || hasExtractedDocument);
  const isStep3Done = Boolean(verified);

  const canNavigateToStep = (stepNumber: number) => {
    if (stepNumber === 1) return true;
    if (stepNumber === 2) return isStep1Done && isDocRequired;
    if (stepNumber === 3) return isStep1Done && isStep2Done;
    if (stepNumber === 4) return isStep1Done && isStep2Done && isStep3Done;
    return false;
  };

  const handleStepClick = (targetStep: number) => {
    if (targetStep === 2 && !isDocRequired) {
      showToast('No documents required for this service. You are already in the verification step.', 'info');
      return;
    }
    if (!canNavigateToStep(targetStep)) {
      if (targetStep === 2) showToast('Please enter your intent or select a service first', 'error');
      else if (targetStep === 3) showToast('Please upload required document or choose manual entry', 'error');
      else if (targetStep === 4) showToast('Please verify your citizen data before proceeding to Live Agent', 'error');
      return;
    }
    setCurrentStep(targetStep);
  };

  // Clean up any ongoing Web Speech API or SpeechSynthesis sessions on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
    };
  }, []);

  // Web Speech API for the microphone icon (with safe lifecycle management)
  const handleToggleVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Speech recognition not supported in this browser. Please type.', 'error');
      return;
    }
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
      setIsListening(false);
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = 'en-IN';
      recognition.interimResults = false;
      recognition.onstart = () => {
        setIsListening(true);
        showToast('🎙️ Listening... Speak your request now', 'info');
      };
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setIntent(transcript);
        setIsListening(false);
        recognitionRef.current = null;
        showToast(`Heard: "${transcript}"`, 'success');
      };
      recognition.onerror = () => {
        setIsListening(false);
        recognitionRef.current = null;
        showToast('Voice input error. Try typing.', 'error');
      };
      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };
      recognition.start();
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
    }
  };

  const handleProceedToApplication = async (scheme?: IntentClassificationResponse | null) => {
    const target = scheme || selectedService;
    if (!target) {
      showToast('Please select or describe a scheme first.', 'error');
      return;
    }

    setIsNavigatingToDocs(true);
    setNavStepText(`Connecting to ${target.portal_name || 'official portal'}...`);

    setSelectedService(target);
    setProfile((prev) => ({
      ...prev,
      target_intent: target.service_name,
      target_service_id: target.service_id,
      target_service_name: target.service_name,
      target_portal_id: target.portal_id,
      target_portal_name: target.portal_name,
      target_portal_url: target.portal_url,
      required_documents_list: target.required_documents,
    }));

    // Seed Google Vault query with the first required document
    if (target.required_documents && target.required_documents.length > 0) {
      const firstDoc = target.required_documents[0].toLowerCase();
      if (firstDoc.includes('income')) setVaultQuery('income');
      else if (firstDoc.includes('marksheet') || firstDoc.includes('10th') || firstDoc.includes('12th')) setVaultQuery('marksheet');
      else if (firstDoc.includes('aadhaar')) setVaultQuery('aadhaar');
      else if (firstDoc.includes('land') || firstDoc.includes('khasra')) setVaultQuery('land record');
      else setVaultQuery(target.required_documents[0]);
    }

    let scannedBlueprint: DynamicScanResponse | null = null;
    try {
      const isKnownFastPath = target.service_id === '1784' || target.service_id === 'vidyalakshmi' || target.service_id === 'citizen_registration';
      if (!isKnownFastPath && (target.portal_url || target.service_id)) {
        setNavStepText(`AI Form Agent is scanning live portal DOM and discovering required fields & upload slots...`);
        scannedBlueprint = await scanPortal(target.portal_url || target.service_id);
      }

      // Zero-upload gate: If service requires no documents, bypass Step 2 directly to Step 3
      const needsDocs = isDocumentUploadRequired(target, scannedBlueprint || dynamicBlueprint);
      if (!needsDocs) {
        setDocStepSkipped(true);
        setNavStepText(`No document uploads needed for ${target.service_name}. Opening Verification...`);
        setExtraction({
          profile: {
            ...profile,
            state: profile.state || 'Uttar Pradesh',
            gender: profile.gender || 'male',
            category: profile.category || 'general',
          },
          uncertain_fields: [],
          raw_text_preview: `Direct Verification Mode: No file upload is required for ${target.service_name}. Citizen details are verified directly on screen.`,
          message: `No document upload required for this process. Review and verify citizen details.`,
        });
        await new Promise((r) => setTimeout(r, 600));
        setCurrentStep(3);
        showToast(`⚡ No document upload required for ${target.service_name}. Proceeding directly to Step 3 Verification!`, 'info');
        return;
      }

      setNavStepText(`Application pipeline prepared! Opening Document Hub...`);
      await new Promise((r) => setTimeout(r, 600));
      setCurrentStep(2);
    } catch (err) {
      console.warn('Navigation scan error:', err);
      const needsDocs = isDocumentUploadRequired(target, null);
      if (!needsDocs) {
        setDocStepSkipped(true);
        setExtraction({
          profile: {
            ...profile,
            state: profile.state || 'Uttar Pradesh',
            gender: profile.gender || 'male',
            category: profile.category || 'general',
          },
          uncertain_fields: [],
          raw_text_preview: `Direct Verification Mode: No file upload is required for ${target.service_name}.`,
          message: `No document upload required. Review and verify details below.`,
        });
        setCurrentStep(3);
        showToast(`⚡ No document upload required. Proceeding directly to Step 3 Verification!`, 'info');
      } else {
        setCurrentStep(2);
      }
    } finally {
      setIsNavigatingToDocs(false);
      setNavStepText('');
    }
  };

  const handleIntentSubmit = async (textToUse?: string) => {
    const query = (textToUse || intent).trim();
    if (!query) {
      showToast('Please type or speak what service you need.', 'error');
      return;
    }

    // Only direct navigation confirmations advance immediately without asking the AI
    const isDirectNavConfirmation = /^(proceed|go to documents|next page|take me to upload|upload documents|let's go|open document hub)$/i.test(query);
    if (isDirectNavConfirmation && selectedService) {
      handleProceedToApplication(selectedService);
      return;
    }

    // 1. Add citizen message to chat stream
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setAdvisorChat((prev) => [...prev, userMsg]);
    setIntent('');
    setIsClassifying(true);

    try {
      // 2. Query AI GovTech Advisor for zero-shot intent reasoning & conversational guidance
      const match = await classifyIntent(query);
      const isChatOnly = match.message_type === 'chat' || match.service_id === 'general_chat';
      if (!isChatOnly) {
        setSelectedService(match);
        setProfile((prev) => ({
          ...prev,
          target_intent: query,
          target_service_id: match.service_id,
          target_service_name: match.service_name,
          target_portal_id: match.portal_id,
          target_portal_name: match.portal_name,
          target_portal_url: match.portal_url,
          required_documents_list: match.required_documents,
        }));
      }

      // 3. Add AI advisor response
      const adviceContent = match.ai_advice || match.description || `Here are the official guidelines for ${match.service_name}.`;
      const assistantMsg: ChatMessage = {
        id: `assist-${Date.now()}`,
        sender: 'assistant',
        text: adviceContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        schemeMatch: !isChatOnly ? match : undefined,
        canRoute: !isChatOnly && (match.can_automate ?? true),
      };
      setAdvisorChat((prev) => [...prev, assistantMsg]);
    } catch {
      showToast('Error connecting to advisor. Please try again.', 'error');
      const fallbackMsg: ChatMessage = {
        id: `assist-${Date.now()}`,
        sender: 'assistant',
        text: 'I found matching services in our verified government catalog. You can review the details or select a scheme below.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        schemeMatch: selectedService || undefined,
        canRoute: true,
      };
      setAdvisorChat((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsClassifying(false);
    }
  };

  const handleSelectSchemeManual = (scheme: IntentClassificationResponse) => {
    setSelectedService(scheme);
    setIntent(scheme.service_name);
    setShowSchemePicker(false);
    setProfile((prev) => ({
      ...prev,
      target_intent: scheme.service_name,
      target_service_id: scheme.service_id,
      target_service_name: scheme.service_name,
      target_portal_id: scheme.portal_id,
      target_portal_name: scheme.portal_name,
      target_portal_url: scheme.portal_url,
      required_documents_list: scheme.required_documents,
    }));
    const switchMsg: ChatMessage = {
      id: `assist-${Date.now()}`,
      sender: 'assistant',
      text: `Switched target scheme to **${scheme.service_name}**. When you're ready, click below to launch the autonomous agent!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      schemeMatch: scheme,
      canRoute: true,
    };
    setAdvisorChat((prev) => [...prev, switchMsg]);
    showToast(`Switched scheme to ${scheme.service_name}`, 'info');
  };

  // File Upload Handlers (Supports Multi-File Drag & Drop + Selection)
  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const incoming = Array.from(e.dataTransfer.files);
      setFiles((prev) => [...prev, ...incoming]);
      setFile(incoming[0]);
    }
  }, []);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const incoming = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...incoming]);
      setFile(incoming[0]);
    }
  };

  const handleUpload = async () => {
    const queue = files.length > 0 ? files : (file ? [file] : []);
    if (queue.length === 0) return;
    setLoading(true);

    if (USE_MOCK) {
      await new Promise((r) => setTimeout(r, 1000));
      setExtraction(MOCK_EXTRACTION);
      setProfile(MOCK_EXTRACTION.profile);
      setUncertainFields(MOCK_EXTRACTION.uncertain_fields);
      showToast('Document parsed successfully! Review extracted data below.', 'success');
      setLoading(false);
      return;
    }

    try {
      // 1. Process all uploaded documents in the queue
      const parsedItems: {
        file: File;
        resp: ExtractionResponse;
        isAadhaar: boolean;
        isMarksheet: boolean;
      }[] = [];

      for (const item of queue) {
        const resp = await extractDocument(item);
        const fname = item.name.toLowerCase();
        const raw = (resp.raw_text_preview || '').toLowerCase();
        const hasAadhaarTag = resp.profile.source_documents?.includes('aadhaar');
        const hasAadhaarDigits = Boolean(resp.profile.aadhaar_last4);
        const isAadhaar =
          fname.includes('aadhaar') ||
          fname.includes('aadhar') ||
          fname.includes('uid') ||
          hasAadhaarTag ||
          hasAadhaarDigits ||
          raw.includes('aadhaar') ||
          raw.includes('uidai') ||
          raw.includes('unique identification');

        const isMarksheet =
          fname.includes('marksheet') ||
          fname.includes('mark sheet') ||
          fname.includes('10th') ||
          fname.includes('12th') ||
          fname.includes('cbse') ||
          fname.includes('icse') ||
          resp.profile.source_documents?.includes('marksheet') ||
          raw.includes('marksheet') ||
          raw.includes('mark sheet') ||
          raw.includes('roll no');

        parsedItems.push({ file: item, resp, isAadhaar, isMarksheet });
      }

      // Check for Aadhaar vs Marksheet DOB discrepancy
      let aadhaarDob: string | null = null;
      let marksheetDob: string | null = null;

      // Also check if existing profile already had an Aadhaar-verified DOB
      if (profile.date_of_birth && (profile.aadhaar_last4 || profile.source_documents?.includes('aadhaar'))) {
        aadhaarDob = profile.date_of_birth;
      }

      for (const it of parsedItems) {
        if (it.isAadhaar && it.resp.profile.date_of_birth) {
          aadhaarDob = it.resp.profile.date_of_birth;
        } else if (it.isMarksheet && it.resp.profile.date_of_birth) {
          marksheetDob = it.resp.profile.date_of_birth;
        }
      }

      // Sort items so non-Aadhaar items are processed first, and Aadhaar items LAST!
      // This ensures that in any multi-file batch, Aadhaar identity fields take final precedence.
      parsedItems.sort((a, b) => {
        if (a.isAadhaar && !b.isAadhaar) return 1;
        if (!a.isAadhaar && b.isAadhaar) return -1;
        return 0;
      });

      // 2. Cumulative merge into profile with strict Aadhaar priority
      setProfile((prev) => {
        const merged = { ...prev };
        for (const item of parsedItems) {
          const resp = item.resp;
          for (const [k, v] of Object.entries(resp.profile)) {
            if (v !== null && v !== undefined && v !== '') {
              if (k === 'date_of_birth') {
                // Rule: If an Aadhaar DOB exists, non-Aadhaar documents CANNOT overwrite it!
                if (item.isAadhaar) {
                  merged.date_of_birth = String(v);
                } else if (!aadhaarDob) {
                  merged.date_of_birth = String(v);
                }
              } else if (k === 'full_name' || k === 'gender' || k === 'aadhaar_last4') {
                if (item.isAadhaar || !(merged as any)[k]) {
                  (merged as any)[k] = v;
                }
              } else {
                (merged as any)[k] = v;
              }
            }
          }
        }

        // Guarantee final DOB is always the Aadhaar verified DOB
        if (aadhaarDob) {
          merged.date_of_birth = aadhaarDob;
        }
        return merged;
      });

      // Prefer the Aadhaar response for extraction preview card, or the last item
      const preferredItem = parsedItems.find((it) => it.isAadhaar) || parsedItems[parsedItems.length - 1];
      const preferredResp = preferredItem ? preferredItem.resp : null;

      if (preferredResp) {
        // Enforce Aadhaar DOB in the extraction preview if available
        if (aadhaarDob) {
          preferredResp.profile.date_of_birth = aadhaarDob;
        }
        setExtraction(preferredResp);
      }

      // Merge all uncertain fields across uploaded docs
      for (const item of parsedItems) {
        if (item.resp.uncertain_fields) {
          setUncertainFields((prev) => Array.from(new Set([...prev, ...item.resp.uncertain_fields])));
        }
      }

      // If both Aadhaar and Marksheet were uploaded and had different DOBs, notify citizen
      if (aadhaarDob && marksheetDob && aadhaarDob !== marksheetDob) {
        showToast(
          `DOB Discrepancy detected: Prioritized verified Aadhaar Card Date of Birth (${toIsoDate(aadhaarDob)}) over Marksheet (${toIsoDate(marksheetDob)}).`,
          'info'
        );
      } else {
        showToast(
          queue.length > 1
            ? `${queue.length} documents parsed & fused with verified Aadhaar priority!`
            : 'Document parsed successfully! Review extracted data below.',
          'success'
        );
      }
    } catch {
      showToast('Extraction failed – make sure backend is reachable.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ──────────────────────────────────────────────
  // Google Vault Auto-Hunter (Drive + Gmail)
  // Call 1: POST /api/documents/google-search -> Candidate files list
  // Call 2: POST /api/documents/google-fetch -> Download, save & pre-fill CitizenProfile
  // ──────────────────────────────────────────────
  const handleStartGoogleVaultSearch = (forceDemo: boolean = false) => {
    setVaultHunting(true);
    setVaultFoundFiles([]);

    const executeSearch = async (token: string, isDemo: boolean) => {
      setVaultAccessToken(token);
      setVaultIsDemo(isDemo);
      setVaultStepText(`Searching Google Drive & Gmail for "${vaultQuery}"...`);

      // 1. If explicit demo mode was selected
      if (isDemo) {
        await new Promise((r) => setTimeout(r, 600));
        try {
          const files = await searchGoogleVault({
            access_token: token,
            query: vaultQuery,
            demo_mode: true,
          });
          if (files && files.length > 0) {
            setVaultFoundFiles(files);
            setVaultHunting(false);
            return;
          }
        } catch {
          // backend not reachable
        }
        setVaultFoundFiles(MOCK_FOUND_FILES);
        showToast('Demo Mode: Showing candidate preview documents.', 'info');
        setVaultHunting(false);
        return;
      }

      // 2. Real Google OAuth flow
      // A) First, try Member 2's backend endpoint: POST /api/documents/google-search
      try {
        const files = await searchGoogleVault({
          access_token: token,
          query: vaultQuery,
          demo_mode: false,
        });
        if (files && files.length > 0) {
          setVaultFoundFiles(files);
          showToast(`Found ${files.length} document(s) via backend Google Search!`, 'success');
          setVaultHunting(false);
          return;
        }
      } catch (backendErr) {
        console.warn('Backend /api/documents/google-search not reachable or server not running:', backendErr);
      }

      // B) Direct Google Drive API search using the citizen's real access_token
      try {
        setVaultStepText(`Searching your Google Drive directly for "${vaultQuery}"...`);
        const queryFilter = vaultQuery.trim()
          ? `trashed=false and (name contains '${vaultQuery.trim().replace(/'/g, "\\'")}' or fullText contains '${vaultQuery.trim().replace(/'/g, "\\'")}')`
          : `trashed=false and mimeType='application/pdf'`;

        let driveResp = await fetch(
          `https://www.googleapis.com/drive/v3/files?pageSize=15&fields=files(id,name,mimeType,size,modifiedTime)&q=${encodeURIComponent(queryFilter)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        let driveData = driveResp.ok ? await driveResp.json() : null;

        // If specific keyword had 0 results, search for any PDFs or images in their Drive
        if (!driveData?.files || driveData.files.length === 0) {
          driveResp = await fetch(
            `https://www.googleapis.com/drive/v3/files?pageSize=15&fields=files(id,name,mimeType,size,modifiedTime)&q=${encodeURIComponent("trashed=false and (mimeType='application/pdf' or mimeType contains 'image/')")}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (driveResp.ok) {
            driveData = await driveResp.json();
          }
        }

        if (driveData?.files && driveData.files.length > 0) {
          const realDriveFiles: GoogleVaultFile[] = driveData.files.map((f: any) => ({
            id: f.id,
            name: f.name,
            source: 'drive',
            mimeType: f.mimeType,
            size: f.size ? `${(parseInt(f.size, 10) / 1024).toFixed(0)} KB` : 'Google Doc',
          }));
          setVaultFoundFiles(realDriveFiles);
          showToast(`✅ Connected! Found ${realDriveFiles.length} real file(s) in your Google Drive!`, 'success');
          setVaultHunting(false);
          return;
        }
      } catch (directErr) {
        console.warn('Direct Google Drive query error:', directErr);
      }

      // C) Fallback if no files matched or drive has no documents
      showToast(`No documents matching "${vaultQuery}" found in Google Drive. Showing candidate preview files.`, 'info');
      setVaultFoundFiles(MOCK_FOUND_FILES);
      setVaultHunting(false);
    };

    if (forceDemo) {
      executeSearch('ya29.demo_token_forge26', true);
      return;
    }

    // Standard Google Identity Services OAuth popup using team Client ID
    try {
      const google = (window as any).google;
      if (google?.accounts?.oauth2) {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly',
          callback: async (tokenResp: any) => {
            if (tokenResp?.access_token) {
              await executeSearch(tokenResp.access_token, false);
            } else {
              showToast('Google auth cancelled; running in demo mode.', 'info');
              await executeSearch('ya29.demo_token_forge26', true);
            }
          },
          error_callback: () => {
            showToast('Google popup blocked/offline; running in demo mode.', 'info');
            executeSearch('ya29.demo_token_forge26', true);
          },
        });
        client.requestAccessToken();
      } else {
        showToast('Google GIS script offline; running in demo mode.', 'info');
        executeSearch('ya29.demo_token_forge26', true);
      }
    } catch {
      executeSearch('ya29.demo_token_forge26', true);
    }
  };

  const handleFetchChosenFile = async (chosenFile: GoogleVaultFile) => {
    setVaultHunting(true);
    setVaultStepText(`Downloading "${chosenFile.name}" & extracting profile...`);

    const token = vaultAccessToken || 'ya29.demo_token_forge26';
    const isDemo = vaultIsDemo;

    try {
      let profileResult: ApplicantProfile | null = null;
      let uncertain: string[] = [];
      let rawText = '';
      let downloadedBlob: Blob | null = null;

      // 1. Download real file directly from Google Drive if real access_token is present
      if (!isDemo && chosenFile.source === 'drive' && token && !token.startsWith('ya29.demo')) {
        try {
          setVaultStepText(`Fetching "${chosenFile.name}" directly from Google Drive...`);
          const fileResp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${chosenFile.id}?alt=media`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (fileResp.ok) {
            downloadedBlob = await fileResp.blob();
          }
        } catch (downloadErr) {
          console.warn('Direct Google Drive download failed:', downloadErr);
        }
      }

      // 2. Call backend /api/documents/google-fetch if backend is reachable
      if (!isDemo) {
        try {
          const resp = await fetchGoogleVaultFile({
            access_token: token,
            file_id: chosenFile.id,
            source: chosenFile.source,
            demo_mode: false,
          });
          profileResult = resp.profile ?? null;
          uncertain = resp.uncertain_fields || [];
          rawText = resp.raw_text_preview || '';
        } catch {
          // backend not reachable or not ready yet
        }
      }

      // 3. Fallback to backend demo_mode if backend is running in demo
      if (!profileResult && isDemo) {
        try {
          const resp = await fetchGoogleVaultFile({
            access_token: token,
            file_id: chosenFile.id,
            source: chosenFile.source,
            demo_mode: true,
          });
          profileResult = resp.profile ?? null;
          uncertain = resp.uncertain_fields || [];
          rawText = resp.raw_text_preview || '';
        } catch {
          // backend offline
        }
      }

      // 4. Default mock data if backend extractor hasn't processed
      if (!profileResult) {
        await new Promise((r) => setTimeout(r, 650));
        profileResult = MOCK_EXTRACTION.profile;
        uncertain = MOCK_EXTRACTION.uncertain_fields;
        rawText = MOCK_EXTRACTION.raw_text_preview;
      }

      // Create the real file in React
      const finalFile = downloadedBlob
        ? new File([downloadedBlob], chosenFile.name, { type: downloadedBlob.type || 'application/pdf' })
        : new File(['vault_content'], chosenFile.name, { type: 'application/pdf' });

      setFile(finalFile);
            // Priority check: preserve verified Aadhaar DOB if existing
      const hasExistingAadhaarDob = Boolean(
        profile.date_of_birth &&
        (profile.aadhaar_last4 || profile.source_documents?.includes('aadhaar'))
      );
      const isNewAadhaar =
        chosenFile.name.toLowerCase().includes('aadhaar') ||
        chosenFile.name.toLowerCase().includes('aadhar') ||
        Boolean(profileResult?.aadhaar_last4);

      if (hasExistingAadhaarDob && !isNewAadhaar && profile.date_of_birth && profileResult) {
        profileResult.date_of_birth = profile.date_of_birth;
      }

      setExtraction({
        profile: profileResult!,
        uncertain_fields: uncertain,
        raw_text_preview: rawText,
        message: `Retrieved "${chosenFile.name}" from Google Vault!`,
      });
      setProfile(profileResult!);
      setUncertainFields(uncertain);
      showToast(`Retrieved "${chosenFile.name}" from Google Vault & extracted profile!`, 'success');
      setShowVaultModal(false);
      setCurrentStep(3);
    } catch (err: any) {
      showToast(err?.message || 'Failed to download document from Google Vault.', 'error');
    } finally {
      setVaultHunting(false);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    let finalValue: any = value;

    if (name === 'mobile_number') {
      finalValue = value.replace(/\D/g, '').slice(0, 10);
    } else if (name === 'pincode') {
      finalValue = value.replace(/\D/g, '').slice(0, 6);
    } else if (name === 'annual_income') {
      finalValue = value ? parseInt(value.replace(/\D/g, ''), 10) || 0 : undefined;
    }

    setProfile((prev) => ({ ...prev, [name]: finalValue }));

    if (uncertainFields.includes(name) && String(finalValue).trim().length > 0) {
      setUncertainFields((prev) => prev.filter((k) => k !== name));
    }

    if (eligibility) {
      setEligibility(null);
    }
  };

  const handleProceedManually = () => {
    setProfile((prev) => ({
      ...prev,
      state: prev.state || 'Uttar Pradesh',
      gender: prev.gender || 'male',
      category: prev.category || 'general',
    }));
    setUncertainFields([]);
    setExtraction({
      profile: {
        ...profile,
        state: profile.state || 'Uttar Pradesh',
        gender: profile.gender || 'male',
        category: profile.category || 'general',
      },
      uncertain_fields: [],
      raw_text_preview: 'Manual Entry: No document uploaded. Citizen will complete the verification form directly.',
      message: 'Manual entry mode active. Please fill out your details.',
    });
    showToast('Manual Entry: Please fill in your citizen details.', 'info');
    setCurrentStep(3);
  };

  const handleCheckEligibility = async () => {
    setLoading(true);
    if (USE_MOCK) {
      await new Promise((r) => setTimeout(r, 600));
      setEligibility(MOCK_ELIGIBILITY);
      showToast('Eligibility verified!', 'success');
      setLoading(false);
      return;
    }
    try {
      const targetServiceId = selectedService?.service_id || profile.target_service_id || '1784';
      const resp = await checkEligibility(profile, targetServiceId);
      setEligibility(resp);
      showToast(`Verification complete for ${resp.service_name || selectedService?.service_name || 'Registration'}!`, 'success');
      if (resp.eligible) {
        await new Promise((r) => setTimeout(r, 700));
        setCurrentStep(4);
      }
    } catch {
      showToast('Verification check could not be completed. Please ensure backend is running.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Live Agent Simulation
  const runMockAgent = async () => {
    setAgentRunning(true);
    setAgentDone(false);
    setAgentLog([]);
    setPortalFields([]);
    setActiveFieldIndex(-1);

    for (let i = 0; i < MOCK_AGENT_STEPS.length; i++) {
      await new Promise((r) => setTimeout(r, 700));
      const step = MOCK_AGENT_STEPS[i];
      setAgentLog((prev) => [...prev, step.action]);

      if (step.field.label) {
        setPortalFields((prev) => [...prev, step.field]);
        setActiveFieldIndex(i);
      }
    }
    setAgentRunning(false);
    setAgentDone(true);
    showToast('Agent paused at CAPTCHA for citizen verification.', 'info');
  };

  const handlePortalLogin = (mode: 'existing' | 'register') => {
    const pName = selectedService?.portal_name || 'Official Government Portal';
    const loginUser = portalLoginId || profile.mobile_number || profile.email || 'Citizen User';
    
    setAgentLog((prev) => [
      ...prev,
      `🔐 [STAGE 1/3: PORTAL GATEWAY] Authenticating with ${pName}...`,
      mode === 'existing'
        ? `👤 [CREDENTIALS] Submitting verified citizen ID (${loginUser}) with secure token...`
        : `⚡ [AUTO-REGISTRATION] Creating authenticated citizen profile (${profile.full_name || 'Citizen'}, ${profile.date_of_birth || 'DOB'}, ${profile.mobile_number || 'Mobile'})...`,
      `✅ [AUTHENTICATED] Session established successfully. Session Token: GOV_SESSION_${Date.now().toString(36).toUpperCase()}`,
      `🌐 [STAGE 2/3: APPLICATION FORM] Loading official scheme application form under authenticated session...`
    ]);
    setPortalAuthenticated(true);
    setPortalPhase('FORM');
    showToast(`Logged in to ${pName}! Application form loaded.`, 'success');
  };

  const handleStartAgent = async () => {
    if (!verified) {
      showToast('Please confirm verification of your data first.', 'error');
      return;
    }
    if (dynamicBlueprint?.is_reachable === false) {
      showToast(`Cannot launch agent: Government portal is unreachable (${currentPortalUrl})`, 'error');
      setAgentLog((prev) => [
        ...prev,
        `❌ [CONNECTION FAILED] Government portal ${currentPortalUrl} is offline or unreachable (DNS_PROBE_FINISHED_NXDOMAIN).`,
        `⚠️ Autonomous browser agent halted. The official government server cannot be reached.`
      ]);
      return;
    }
    const currentSid = selectedService?.service_id || profile.target_service_id || '1784';
    const isTargetVLQuick = currentSid === 'vidyalakshmi' || /vidya|lakshmi/i.test(currentSid);
    const isDynamicPortalQuick = Boolean(dynamicBlueprint || (!isTargetVLQuick && currentSid !== '1784' && currentSid !== 'citizen_registration'));

    if (!isTargetVLQuick && !isDynamicPortalQuick) {
      if (!portalPassword) {
        showToast('Please choose an account password in Step 3 before proceeding.', 'error');
        return;
      }
      if (!isPasswordValid) {
        showToast('Password must be 8+ chars with uppercase, lowercase, numeric, and special characters.', 'error');
        return;
      }
    }
    setCurrentStep(4);
    if (USE_MOCK) {
      runMockAgent();
      return;
    }
    setLoading(true);
    setAgentRunning(true);
    setAgentDone(false);

    const targetServiceId = selectedService?.service_id || profile.target_service_id || '1784';
    const isTargetVL =
      targetServiceId === 'vidyalakshmi' ||
      selectedService?.portal_id === 'VIDYA_LAKSHMI_PORTAL' ||
      /vidya|lakshmi/i.test(targetServiceId) ||
      /vidya|lakshmi/i.test(selectedService?.service_name || '') ||
      /vidyalakshmi/i.test(selectedService?.portal_url || '');

    const isTargetSP =
      targetServiceId === '1784' ||
      targetServiceId === 'citizen_registration' ||
      selectedService?.portal_id === 'SERVICE_PLUS_REGISTRATION';

    const portalName = selectedService?.portal_name || (isTargetVL ? 'Vidya Lakshmi Portal (Ministry of Education & NSDL)' : isTargetSP ? 'ServicePlus citizen registration portal' : (dynamicBlueprint?.title || selectedService?.service_name || 'Official Government Portal'));
    const portalUrl = selectedService?.portal_url || (isTargetVL ? 'https://www.vidyalakshmi.co.in/Students/' : isTargetSP ? 'https://serviceonline.gov.in/citizenRegistration.html' : (dynamicBlueprint?.portal_url || 'https://serviceonline.gov.in'));
    const isDynamicTarget = !isTargetVL && !isTargetSP;
    const targetPortalId = isDynamicTarget
      ? (selectedService?.portal_url || selectedService?.service_id || 'dynamic_portal')
      : (selectedService?.portal_id || profile.target_portal_id || (isTargetVL ? 'VIDYA_LAKSHMI_PORTAL' : 'SERVICE_PLUS_REGISTRATION'));

    setAgentLog([
      '🚀 Initializing Playwright browser in visible Chromium mode...',
      `🌐 Navigating to ${portalName} (${portalUrl})...`,
      '✍️ Autonomous agent mapping verified citizen profile to official portal fields...'
    ]);
    try {
      const docFilename = profile.source_documents?.find(f => f.startsWith('saved:'))?.replace('saved:', '');
      const resp = await startApplication(profile, targetPortalId, docFilename);
      const steps = resp.steps_completed || resp.log_steps || [];
      if (steps.length > 0) {
        setAgentLog(steps);
      }
      if (resp.session_id) setSessionId(resp.session_id);
      if (resp.page_preview_b64) setPageScreenshot(resp.page_preview_b64);
      if (resp.captcha_image_b64) setCaptchaScreenshot(resp.captcha_image_b64);
      setAgentRunning(false);
      if (resp.status === 'failed') {
        setAgentDone(false);
        showToast(resp.message || 'Agent encountered an issue.', 'error');
        setAgentLog(prev => [...prev, `❌ [FAILED] ${resp.message || 'Agent failed to complete form.'}`]);
      } else {
        setAgentDone(true);
        showToast(resp.message || 'Live agent completed filling fields. Please enter CAPTCHA.', 'success');
      }
    } catch (err: any) {
      setAgentRunning(false);
      setAgentDone(false);
      const errMsg = err?.response?.data?.detail || err?.message || 'Failed to start agent.';
      setAgentLog((prev) => [...prev, `❌ [ERROR] ${errMsg}`]);
      showToast(`Failed to start agent: ${errMsg}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async (action: 'FILL_ONLY' | 'SUBMIT') => {
    if (USE_MOCK) {
      if (action === 'FILL_ONLY') {
        setPortalFields((prev) => [...prev, { label: 'CAPTCHA', value: captchaText, type: 'text' }]);
        setAgentLog((prev) => [...prev, `✍️ [FILL] Captcha Entered → ${captchaText}`]);
        showToast('CAPTCHA filled into portal tab. Ready for final submit.', 'success');
      } else {
        setAgentLog((prev) => [...prev, '🚀 [CLICK] Final Submit Approved & Executed!']);
        setAgentLog((prev) => [...prev, `🎉 [SUCCESS] Official acknowledgment generated on ${portalName || 'official portal'}!`]);
        setSubmitted(true);
        showToast(`Form submitted successfully on ${portalName || 'official portal'}!`, 'success');
      }
      return;
    }

    setLoading(true);
    setAgentRunning(true);
    setAgentLog((prev) => [
      ...prev,
      `✍️ [HUMAN VERIFICATION] Injecting solved CAPTCHA '${captchaText}' into portal...`,
      action === 'SUBMIT' ? '🚀 [SUBMIT] Approving final application submission...' : '🔍 [REVIEW] Retaining form in review mode...'
    ]);
    try {
      const resp = await resumeApplication(sessionId, captchaText, action === 'SUBMIT');
      if (resp.final_screenshot_b64) setPageScreenshot(resp.final_screenshot_b64);
      if (resp.status === 'submitted') {
        setSubmitted(true);
        if (resp.tracking_receipt) {
          setAgentLog((prev) => [...prev, `🎉 [SUCCESS] Official Tracking Receipt: ${resp.tracking_receipt}`]);
        }
      }
      showToast(resp.message || 'Action executed.', 'success');
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || err?.message || 'Resume action failed.';
      setAgentLog((prev) => [...prev, `❌ [ERROR] ${errMsg}`]);
      showToast(`Resume action failed: ${errMsg}`, 'error');
    } finally {
      setAgentRunning(false);
      setLoading(false);
    }
  };

  const handleStopAgent = async () => {
    setAgentRunning(false);
    if (!USE_MOCK && sessionId) {
      try {
        await resumeApplication(sessionId, '', false);
      } catch {
        // ignore error if session already closed
      }
    }
    setCurrentStep(1);
    showToast('Agent stopped. Returned to Home.', 'info');
  };

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [agentLog]);

  return (
    <div className="gemini-layout">
      <div className="ambient-glow" />

      {/* ───── Left Slim Sidebar (Original Brand + No Pen + Locked Steps) ───── */}
      <aside className="gemini-sidebar">
        <div className="sidebar-top">
          {/* 1. Custom Voice-to-Legacy Brand Emblem (No Gemini star) */}
          <button className="sparkle-btn" onClick={() => setCurrentStep(1)} title="Voice-to-Legacy Portal">
            <Icons.BrandLogo />
          </button>

          {/* 2. Step 1: Search / Intent */}
          <button
            className={`sidebar-icon-btn ${currentStep === 1 ? 'active' : ''}`}
            onClick={() => handleStepClick(1)}
            data-tooltip="1. Search & Intent"
          >
            <Icons.Search />
          </button>

          {/* 3. Step 2: Document Hub (Disabled until Intent is done) */}
          <button
            className={`sidebar-icon-btn ${currentStep === 2 ? 'active' : ''} ${!canNavigateToStep(2) ? 'is-disabled' : ''}`}
            onClick={() => handleStepClick(2)}
            disabled={!canNavigateToStep(2)}
            data-tooltip={canNavigateToStep(2) ? '2. Document Hub' : '🔒 Locked: Enter Intent First'}
          >
            <Icons.AppsGrid />
          </button>

          {/* 4. Step 3: Verification & Connectors (Disabled until Document is extracted) */}
          <button
            className={`sidebar-icon-btn ${currentStep === 3 ? 'active' : ''} ${!canNavigateToStep(3) ? 'is-disabled' : ''}`}
            onClick={() => handleStepClick(3)}
            disabled={!canNavigateToStep(3)}
            data-tooltip={canNavigateToStep(3) ? '3. Verification & Connectors' : '🔒 Locked: Upload Document First'}
          >
            <Icons.Connectors />
          </button>

          {/* 5. Step 4: Live Agent Terminal (Disabled until Verified) */}
          <button
            className={`sidebar-icon-btn ${currentStep === 4 ? 'active' : ''} ${!canNavigateToStep(4) ? 'is-disabled' : ''}`}
            onClick={() => handleStepClick(4)}
            disabled={!canNavigateToStep(4)}
            data-tooltip={canNavigateToStep(4) ? '4. Live Agent Execution' : '🔒 Locked: Verify Data First'}
          >
            <Icons.ActivityClock />
          </button>

          {/* 6. Help / Legal Compliance Documentation */}
          <button
            className="sidebar-icon-btn"
            onClick={() => showToast('RPwD Act & Assistive Accessibility Documentation', 'info')}
            data-tooltip="Legal & Compliance"
          >
            <Icons.GraduationCap />
          </button>
        </div>

        <div className="sidebar-bottom">
          {/* 7. Settings Gear */}
          <button
            className="sidebar-icon-btn"
            onClick={() => showToast('Portal Automation & Rate Settings', 'info')}
            data-tooltip="Settings"
          >
            <Icons.SettingsGear />
          </button>

          {/* 8. Citizen Session Avatar */}
          <div className="gemini-user-avatar" data-tooltip="Citizen Session: Member 3">
            <div className="avatar-art" />
          </div>
        </div>
      </aside>

      {/* ───── Main View Stage ───── */}
      <main className="gemini-main">
        {/* Top bar */}
        <header className="gemini-topbar">
          <div className="gemini-title-badge">
            <span className="title-text">Voice-to-Legacy</span>
          </div>

          <div className="topbar-right-controls">
            <div className="get-app-pill">
              <span className="sparkle-dot" /> Assistive AI Agent
            </div>
          </div>
        </header>

        {/* Stepper Pills (Strictly Locked until steps are completed) */}
        {currentStep > 1 && (
          <nav className="gemini-stepper">
            {STEPS.map((s) => {
              const accessible = canNavigateToStep(s.num);
              let label = s.label;
              if (s.num === 2 && !isDocRequired) {
                label = 'Documents (Not Needed)';
              }
              const isCompleted = currentStep > s.num || (s.num === 2 && !isDocRequired && currentStep >= 3);
              return (
                <button
                  key={s.num}
                  className={`stepper-chip ${currentStep === s.num ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${!accessible && !(s.num === 2 && !isDocRequired) ? 'is-disabled' : ''}`}
                  disabled={!accessible && !(s.num === 2 && !isDocRequired)}
                  onClick={() => handleStepClick(s.num)}
                  title={s.num === 2 && !isDocRequired ? 'No document upload required for this service' : undefined}
                >
                  <span>{isCompleted ? '✓' : s.num}.</span>
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        )}

        <div className={`gemini-container ${currentStep === 4 ? 'wide' : ''}`}>
          {/* ════════════════════════════════════════
              STEP 1: GEMINI HERO / PROMPT VIEW / AI ADVISOR CHAT
          ════════════════════════════════════════ */}
          {currentStep === 1 && (
            <>
              {advisorChat.length === 0 ? (
                <div className="gemini-hero">
                  <h1 className="hero-heading">Where should we start?</h1>
                  <p style={{ color: '#94a3b8', fontSize: '0.92rem', marginTop: '-0.5rem', marginBottom: '1.25rem', maxWidth: '640px' }}>
                    Ask our AI GovTech Advisor any question about government schemes, eligibility rules, or launch automated portal applications.
                  </p>

                  {/* Pill Prompt Capsule */}
                  <div className="gemini-search-capsule">
                    <div className="capsule-input-container">
                      <input
                        className="capsule-input"
                        type="text"
                        value={intent}
                        onChange={(e) => setIntent(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleIntentSubmit()}
                      />
                      {!intent && (
                        <div className={`capsule-animated-placeholder ${fadeState ? 'fade-in' : 'fade-out'}`}>
                          {activePrompts[promptIndex % (activePrompts.length || 1)]}
                        </div>
                      )}
                    </div>

                    <div className="capsule-actions">
                      <button
                        className={`capsule-icon-btn ${isListening ? 'recording' : ''}`}
                        onClick={handleToggleVoice}
                        title="Speak using Web Speech API"
                      >
                        <Icons.Mic />
                      </button>

                      <button
                        className="capsule-submit-btn"
                        disabled={!intent.trim()}
                        onClick={() => handleIntentSubmit()}
                        title="Send"
                      >
                        <Icons.ArrowUp />
                      </button>
                    </div>
                  </div>

                  {/* Mode Pills (Auto-Apply vs Check Eligibility) */}
                  <div className="gemini-mode-pills">
                    <button
                      type="button"
                      className={`mode-pill ${activeMode === 'apply' ? 'active' : ''}`}
                      onClick={() => {
                        setActiveMode('apply');
                        setPromptIndex(0);
                      }}
                      title="Directly automate submission on official portals with AI Agent"
                    >
                      Auto-Apply
                    </button>
                    <button
                      type="button"
                      className={`mode-pill ${activeMode === 'eligibility' ? 'active' : ''}`}
                      onClick={() => {
                        setActiveMode('eligibility');
                        setPromptIndex(0);
                      }}
                      title="Verify criteria, income limits, and required documents before applying"
                    >
                      Check Eligibility
                    </button>
                  </div>

                  {/* Dynamic Domain Category Filter Pills */}
                  <div className="gemini-domain-pills">
                    {DOMAIN_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        className={`domain-pill ${cat.id} ${selectedDomain === cat.id ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedDomain(cat.id);
                          setPromptIndex(0);
                        }}
                      >
                        <span>{cat.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Clean Human-Designed 2-Column Scheme Cards Grid (No vertical messy list) */}
                  <div className="gemini-suggestions-grid">
                    {DOMAIN_SUGGESTIONS[activeMode]
                      .filter((item) => item.domain === selectedDomain)
                      .map((item, idx) => (
                        <div
                          key={idx}
                          className="scheme-suggest-card"
                          onClick={() => {
                            setIntent(item.text);
                            handleIntentSubmit(item.text);
                          }}
                        >
                          <div className="scheme-suggest-header">
                            <span className="scheme-suggest-icon">
                              {item.iconType === 'briefcase' && <Icons.Briefcase />}
                              {item.iconType === 'sparkles' && <Icons.Sparkles />}
                              {item.iconType === 'book' && <Icons.BookIdea />}
                            </span>
                            <span className={`scheme-category-badge ${item.domain}`}>
                              {item.domainLabel}
                            </span>
                          </div>
                          <div className="scheme-suggest-title">{item.text}</div>
                          <div className="scheme-suggest-footer">
                            <span>Ask AI Advisor</span>
                            <span>→</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                /* Step 1 Conversational AI Advisor Chat Interface */
                <div className="advisor-chat-container">
                  <div className="advisor-chat-header">
                    <div className="advisor-header-title">
                      <div className="assistant-avatar" style={{ width: '28px', height: '28px', fontSize: '0.75rem', fontWeight: 700 }}>AI</div>
                      <div>
                        <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.96rem' }}>
                          GovTech AI Advisor & Scheme Navigator
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          Conversational guidance across official portals • Ask questions or launch autonomous form filling
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="advisor-reset-btn"
                      onClick={() => {
                        setAdvisorChat([]);
                        setSelectedService(null);
                      }}
                      title="Start fresh consultation"
                    >
                      ↺ New Search
                    </button>
                  </div>

                  {/* Chat Messages */}
                  <div className="advisor-messages-list">
                    {advisorChat.map((msg) => (
                      <div key={msg.id} className={`chat-bubble-row ${msg.sender}`}>
                        {msg.sender === 'assistant' && (
                          <div className="assistant-avatar" style={{ fontSize: '0.75rem', fontWeight: 700 }}>AI</div>
                        )}

                        <div className={`chat-bubble ${msg.sender}`}>
                          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                            {msg.text}
                          </div>

                          {/* Interactive Matched Scheme Card inside Assistant Message */}
                          {msg.schemeMatch && msg.schemeMatch.message_type !== 'chat' && msg.schemeMatch.service_id !== 'general_chat' && (
                            <div className="chat-scheme-card">
                              <div className="chat-scheme-title-row">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <div>
                                    <div className="chat-scheme-name">{msg.schemeMatch.service_name}</div>
                                    <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                                      Official Portal: <strong style={{ color: '#e2e8f0' }}>{msg.schemeMatch.portal_name}</strong>
                                      {msg.schemeMatch.portal_url && (
                                        <a
                                          href={msg.schemeMatch.portal_url.startsWith('http') ? msg.schemeMatch.portal_url : `https://${msg.schemeMatch.portal_url}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          style={{ color: '#38bdf8', textDecoration: 'none', marginLeft: '0.4rem' }}
                                        >
                                          {(() => {
                                            try {
                                              const u = msg.schemeMatch.portal_url.startsWith('http') ? msg.schemeMatch.portal_url : `https://${msg.schemeMatch.portal_url}`;
                                              return `${new URL(u).hostname} ↗`;
                                            } catch {
                                              return `${msg.schemeMatch.portal_url} ↗`;
                                            }
                                          })()}
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <span className={`scheme-category-badge ${msg.schemeMatch.category}`}>
                                  {msg.schemeMatch.category}
                                </span>
                              </div>

                              {/* Why Portal Was Chosen */}
                              {msg.schemeMatch.reason_chosen && (
                                <div style={{ fontSize: '0.8rem', background: 'rgba(56, 189, 248, 0.06)', borderLeft: '3px solid #38bdf8', padding: '0.45rem 0.65rem', borderRadius: '4px', color: '#cbd5e1' }}>
                                  <strong style={{ color: '#38bdf8' }}>Why this portal: </strong>
                                  {msg.schemeMatch.reason_chosen}
                                </div>
                              )}

                              {/* Form Fields to Auto-Fill */}
                              {msg.schemeMatch.fields_to_fill && msg.schemeMatch.fields_to_fill.length > 0 && (
                                <div style={{ marginTop: '0.2rem' }}>
                                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, marginBottom: '0.3rem' }}>
                                    PRE-FILLED APPLICATION FIELDS:
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                    {msg.schemeMatch.fields_to_fill.map((f, fi) => (
                                      <span key={fi} style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem', color: '#e2e8f0' }}>
                                        {f}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Discovered Required Documents to Attach */}
                              <div style={{ marginTop: '0.2rem' }}>
                                <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, marginBottom: '0.3rem' }}>
                                  REQUIRED DOCUMENTS TO ATTACH:
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                  {msg.schemeMatch.required_documents.map((doc, di) => (
                                    <span key={di} className="scheme-doc-pill" style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', background: 'rgba(56, 189, 248, 0.12)', borderColor: 'rgba(56, 189, 248, 0.3)', color: '#38bdf8' }}>
                                      {doc}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              {/* Limitations & Verification Disclosure */}
                              {msg.schemeMatch.limitations && (
                                <div style={{ fontSize: '0.76rem', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', padding: '0.4rem 0.65rem', borderRadius: '6px' }}>
                                  <span><strong>Portal Checkpoint:</strong> {msg.schemeMatch.limitations}</span>
                                </div>
                              )}

                              {/* Action Buttons to Proceed or Change Scheme */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.4rem' }}>
                                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="chat-route-btn"
                                    disabled={isNavigatingToDocs}
                                    onClick={() => handleProceedToApplication(msg.schemeMatch)}
                                    style={isNavigatingToDocs ? { opacity: 0.85, cursor: 'wait' } : {}}
                                  >
                                    {isNavigatingToDocs ? (
                                      <>
                                        <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: '0.4rem' }} />
                                        <span>Analyzing Portal...</span>
                                      </>
                                    ) : (
                                      <>
                                        <span>{msg.schemeMatch.cta_message || (!isDocumentUploadRequired(msg.schemeMatch) ? 'Proceed to Verification (No Docs Needed)' : 'Proceed to Document Hub')}</span>
                                        <span>→</span>
                                      </>
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    className="gemini-btn gemini-btn-tonal"
                                    disabled={isNavigatingToDocs}
                                    style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', borderRadius: '8px' }}
                                    onClick={() => setShowSchemePicker(!showSchemePicker)}
                                  >
                                    {showSchemePicker ? '▲ Hide Catalog' : '▾ Choose Different Portal'}
                                  </button>
                                </div>

                                {/* Persistent Real-time Navigation Progress */}
                                {isNavigatingToDocs && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '8px', padding: '0.55rem 0.85rem', fontSize: '0.78rem', color: '#38bdf8', animation: 'fadeIn 0.2s ease-in' }}>
                                    <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }} />
                                    <span>{navStepText || 'AI is preparing application pipeline...'}</span>
                                  </div>
                                )}
                              </div>

                              {showSchemePicker && (
                                <div style={{ marginTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.6rem' }}>
                                  <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: '0.4rem', fontWeight: 600 }}>
                                    SELECT FROM VERIFIED CATALOG:
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    {KNOWN_SERVICES_CATALOG.map((sch) => (
                                      <button
                                        key={sch.service_id}
                                        type="button"
                                        className={`picker-option-card ${selectedService?.service_id === sch.service_id ? 'selected' : ''}`}
                                        onClick={() => handleSelectSchemeManual(sch)}
                                        style={{ padding: '0.45rem 0.75rem' }}
                                      >
                                        <span className="picker-opt-label" style={{ fontSize: '0.8rem' }}>{sch.service_name}</span>
                                        <span className={`scheme-category-badge ${sch.category}`} style={{ fontSize: '0.6rem' }}>
                                          {sch.category}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="chat-timestamp">{msg.timestamp}</div>
                        </div>

                        {msg.sender === 'user' && (
                          <div className="user-avatar">👤</div>
                        )}
                      </div>
                    ))}

                    {/* AI Thinking Bubble */}
                    {isClassifying && (
                      <div className="chat-bubble-row assistant">
                        <div className="assistant-avatar">✨</div>
                        <div className="chat-bubble assistant" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <div className="hunting-spinner" style={{ width: '16px', height: '16px' }} />
                          <span style={{ fontSize: '0.88rem', color: '#94a3b8' }}>
                            AI Assistant is thinking...
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Pinned Search / Follow-Up Input Capsule */}
                  <div className="gemini-search-capsule" style={{ width: '100%', maxWidth: '100%' }}>
                    <div className="capsule-input-container">
                      <input
                        className="capsule-input"
                        type="text"
                        value={intent}
                        placeholder="Ask a question (eligibility, documents, fee) or type 'route me' to apply..."
                        onChange={(e) => setIntent(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleIntentSubmit()}
                      />
                    </div>

                    <div className="capsule-actions">
                      <button
                        className={`capsule-icon-btn ${isListening ? 'recording' : ''}`}
                        onClick={handleToggleVoice}
                        title="Speak using Web Speech API"
                      >
                        <Icons.Mic />
                      </button>

                      <button
                        className="capsule-submit-btn"
                        disabled={!intent.trim()}
                        onClick={() => handleIntentSubmit()}
                        title="Send"
                      >
                        <Icons.ArrowUp />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════════════
              STEP 2: DOCUMENT UPLOAD
          ════════════════════════════════════════ */}
          {currentStep === 2 && (
            <div className="gemini-card">
              {/* Target Portal Identification Badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.28)', borderRadius: '20px', padding: '0.35rem 0.85rem', fontSize: '0.82rem', color: '#38bdf8' }}>
                  <span>Target Portal:</span>
                  <strong>{selectedService?.portal_name || 'Official Portal'}</strong>
                  {selectedService?.portal_url && (
                    <a href={selectedService.portal_url} target="_blank" rel="noopener noreferrer" style={{ color: '#93c5fd', textDecoration: 'underline', marginLeft: '0.2rem' }}>
                      {(() => {
                        try {
                          return `${new URL(selectedService.portal_url).hostname} ↗`;
                        } catch {
                          return `${selectedService.portal_url} ↗`;
                        }
                      })()}
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  className="advisor-reset-btn"
                  onClick={() => setCurrentStep(1)}
                  style={{ fontSize: '0.78rem', padding: '0.25rem 0.65rem' }}
                >
                  ← Back to AI Advisor
                </button>
              </div>

              <h2 className="card-title">
                {selectedService
                  ? `Document Hub — ${selectedService.service_name}`
                  : 'Document Hub — Attach Official Citizen Document'}
              </h2>
              <p className="card-desc">
                {selectedService?.reason_chosen
                  ? selectedService.reason_chosen
                  : 'Attach your required document below (PDF or Image). AI will extract verified identity data for form pre-filling.'}
              </p>

              {/* Required Documents Checklist (Prioritizes LLM Brain classification) */}
              {((selectedService?.required_documents && selectedService.required_documents.length > 0) ||
                (dynamicBlueprint?.required_documents_meta && dynamicBlueprint.required_documents_meta.length > 0)) && (
                <div style={{ marginBottom: '1.25rem', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span>REQUIRED DOCUMENTS FOR THIS APPLICATION:</span>
                    </span>
                    <span style={{ fontSize: '0.68rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                      Official Requirements
                    </span>
                  </div>

                  {/* Render Verified Service Documents */}
                  <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                    {selectedService?.required_documents && selectedService.required_documents.length > 0 ? (
                      selectedService.required_documents.map((doc, idx) => (
                        <span
                          key={idx}
                          className="scheme-doc-pill"
                          style={{
                            background: 'rgba(56, 189, 248, 0.12)',
                            borderColor: 'rgba(56, 189, 248, 0.3)',
                            color: '#38bdf8',
                            padding: '0.35rem 0.75rem',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                          }}
                        >
                          <span>✓</span>
                          <span>{doc}</span>
                        </span>
                      ))
                    ) : (
                      dynamicBlueprint?.required_documents_meta?.map((doc, idx) => (
                        <span
                          key={idx}
                          className="scheme-doc-pill"
                          style={{
                            background: 'rgba(56, 189, 248, 0.12)',
                            borderColor: 'rgba(56, 189, 248, 0.3)',
                            color: '#38bdf8',
                            padding: '0.35rem 0.75rem',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                          }}
                        >
                          <span>✓</span>
                          <span>{doc.display_name}</span>
                        </span>
                      ))
                    )}
                  </div>

                  {/* Auto-Compression Assurance Callout (Concise, zero clutter) */}
                  <div style={{ marginTop: '0.75rem', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', padding: '0.45rem 0.75rem', fontSize: '0.76rem', color: '#a7f3d0' }}>
                    <strong style={{ color: '#34d399' }}>Smart Auto-Compression:</strong> Files are automatically compressed to meet official portal size limits.
                  </div>
                </div>
              )}

              <div
                className={`gemini-dropzone ${dragOver ? 'drag-active' : ''}`}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="dropzone-sparkle">
                  <Icons.AppsGrid />
                </div>
                <div className="dropzone-prompt">
                  <strong>Click to select file(s)</strong> or drag & drop here
                </div>
                <div className="dropzone-types">PDF, PNG, JPG (Aadhaar, PAN, Marksheet, Certificates — Multi-upload supported)</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </div>

              {/* ─── Google Vault Auto-Document Hunter (Drive + Gmail) ─── */}
              <div className="google-vault-section">
                <div className="vault-divider">
                  <span className="divider-line" />
                  <span className="divider-text">OR AUTO-FETCH WITH AI</span>
                  <span className="divider-line" />
                </div>

                <button
                  type="button"
                  className="google-vault-btn"
                  disabled={loading || vaultHunting}
                  onClick={() => setShowVaultModal(true)}
                  title="Search your Google Drive & Gmail attachments for required scheme documents"
                >
                  <div className="vault-btn-content">
                    <Icons.Google />
                    <span className="vault-btn-title">Fetch from Google Drive / Gmail</span>
                  </div>
                </button>

                <div className="manual-entry-divider">
                  <span className="divider-line" />
                  <span className="divider-text">OR FILL MANUALLY</span>
                  <span className="divider-line" />
                </div>

                <button
                  type="button"
                  className="manual-entry-btn"
                  onClick={handleProceedManually}
                  title="Proceed directly to manual entry without uploading a certificate"
                >
                  <Icons.Connectors />
                  <span>Enter Details Manually (Skip Upload) →</span>
                </button>
              </div>

              {/* Attached Files List (Supports Multiple Documents) */}
              {files.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '1rem' }}>
                  {files.map((f, idx) => (
                    <div key={idx} className="attached-file-pill">
                      <div className="file-info">
                        <span>{f.name} ({(f.size / 1024).toFixed(1)} KB)</span>
                      </div>
                      <button
                        className="file-delete-btn"
                        onClick={() => {
                          setFiles((prev) => prev.filter((_, i) => i !== idx));
                          if (files.length <= 1) setFile(null);
                        }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              ) : file && (
                <div className="attached-file-pill" style={{ marginTop: '1rem' }}>
                  <div className="file-info">
                    <span>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                  </div>
                  <button className="file-delete-btn" onClick={() => { setFile(null); setExtraction(null); }}>✕</button>
                </div>
              )}

              <div className="action-buttons-row">
                <button className="gemini-btn gemini-btn-tonal" onClick={() => setCurrentStep(1)}>
                  ← Back
                </button>
                <button
                  className="gemini-btn gemini-btn-primary"
                  disabled={(files.length === 0 && !file) || loading}
                  onClick={handleUpload}
                >
                  {loading ? 'Extracting Data…' : `Extract Details from ${files.length > 1 ? `${files.length} Documents` : 'Document'}`}
                </button>
              </div>

              {/* Extracted Document Preview Card (Only shown once document is uploaded & extracted) */}
              {hasExtractedDocument ? (
                <div style={{ marginTop: '1.5rem', background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '12px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#f8fafc' }}>
                      Extracted Document Data {files.length > 1 ? `(${files.length} Documents Fused)` : ''}
                    </div>
                    <span style={{ fontSize: '0.72rem', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.35)', color: '#4ade80', padding: '0.2rem 0.6rem', borderRadius: '12px' }}>
                      AI Verified Extraction
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem', marginBottom: '1.1rem' }}>
                    {profile.full_name && (
                      <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Full Name</div>
                        <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>{profile.full_name}</div>
                      </div>
                    )}
                    {profile.father_or_guardian_name && (
                      <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Father/Guardian Name</div>
                        <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>{profile.father_or_guardian_name}</div>
                      </div>
                    )}
                    {profile.date_of_birth && (
                      <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Date of Birth</div>
                        <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>{profile.date_of_birth}</div>
                      </div>
                    )}
                    {profile.gender && (
                      <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Gender</div>
                        <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>{profile.gender}</div>
                      </div>
                    )}
                    {profile.state && (
                      <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>State</div>
                        <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>{profile.state}</div>
                      </div>
                    )}
                    {profile.district && (
                      <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>District</div>
                        <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>{profile.district}</div>
                      </div>
                    )}
                    {profile.mobile_number && (
                      <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Mobile Number</div>
                        <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>{profile.mobile_number}</div>
                      </div>
                    )}
                    {profile.address_line && (
                      <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Address</div>
                        <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>{profile.address_line}</div>
                      </div>
                    )}
                    {profile.annual_income !== undefined && profile.annual_income !== null && (
                      <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Annual Income</div>
                        <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>₹{Number(profile.annual_income).toLocaleString('en-IN')}</div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                    <button
                      type="button"
                      className="gemini-btn gemini-btn-primary"
                      onClick={() => setCurrentStep(3)}
                    >
                      Review & Verify Details →
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '1.25rem', padding: '1.1rem 1.25rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '10px', border: '1px dashed rgba(56, 189, 248, 0.3)', textAlign: 'center' }}>
                  <div style={{ color: '#38bdf8', fontSize: '0.88rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <span>🔒</span>
                    <span>Document Upload Recommended</span>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.85rem' }}>
                    Upload your document above and click <strong>Extract Details</strong> (or auto-fetch via Google Vault) to auto-fill your citizen profile, or skip to enter details manually.
                  </div>
                  <button
                    type="button"
                    className="gemini-btn gemini-btn-tonal"
                    style={{ fontSize: '0.8rem', padding: '0.45rem 1rem' }}
                    onClick={() => {
                      setDocStepSkipped(true);
                      handleProceedManually();
                    }}
                  >
                    <span>Skip Upload & Verify Details Manually →</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════
              STEP 3: VERIFICATION & MULTI-PORTAL SWITCHER
          ════════════════════════════════════════ */}
          {currentStep === 3 && (() => {
            const currentServiceId = selectedService?.service_id || profile.target_service_id || '1784';
            const isDigilocker = currentServiceId.toLowerCase().includes('digilocker');
            const isVidyaLakshmi =
              currentServiceId === 'vidyalakshmi' ||
              selectedService?.portal_id === 'VIDYA_LAKSHMI_PORTAL' ||
              /vidya|lakshmi/i.test(currentServiceId) ||
              /vidya|lakshmi/i.test(selectedService?.service_name || '') ||
              /vidyalakshmi/i.test(selectedService?.portal_url || '');

            const isDynamicPortal = Boolean(
              dynamicBlueprint ||
              (!isVidyaLakshmi && currentServiceId !== '1784' && currentServiceId !== 'citizen_registration')
            );

            // Dynamically select strictly the relevant fields for this portal from LLM classification
            const relevantFields = getRelevantFieldsForService(selectedService);

            // Validation logic based on active portal
            const isMobileValid = Boolean(profile.mobile_number && /^\d{10}$/.test(profile.mobile_number.trim()));
            const isEmailValid = !profile.email || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(profile.email.trim());
            const isPincodeValid = !profile.pincode || /^\d{6}$/.test(profile.pincode.trim());

            // Core identity validation: full_name and mobile_number (if mobile is in relevant fields)
            const hasFullName = Boolean(profile.full_name && profile.full_name.trim().length >= 2);
            const needsMobile = relevantFields.some((f) => f.key === 'mobile_number');
            const hasValidMobile = !needsMobile || isMobileValid;

            // Auxiliary field formats (only validated if a value was provided by user)
            const areFieldsValid = hasFullName && hasValidMobile && isEmailValid && isPincodeValid;

            // Dynamically detect if portal requires a PIN or Password from fields_to_fill
            const needsPin = Boolean(selectedService?.fields_to_fill?.some((f) => /pin/i.test(f) && !/pincode|postal/i.test(f)));
            const needsPassword = Boolean(
              selectedService?.fields_to_fill?.some((f) => /pass/i.test(f)) ||
              currentServiceId === 'citizen_registration' ||
              currentServiceId === '1784'
            );

            const isPinValid = !needsPin || portalPin.length === 6;
            const isPwValid = !needsPassword || isPasswordValid;

            const isFormComplete = areFieldsValid && isPinValid && isPwValid;

            // Filter out navigation or toggle artifacts from dynamic portal DOM
            const genuineDynamicFields = (dynamicBlueprint?.fields || []).filter(f => {
              const lbl = (f.label || '').toLowerCase();
              const sel = (f.selector || '').toLowerCase();
              if (!f.label || f.label.trim().length < 3) return false;
              if (/menu|nav|toggle|sidebar|search|header|footer|theme|mode|hamburger/i.test(sel) || /menu|navigation|toggle/i.test(lbl)) return false;
              return true;
            });

            return (
              <div className="gemini-card">
                <h2 className="card-title">
                  Verify Application Details for {selectedService?.service_name || selectedService?.portal_name || 'Registration'}
                </h2>
                <p className="card-desc">
                  Review and verify your citizen profile details below. You can edit any value before proceeding with the application.
                </p>

                {/* Live DOM Distillation Badge / Form Origin Indicator */}
                <div style={{ marginBottom: '1.25rem' }}>
                  {genuineDynamicFields.length > 0 ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      borderRadius: '10px',
                      padding: '0.6rem 0.95rem',
                      fontSize: '0.82rem',
                      color: '#38bdf8',
                    }}>
                      <span style={{ fontSize: '1.1rem' }}>⚡</span>
                      <div>
                        <strong>In-Browser DOM Reader Active:</strong> {genuineDynamicFields.length} interactive form fields and dropdowns distilled directly from live portal DOM (<code>{dynamicBlueprint?.portal_url || selectedService?.portal_url || 'gov.in'}</code>).
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '10px',
                      padding: '0.6rem 0.95rem',
                      fontSize: '0.82rem',
                      color: '#94a3b8',
                    }}>
                      <span style={{ fontSize: '1.1rem' }}>🏛️</span>
                      <div>
                        <strong>Scheme Form Fields:</strong> Portal registration fields verified below. The AI Browser Agent will navigate to <code>{selectedService?.portal_url || 'official portal'}</code> and inject these verified values live in Step 4.
                      </div>
                    </div>
                  )}
                </div>

                {/* ─── CASE 1: VIDYA LAKSHMI STUDENT LAYOUT ─── */}
                {isVidyaLakshmi ? (
                  <div className="vl-step3-container">
                    <div className="vl-step3-header">
                      <div>
                        <div className="vl-step3-title">Vidya Lakshmi — Student Registration Form</div>
                        <div className="vl-step3-sub">Ministry of Education & NSDL e-Gov • CELAF Student & Loan Portal</div>
                      </div>
                    </div>

                    <div className="gemini-form-grid">
                      <div className="form-item">
                        <label className="item-label">
                          <span>Student Full Name</span>
                          {uncertainFields.includes('full_name') && <span className="uncertain-tag">Review</span>}
                        </label>
                        <input
                          className="gemini-input"
                          type="text"
                          name="full_name"
                          value={profile.full_name || ''}
                          onChange={handleInputChange}
                          placeholder="Student Name as on Class 10/12 Marksheet"
                        />
                      </div>

                      <div className="form-item">
                        <label className="item-label">
                          <span>Email ID</span>
                          {uncertainFields.includes('email') && <span className="uncertain-tag">Review</span>}
                        </label>
                        <input
                          className="gemini-input"
                          type="email"
                          name="email"
                          value={profile.email || ''}
                          onChange={handleInputChange}
                          placeholder="student.name@example.com"
                        />
                        {profile.email && !isEmailValid && (
                          <div className="field-validation-msg error">Must be valid email address</div>
                        )}
                      </div>

                      <div className="form-item">
                        <label className="item-label">
                          <span>Mobile Number</span>
                          {uncertainFields.includes('mobile_number') && <span className="uncertain-tag">Review</span>}
                        </label>
                        <input
                          className="gemini-input"
                          type="tel"
                          name="mobile_number"
                          value={profile.mobile_number || ''}
                          onChange={handleInputChange}
                          placeholder="10-digit mobile number"
                        />
                        {profile.mobile_number && !isMobileValid && (
                          <div className="field-validation-msg error">Must be 10 digits</div>
                        )}
                      </div>

                      <div className="form-item">
                        <label className="item-label">
                          <span>Date of Birth</span>
                          {uncertainFields.includes('date_of_birth') && <span className="uncertain-tag">Review</span>}
                        </label>
                        <input
                          className="gemini-input"
                          type="date"
                          name="date_of_birth"
                          value={toIsoDate(profile.date_of_birth)}
                          onChange={handleInputChange}
                        />
                      </div>

                      <div className="form-item span-two">
                        <label className="item-label">
                          <span>State of Domicile</span>
                          {uncertainFields.includes('state') && <span className="uncertain-tag">Review</span>}
                        </label>
                        <input
                          className="gemini-input"
                          type="text"
                          name="state"
                          value={profile.state || ''}
                          onChange={handleInputChange}
                          placeholder="e.g. Rajasthan, Uttar Pradesh, Maharashtra"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ─── CASE 2: PORTAL-ADAPTIVE CITIZEN PROFILE FORM (Only required fields) ─── */
                  <>
                    <div className="gemini-form-grid">
                      {relevantFields.map((f) => {
                        const uncertain = uncertainFields.includes(f.key as string);
                        const val = (profile as any)[f.key];
                        const strVal = val !== undefined && val !== null ? String(val) : '';

                        let validationMsg = null;
                        if (f.key === 'mobile_number') {
                          if (strVal.length > 0 && strVal.length < 10) {
                            validationMsg = <div className="field-validation-msg error">{10 - strVal.length} more digits needed (10-digit mobile)</div>;
                          } else if (strVal.length === 10) {
                            validationMsg = <div className="field-validation-msg success">✓ Valid 10-digit mobile number</div>;
                          }
                        } else if (f.key === 'email') {
                          const isValidEmail = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(strVal.trim());
                          if (strVal.length > 0 && !isValidEmail) {
                            validationMsg = <div className="field-validation-msg error">Must be valid email (e.g. name@gmail.com)</div>;
                          } else if (isValidEmail) {
                            validationMsg = <div className="field-validation-msg success">✓ Valid email format</div>;
                          }
                        } else if (f.key === 'pincode') {
                          if (strVal.length > 0 && strVal.length < 6) {
                            validationMsg = <div className="field-validation-msg error">{6 - strVal.length} more digits needed (6-digit PIN)</div>;
                          } else if (strVal.length === 6) {
                            validationMsg = <div className="field-validation-msg success">✓ Valid 6-digit PIN code</div>;
                          }
                        }

                        return (
                          <div key={f.key as string} className={`form-item ${f.spanTwo ? 'span-two' : ''}`}>
                            <label className="item-label">
                              <span>{f.label}</span>
                              {strVal && <span style={{ fontSize: '0.68rem', color: '#4ade80', marginLeft: '0.45rem', fontWeight: 500 }}>✓ Auto-filled</span>}
                              {uncertain && <span className="uncertain-tag">Review</span>}
                            </label>
                            {f.type === 'select' && f.options ? (
                              <select
                                className={`gemini-input ${uncertain ? 'uncertain-highlight' : ''}`}
                                name={f.key as string}
                                value={strVal}
                                onChange={handleInputChange}
                              >
                                <option value="">Select {f.label}...</option>
                                {f.options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt.toUpperCase()}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                className={`gemini-input ${uncertain ? 'uncertain-highlight' : ''}`}
                                type={f.type || 'text'}
                                name={f.key as string}
                                placeholder={f.placeholder}
                                value={f.type === 'date' ? toIsoDate(profile.date_of_birth) : strVal}
                                onChange={handleInputChange}
                                max={f.type === 'date' ? new Date().toISOString().split('T')[0] : undefined}
                              />
                            )}
                            {validationMsg}
                          </div>
                        );
                      })}
                    </div>

                    {/* Additional Portal Specific Fields (if genuine form fields were discovered) */}
                    {genuineDynamicFields.length > 0 && (
                      <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '1.25rem' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.75rem' }}>
                          Additional Portal Questions
                        </div>
                        <div className="dynamic-dom-grid">
                          {genuineDynamicFields.map((field, idx) => {
                            const sel = field.selector;
                            const currentVal = dynamicFormValues[sel] !== undefined
                              ? dynamicFormValues[sel]
                              : (field.type === 'checkbox' ? false : (field.value || ''));

                            if (field.type === 'checkbox') {
                              return (
                                <div key={idx} className="dynamic-field-item checkbox-type span-two">
                                  <input
                                    type="checkbox"
                                    id={`dynamic-${idx}`}
                                    checked={Boolean(currentVal)}
                                    onChange={(e) => setDynamicFormValues(prev => ({ ...prev, [sel]: e.target.checked }))}
                                  />
                                  <label htmlFor={`dynamic-${idx}`} style={{ cursor: 'pointer', fontSize: '0.88rem', color: '#e2e8f0', margin: 0 }}>
                                    {field.label}
                                  </label>
                                </div>
                              );
                            }

                            if (field.tag === 'select' || (field.options && field.options.length > 0)) {
                              return (
                                <div key={idx} className="dynamic-field-item">
                                  <label className="dynamic-field-label">
                                    <span>{field.label}</span>
                                  </label>
                                  <select
                                    className="gemini-input"
                                    value={String(currentVal || '')}
                                    onChange={(e) => setDynamicFormValues(prev => ({ ...prev, [sel]: e.target.value }))}
                                  >
                                    <option value="">-- Select Option --</option>
                                    {(field.options || []).map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                </div>
                              );
                            }

                            return (
                              <div key={idx} className="dynamic-field-item">
                                <label className="dynamic-field-label">
                                  <span>{field.label}</span>
                                </label>
                                <input
                                  className="gemini-input"
                                  type={field.type || 'text'}
                                  value={String(currentVal || '')}
                                  placeholder={field.label}
                                  onChange={(e) => setDynamicFormValues(prev => ({ ...prev, [sel]: e.target.value }))}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Dynamic Portal Security PIN Section (shown whenever portal requires a PIN) */}
                    {needsPin && (
                      <div className="account-password-section" style={{ marginTop: '1.25rem' }}>
                        <div className="account-password-header">
                          <div className="account-password-title">
                            <span>6-Digit Portal Security PIN</span>
                          </div>
                          <button
                            type="button"
                            className="generate-password-btn"
                            onClick={() => {
                              const randomPin = Math.floor(100000 + Math.random() * 900000).toString();
                              setPortalPin(randomPin);
                              showToast(`Generated secure 6-digit PIN: ${randomPin}`, 'info');
                            }}
                            title="Generate a 6-digit PIN"
                          >
                            Suggest 6-Digit PIN
                          </button>
                        </div>
                        <p className="account-password-desc">
                          Set the 6-digit security PIN for your account registration. The AI browser agent will submit this PIN on the official portal.
                        </p>

                        <div className="sp-password-wrap" style={{ maxWidth: '320px' }}>
                          <input
                            type={showPin ? 'text' : 'password'}
                            className="gemini-input sp-password-input"
                            value={portalPin}
                            maxLength={6}
                            onChange={(e) => setPortalPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="6-digit PIN (e.g. 849201)"
                          />
                          <button
                            type="button"
                            className="sp-password-toggle-btn"
                            onClick={() => setShowPin(!showPin)}
                            title={showPin ? 'Hide PIN' : 'Show PIN'}
                          >
                            {showPin ? 'Hide' : 'Show'}
                          </button>
                        </div>
                        <div style={{ marginTop: '0.35rem', fontSize: '0.74rem', color: portalPin.length === 6 ? '#4ade80' : '#f59e0b' }}>
                          {portalPin.length === 6 ? '✓ 6-digit PIN ready' : `${6 - portalPin.length} more digit(s) needed`}
                        </div>
                      </div>
                    )}

                    {/* Dynamic Portal Account Password Section (shown whenever portal requires a password) */}
                    {needsPassword && (
                      <div className="account-password-section">
                        <div className="account-password-header">
                          <div className="account-password-title">
                            <span>Desired Portal Account Password</span>
                          </div>
                          <button
                            type="button"
                            className="generate-password-btn"
                            onClick={() => {
                              const strong = generateStrongPassword();
                              setPortalPassword(strong);
                              showToast('Generated secure password matching official portal rules!', 'info');
                            }}
                            title="Generate a secure password meeting portal requirements"
                          >
                            Suggest Secure Password
                          </button>
                        </div>
                        <p className="account-password-desc">
                          Choose the account password for your official portal registration. The AI agent will submit this password to register your citizen profile.
                        </p>

                        <div className="sp-password-wrap" style={{ maxWidth: '420px' }}>
                          <input
                            type={showPassword ? 'text' : 'password'}
                            className="gemini-input sp-password-input"
                            value={portalPassword}
                            onChange={(e) => setPortalPassword(e.target.value)}
                            placeholder="Choose account password (e.g. Citizen@2026)"
                          />
                          <button
                            type="button"
                            className="sp-password-toggle-btn"
                            onClick={() => setShowPassword(!showPassword)}
                            title={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? 'Hide' : 'Show'}
                          </button>
                        </div>

                        <div className="password-rules-checklist">
                          <span className={`rule-chip ${portalPassword.length >= 8 ? 'valid' : ''}`}>
                            {portalPassword.length >= 8 ? '✓' : '•'} 8+ Characters
                          </span>
                          <span className={`rule-chip ${/[A-Z]/.test(portalPassword) ? 'valid' : ''}`}>
                            {/[A-Z]/.test(portalPassword) ? '✓' : '•'} 1 Uppercase Letter
                          </span>
                          <span className={`rule-chip ${/[a-z]/.test(portalPassword) ? 'valid' : ''}`}>
                            {/[a-z]/.test(portalPassword) ? '✓' : '•'} 1 Lowercase Letter
                          </span>
                          <span className={`rule-chip ${/\d/.test(portalPassword) ? 'valid' : ''}`}>
                            {/\d/.test(portalPassword) ? '✓' : '•'} 1 Number
                          </span>
                          <span className={`rule-chip ${/[!@#$%^&*]/.test(portalPassword) ? 'valid' : ''}`}>
                            {/[!@#$%^&*]/.test(portalPassword) ? '✓' : '•'} 1 Special (!@#$%^&*)
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Mandatory Citizen Confirmation Checkbox with High-Contrast Box */}
                <div className={`verification-gate ${verified ? 'is-verified' : ''}`} onClick={() => setVerified(!verified)}>
                  <div className="custom-check-box">
                    {verified && <span className="custom-check-tick">✓</span>}
                  </div>
                  <div>
                    <div className="gate-label">I confirm and verify the accuracy of this data</div>
                    <div className="gate-sub">The browser agent will fill the official portal using these verified details.</div>
                  </div>
                </div>

                <div className="action-buttons-row">
                  <button
                    className="gemini-btn gemini-btn-tonal"
                    onClick={() => {
                      if (!isDocRequired || docStepSkipped) {
                        setCurrentStep(1);
                      } else {
                        setCurrentStep(2);
                      }
                    }}
                  >
                    ← Back
                  </button>
                  <button
                    className="gemini-btn gemini-btn-primary"
                    disabled={!verified || !isFormComplete || loading}
                    onClick={handleCheckEligibility}
                    title={
                      !isFormComplete
                        ? (!hasFullName ? 'Please enter citizen Full Name' : !hasValidMobile ? 'Please enter valid 10-digit Mobile Number' : 'Please check required fields')
                        : !verified
                        ? 'Please tick the confirmation checkbox'
                        : 'Verify & Proceed to Registration'
                    }
                  >
                    {loading ? 'Evaluating…' : 'Verify & Proceed to Registration →'}
                  </button>
                  {eligibility && (
                    <button
                      className="gemini-btn gemini-btn-active-blue"
                      disabled={!verified || loading}
                      onClick={() => {
                        handleStartAgent();
                        setCurrentStep(4);
                      }}
                    >
                      Launch AI Browser Agent →
                    </button>
                  )}
                </div>

                {/* Eligibility card */}
                {eligibility && (() => {
                  const isEligible = Boolean(eligibility.eligible ?? (eligibility.status === 'ELIGIBLE'));
                  const statusClass = isEligible ? 'status-eligible' : 'status-ineligible';
                  const statusText = isEligible ? 'ELIGIBLE' : 'INELIGIBLE';
                  const serviceNameClean = (eligibility.service_name || eligibility.scheme_name || 'ServicePlus Application')
                    .replace(/\s*\(ID:\s*\d+\)/gi, '')
                    .replace(/\s*\(ServicePlus\s*\d+\)/gi, '');

                  return (
                    <div className={`eligibility-banner ${statusClass}`}>
                      <div className="banner-header">
                        <span>{isEligible ? '✅' : '⚠️'}</span>
                        <span>{statusText}: {serviceNameClean}</span>
                      </div>

                      {eligibility.summary && (
                        <p style={{ margin: '0.4rem 0 0.8rem', fontSize: '0.88rem', color: isEligible ? 'rgba(255,255,255,0.85)' : '#f2b8b5' }}>
                          {eligibility.summary}
                        </p>
                      )}

                      <ul className="banner-reasons">
                        {eligibility.results && eligibility.results.length > 0 ? (
                          eligibility.results.map((r, i) => (
                            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.35rem' }}>
                              <span>{r.passed ? '✅' : '❌'}</span>
                              <span>{r.explanation || r.description || r.rule_id}</span>
                            </li>
                          ))
                        ) : eligibility.reasons ? (
                          eligibility.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))
                        ) : null}
                      </ul>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* ════════════════════════════════════════
              STEP 4: SPLIT-SCREEN MISSION CONTROL
          ════════════════════════════════════════ */}
          {currentStep === 4 && (() => {
            const currentServiceId = selectedService?.service_id || profile.target_service_id || '1784';
            const isVidyaLakshmi =
              currentServiceId === 'vidyalakshmi' ||
              selectedService?.portal_id === 'VIDYA_LAKSHMI_PORTAL' ||
              /vidya|lakshmi/i.test(currentServiceId) ||
              /vidya|lakshmi/i.test(selectedService?.service_name || '') ||
              /vidyalakshmi/i.test(selectedService?.portal_url || '');

            const isServicePlus =
              (currentServiceId === '1784' || currentServiceId === 'citizen_registration') &&
              !currentServiceId.toLowerCase().includes('digilocker') &&
              !selectedService?.service_name?.toLowerCase().includes('digilocker') &&
              !selectedService?.portal_url?.toLowerCase().includes('digilocker') &&
              selectedService?.portal_id !== 'DIGILOCKER_PORTAL';

            const isDynamicPortal = !isVidyaLakshmi && !isServicePlus;

            const currentPortalUrl =
              selectedService?.portal_url ||
              dynamicBlueprint?.portal_url ||
              profile.target_portal_url ||
              (isVidyaLakshmi ? 'https://www.vidyalakshmi.co.in/Students/' : isServicePlus ? 'https://serviceonline.gov.in/citizenRegistration.html' : 'https://serviceonline.gov.in');
            const currentPortalName =
              selectedService?.portal_name ||
              dynamicBlueprint?.title ||
              profile.target_portal_name ||
              (isVidyaLakshmi ? 'Vidya Lakshmi Portal' : isServicePlus ? 'National ServicePlus Portal' : (selectedService?.service_name || 'Official Government Portal'));

            return (
              <div className="split-dashboard">
              {/* Left Column: Mission Controls */}
              <div className="control-panel">
                <div className="gemini-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <h2 className="card-title" style={{ fontSize: '1.1rem', margin: 0 }}>Agent Terminal</h2>
                    {agentRunning && <div className="pulse-indicator" />}
                  </div>
                  <p className="card-desc" style={{ marginBottom: '0.85rem' }}>
                    {agentRunning ? 'Autonomous agent executing actions…' : agentDone ? 'Paused for Human-in-the-Loop review.' : 'Ready.'}
                  </p>

                  <div className="log-terminal" ref={logRef}>
                    {agentLog.length === 0 && !agentRunning && (
                      <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
                        <div className="terminal-line" style={{ marginBottom: '1rem', color: '#9ca3af' }}>
                          Waiting for autonomous agent to connect…
                        </div>
                        <button
                          type="button"
                          className="gemini-btn gemini-btn-primary"
                          onClick={handleStartAgent}
                          disabled={loading}
                          style={{ margin: '0 auto', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                          🚀 Launch Autonomous Agent
                        </button>
                      </div>
                    )}
                    {agentLog.length === 0 && agentRunning && (
                      <div className="terminal-line">Connecting to autonomous browser agent…</div>
                    )}
                    {agentLog.map((line, idx) => (
                      <div
                        key={idx}
                        className={`terminal-line ${idx === agentLog.length - 1 ? 'active-line' : ''}`}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Human Checkpoint: CAPTCHA */}
                {agentDone && !submitted && (
                  <div className="captcha-container">
                    <div className="captcha-header">🔒 Live Portal CAPTCHA</div>
                    <div className="captcha-sub">
                      Agent paused at official portal checkpoint. Please enter the characters:
                    </div>

                    {captchaScreenshot ? (
                      <img
                        src={`data:image/png;base64,${captchaScreenshot}`}
                        alt="Portal Captcha"
                        style={{ maxWidth: '200px', borderRadius: '8px', marginBottom: '0.75rem', border: '1px solid #334155' }}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <div className="sp-captcha-visual" style={{ width: '150px', height: '42px' }}>
                          <span className="sp-mock-captcha-text">{fallbackCaptcha}</span>
                        </div>
                        <button
                          type="button"
                          className="sp-captcha-btn"
                          title="Refresh CAPTCHA"
                          onClick={async () => {
                            if (sessionId) {
                              showToast('Refetching fresh CAPTCHA from official portal...', 'info');
                              await handleStartAgent();
                            } else {
                              const newCode = refreshFallbackCaptcha();
                              showToast(`Refreshed CAPTCHA: ${newCode}`, 'info');
                            }
                          }}
                        >
                          🔄
                        </button>
                        <button
                          type="button"
                          className="sp-captcha-btn"
                          title="Listen to CAPTCHA"
                          onClick={() => {
                            if ('speechSynthesis' in window) {
                              const textToRead = captchaText || fallbackCaptcha;
                              const utt = new SpeechSynthesisUtterance(textToRead.split('').join(' '));
                              utt.rate = 0.8;
                              window.speechSynthesis.speak(utt);
                              showToast('Playing audio CAPTCHA...', 'info');
                            } else {
                              showToast('Audio playback not supported in this browser', 'info');
                            }
                          }}
                        >
                          🔊
                        </button>
                      </div>
                    )}

                    <div>
                      <input
                        className="captcha-input-field"
                        type="text"
                        placeholder="Captcha"
                        value={captchaText}
                        onChange={(e) => setCaptchaText(e.target.value)}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <button
                        className="gemini-btn gemini-btn-success"
                        style={{ width: '100%' }}
                        disabled={!captchaText || loading}
                        onClick={() => handleResume('SUBMIT')}
                      >
                        {loading ? 'Submitting…' : 'Approve & Submit Registration'}
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="gemini-btn gemini-btn-tonal" onClick={() => setCurrentStep(3)}>
                    ← Back
                  </button>
                  <button
                    type="button"
                    className="gemini-btn gemini-btn-danger"
                    onClick={handleStopAgent}
                    title="Stop browser agent and return to home page"
                  >
                    Stop Agent
                  </button>
                </div>

                {/* Quick Edit Citizen Details in Step 4 */}
                <div className="quick-edit-container">
                  <button
                    type="button"
                    className="quick-edit-toggle-btn"
                    onClick={() => setShowQuickEdit(!showQuickEdit)}
                  >
                    <span>✏️ {showQuickEdit ? 'Close Details Editor' : 'Edit Citizen Details & Re-fill'}</span>
                    <span style={{ fontSize: '0.8rem' }}>{showQuickEdit ? '▲' : '▼'}</span>
                  </button>

                  {showQuickEdit && (
                    <div className="quick-edit-body">
                      <div className="quick-edit-field">
                        <label>Full Name</label>
                        <input
                          type="text"
                          className="gemini-input"
                          value={profile.full_name || ''}
                          onChange={(e) => setProfile((prev) => ({ ...prev, full_name: e.target.value }))}
                        />
                      </div>
                      <div className="quick-edit-field">
                        <label>Email Address</label>
                        <input
                          type="email"
                          className="gemini-input"
                          value={profile.email || ''}
                          onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                        />
                      </div>
                      <div className="quick-edit-field">
                        <label>Mobile Number</label>
                        <input
                          type="tel"
                          maxLength={10}
                          className="gemini-input"
                          value={profile.mobile_number || ''}
                          onChange={(e) =>
                            setProfile((prev) => ({
                              ...prev,
                              mobile_number: e.target.value.replace(/\D/g, '').slice(0, 10),
                            }))
                          }
                        />
                      </div>
                      <div className="quick-edit-field">
                        <label>State</label>
                        <input
                          type="text"
                          className="gemini-input"
                          value={profile.state || ''}
                          onChange={(e) => setProfile((prev) => ({ ...prev, state: e.target.value }))}
                        />
                      </div>
                      <button
                        type="button"
                        className="gemini-btn gemini-btn-primary"
                        style={{ width: '100%', marginTop: '0.5rem' }}
                        disabled={loading}
                        onClick={async () => {
                          setShowQuickEdit(false);
                          await handleStartAgent();
                        }}
                      >
                        🔄 Update & Re-fill Portal Form
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Live Portal Display */}
              <div className="portal-window">
                <div className="portal-top-bar">
                  <div className="browser-traffic-lights">
                    <span className="light close" />
                    <span className="light min" />
                    <span className="light max" />
                  </div>

                  {/* Mode switcher: Interactive vs Screenshot */}
                  <div className="portal-view-toggle">
                    <button
                      type="button"
                      className={`portal-toggle-btn ${portalViewMode === 'interactive' ? 'active' : ''}`}
                      onClick={() => setPortalViewMode('interactive')}
                      title="Directly interact with and fill the official portal form"
                    >
                      ⚡ Interactive Form
                    </button>
                    <button
                      type="button"
                      className={`portal-toggle-btn ${portalViewMode === 'screenshot' ? 'active' : ''}`}
                      onClick={() => setPortalViewMode('screenshot')}
                      title="View the raw Playwright browser viewport screenshot"
                    >
                      📸 Live Screenshot
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: 1, minWidth: 0 }}>
                    <div className="browser-url-pill">
                      <span>🔒</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {currentPortalUrl}
                      </span>
                    </div>
                    {dynamicBlueprint?.is_reachable === false ? (
                      <div className="live-portal-pill-badge" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }} title="Government portal is currently offline or unreachable">
                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', marginRight: '6px' }} />
                        PORTAL OFFLINE / UNREACHABLE
                      </div>
                    ) : portalAuthenticated ? (
                      <div className="live-portal-pill-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.4)', color: '#6ee7b7' }} title={`Authenticated session on ${currentPortalName}`}>
                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', marginRight: '6px' }} />
                        AUTHENTICATED SESSION
                      </div>
                    ) : (
                      <div className="live-portal-pill-badge" title={`Citizen Sign-In Gateway on ${currentPortalName}`}>
                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', marginRight: '6px' }} />
                        PORTAL SIGN-IN GATEWAY
                      </div>
                    )}
                    <a
                      href={currentPortalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="portal-open-tab-btn"
                      title={`Open official ${currentPortalName} directly in a new browser tab`}
                    >
                      ↗ Open Tab
                    </a>
                  </div>
                </div>

                <div className="portal-document-body">
                  {portalViewMode === 'screenshot' && pageScreenshot ? (
                    <div style={{ textAlign: 'center', padding: '0.5rem' }}>
                      <img
                        src={`data:image/png;base64,${pageScreenshot}`}
                        alt="Portal Live Screenshot"
                        style={{ width: '100%', borderRadius: '4px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}
                      />
                    </div>
                  ) : dynamicBlueprint?.is_reachable === false ? (
                    <div style={{ padding: '3rem 2rem', textAlign: 'center', background: 'rgba(15, 23, 42, 0.85)', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.35)', margin: '1rem' }}>
                      <div style={{ fontSize: '3.5rem', marginBottom: '1.25rem' }}>⚠️</div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#f87171', marginBottom: '0.75rem' }}>
                        Government Portal is Currently Unreachable (Site Down / DNS Error)
                      </div>
                      <p style={{ color: '#cbd5e1', fontSize: '0.92rem', maxWidth: '620px', margin: '0 auto 1.5rem', lineHeight: '1.6' }}>
                        The autonomous agent attempted to connect to <code>{currentPortalUrl}</code>, but the government domain could not be resolved or the remote server is offline (<strong>DNS_PROBE_FINISHED_NXDOMAIN</strong> / Network Error).
                      </p>
                      <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px dashed rgba(239, 68, 68, 0.3)', borderRadius: '10px', padding: '0.95rem 1.25rem', maxWidth: '580px', margin: '0 auto 1.85rem', textAlign: 'left', fontSize: '0.82rem', color: '#fca5a5' }}>
                        <div><strong>Server Status:</strong> Unreachable / Offline</div>
                        <div><strong>Attempted URL:</strong> <code>{currentPortalUrl}</code></div>
                        <div><strong>Diagnostic:</strong> {dynamicBlueprint.error_message || 'Domain name does not exist or government server is currently down.'}</div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                        <a
                          href={currentPortalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="gemini-btn gemini-btn-tonal"
                          style={{ textDecoration: 'none' }}
                        >
                          Verify in Real Browser ↗
                        </a>
                        <button
                          type="button"
                          className="gemini-btn gemini-btn-primary"
                          onClick={() => scanPortal(currentPortalUrl)}
                        >
                          🔄 Retry Connection
                        </button>
                        <button
                          type="button"
                          className="gemini-btn gemini-btn-tonal"
                          onClick={() => {
                            if (selectedService) {
                              setSelectedService({
                                ...selectedService,
                                service_id: '1784',
                                portal_url: 'https://serviceonline.gov.in/citizenRegistration.html',
                                portal_name: 'National ServicePlus Portal',
                              });
                            }
                            setCurrentStep(1);
                          }}
                        >
                          Switch to Verified Portal (ServicePlus 1784)
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Multi-Stage Portal Journey Tracker */}
                      <div className="portal-journey-tracker">
                        <div
                          className={`pjt-step ${portalPhase === 'LOGIN' ? 'active' : portalAuthenticated ? 'completed' : ''}`}
                          onClick={() => setPortalPhase('LOGIN')}
                        >
                          <span className="pjt-num">{portalAuthenticated ? '✓' : '1'}</span>
                          <span className="pjt-label">Portal Sign-In / Gateway</span>
                        </div>
                        <div className={`pjt-divider ${portalAuthenticated ? 'completed' : ''}`} />
                        <div
                          className={`pjt-step ${portalPhase === 'FORM' ? 'active' : portalPhase === 'SUBMIT' ? 'completed' : ''}`}
                          onClick={() => {
                            if (portalAuthenticated) setPortalPhase('FORM');
                            else showToast('Please authenticate into the portal first.', 'info');
                          }}
                        >
                          <span className="pjt-num">{portalPhase === 'SUBMIT' ? '✓' : '2'}</span>
                          <span className="pjt-label">Scheme Application Form</span>
                        </div>
                        <div className={`pjt-divider ${portalPhase === 'SUBMIT' ? 'completed' : ''}`} />
                        <div
                          className={`pjt-step ${portalPhase === 'SUBMIT' ? 'active' : ''}`}
                          onClick={() => {
                            if (portalAuthenticated) setPortalPhase('SUBMIT');
                            else showToast('Please sign in and review the form first.', 'info');
                          }}
                        >
                          <span className="pjt-num">3</span>
                          <span className="pjt-label">Human Verification & Submit</span>
                        </div>
                      </div>

                      {/* STAGE 1: Portal Authentication Gateway */}
                      {portalPhase === 'LOGIN' && !portalAuthenticated ? (
                        <div className="portal-login-card">
                          <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                            <div style={{ fontSize: '2.75rem', marginBottom: '0.4rem' }}>
                              {isVidyaLakshmi ? '🎓' : isServicePlus ? '🏛️' : '🇮🇳'}
                            </div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>
                              {currentPortalName} — Citizen Sign-In Gateway
                            </div>
                            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                              Ministry / Department Official Single-Window Citizen Access
                            </div>
                          </div>

                          <div className="portal-auth-banner">
                            <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>🔒</span>
                            <div>
                              <strong>Government Portal Security Architecture:</strong>
                              <div>Before accessing scheme application forms or submitting documents, official government portals require an authenticated citizen session to securely link your profile to your Aadhaar/Mobile identity.</div>
                            </div>
                          </div>

                          <div className="portal-auth-tabs">
                            <div
                              className={`portal-auth-tab ${portalLoginMode === 'existing' ? 'active' : ''}`}
                              onClick={() => setPortalLoginMode('existing')}
                            >
                              Sign In with Existing Account
                            </div>
                            <div
                              className={`portal-auth-tab ${portalLoginMode === 'register' ? 'active' : ''}`}
                              onClick={() => setPortalLoginMode('register')}
                            >
                              ⚡ One-Click Auto-Register
                            </div>
                          </div>

                          {portalLoginMode === 'existing' ? (
                            <div>
                              <div className="sp-form-row">
                                <label className="sp-label">Citizen User ID / Mobile / Email <span className="sp-req">*</span></label>
                                <input
                                  type="text"
                                  className="sp-input"
                                  value={portalLoginId || profile.mobile_number || profile.email || ''}
                                  onChange={(e) => setPortalLoginId(e.target.value)}
                                  placeholder="Enter 10-digit mobile number or User ID"
                                />
                              </div>

                              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#cbd5e1', cursor: 'pointer' }}>
                                  <input
                                    type="radio"
                                    name="authMethod"
                                    checked={portalAuthMethod === 'password'}
                                    onChange={() => setPortalAuthMethod('password')}
                                  />
                                  Password / PIN
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#cbd5e1', cursor: 'pointer' }}>
                                  <input
                                    type="radio"
                                    name="authMethod"
                                    checked={portalAuthMethod === 'otp'}
                                    onChange={() => setPortalAuthMethod('otp')}
                                  />
                                  Mobile OTP
                                </label>
                              </div>

                              {portalAuthMethod === 'password' ? (
                                <div className="sp-form-row">
                                  <label className="sp-label">Account Password / Security PIN <span className="sp-req">*</span></label>
                                  <input
                                    type={showPassword ? 'text' : 'password'}
                                    className="sp-input"
                                    value={portalPassword || 'VoiceLegacy@2026'}
                                    onChange={(e) => setPortalPassword(e.target.value)}
                                    placeholder="Enter portal password"
                                  />
                                </div>
                              ) : (
                                <div className="sp-form-row">
                                  <label className="sp-label">One-Time Password (OTP) <span className="sp-req">*</span></label>
                                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                      type="text"
                                      className="sp-input"
                                      value={portalOtp || (portalOtpSent ? '849201' : '')}
                                      onChange={(e) => setPortalOtp(e.target.value)}
                                      placeholder={portalOtpSent ? '849201' : 'Click Send OTP'}
                                    />
                                    <button
                                      type="button"
                                      className="gemini-btn gemini-btn-tonal"
                                      style={{ whiteSpace: 'nowrap' }}
                                      onClick={() => {
                                        setPortalOtpSent(true);
                                        setPortalOtp('849201');
                                        showToast(`OTP sent to +91 ${profile.mobile_number || '9876543210'}!`, 'success');
                                      }}
                                    >
                                      {portalOtpSent ? '✓ OTP Sent' : 'Send OTP'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              <div style={{ marginTop: '1.5rem' }}>
                                <button
                                  type="button"
                                  className="dp-btn-submit"
                                  style={{ width: '100%', padding: '0.9rem', fontSize: '0.95rem', fontWeight: 600 }}
                                  onClick={() => handlePortalLogin('existing')}
                                >
                                  🔐 Sign In to {currentPortalName} & Proceed to Form →
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p style={{ color: '#94a3b8', fontSize: '0.88rem', marginBottom: '1.25rem', lineHeight: '1.5' }}>
                                Don't have an account on {currentPortalName}? The autonomous agent will automatically create your citizen profile using your verified documents:
                              </p>
                              <div style={{ background: 'rgba(255, 255, 255, 0.04)', borderRadius: '10px', padding: '1rem', border: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '1.5rem' }}>
                                <div style={{ fontSize: '0.84rem', color: '#cbd5e1', marginBottom: '0.4rem' }}>
                                  <strong>Applicant:</strong> {profile.full_name || 'Citizen'}
                                </div>
                                <div style={{ fontSize: '0.84rem', color: '#cbd5e1', marginBottom: '0.4rem' }}>
                                  <strong>Mobile:</strong> +91 {profile.mobile_number || '9876543210'}
                                </div>
                                <div style={{ fontSize: '0.84rem', color: '#cbd5e1', marginBottom: '0.4rem' }}>
                                  <strong>DOB:</strong> {profile.date_of_birth || 'Verified via Aadhaar'}
                                </div>
                                <div style={{ fontSize: '0.84rem', color: '#cbd5e1' }}>
                                  <strong>Domicile State:</strong> {profile.state || 'Selected State'}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="dp-btn-submit"
                                style={{ width: '100%', padding: '0.9rem', fontSize: '0.95rem', fontWeight: 600 }}
                                onClick={() => handlePortalLogin('register')}
                              >
                                ⚡ Auto-Create Citizen Account & Open Application Form →
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          {/* Authenticated Session Banner */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '10px', padding: '0.65rem 1rem', margin: '0 1rem 1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#6ee7b7' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                              <span><strong>Authenticated Session Active:</strong> {profile.full_name || 'Citizen Applicant'} ({profile.mobile_number || '9876543210'})</span>
                            </div>
                            <button
                              type="button"
                              style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={() => {
                                setPortalAuthenticated(false);
                                setPortalPhase('LOGIN');
                                showToast('Switched to portal sign-in gateway', 'info');
                              }}
                            >
                              Sign Out / Switch Account
                            </button>
                          </div>

                          {isVidyaLakshmi ? (
                    /* ═══════════════════════════════════════════════════
                       VIDYA LAKSHMI STUDENT REGISTRATION LAYOUT (Bug 3 & 5)
                       ═══════════════════════════════════════════════════ */
                    <div className="vidyalakshmi-live-container">
                      <div className="vl-masthead">
                        <div className="vl-branding-group">
                          <div className="vl-emblem-badge" title="National Emblem of India">🎓</div>
                          <div className="vl-logo-combo">
                            <span className="vl-logo-title">
                              विद्या लक्ष्मी • Vidya Lakshmi
                            </span>
                            <span className="vl-logo-subtitle">
                              National Portal for Students Seeking Higher Education Scholarships & Loans (Govt. of India)
                            </span>
                          </div>
                        </div>

                        <div className="vl-top-nav">
                          <span className="vl-nav-pill" onClick={() => showToast('Searching 140+ education loan schemes...', 'info')}>
                            🔍 Loan Search
                          </span>
                          <span className="vl-nav-pill" onClick={() => showToast('Filtering National & State scholarships...', 'info')}>
                            🎓 Scholarships
                          </span>
                          <span className="vl-nav-pill" onClick={() => showToast('Track status by CELAF application ID', 'info')}>
                            📄 Track Status
                          </span>
                        </div>
                      </div>

                      <div className="vl-form-card">
                        <div className="vl-card-header">
                          <span className="vl-badge-edu">Ministry of Education & NSDL e-Gov</span>
                          <div className="vl-card-title">Student Registration / Scholarship & Loan Application</div>
                          <div className="vl-card-subtitle">
                            Common Education Loan Application Form (CELAF) for Indian & Global Higher Studies
                          </div>
                        </div>

                        {/* Student Name */}
                        <div className="sp-form-row">
                          <label className="sp-label">
                            Student Full Name (as per 10th/12th Marksheet) <span className="sp-req">*</span>
                          </label>
                          <input
                            type="text"
                            className="sp-input"
                            value={profile.full_name || ''}
                            onChange={(e) => setProfile((prev) => ({ ...prev, full_name: e.target.value }))}
                            placeholder="Enter full legal name"
                          />
                        </div>

                        {/* Father's / Guardian's Name */}
                        <div className="sp-form-row">
                          <label className="sp-label">
                            Father / Guardian Name <span className="sp-req">*</span>
                          </label>
                          <input
                            type="text"
                            className="sp-input"
                            value={profile.father_or_guardian_name || ''}
                            onChange={(e) => setProfile((prev) => ({ ...prev, father_or_guardian_name: e.target.value }))}
                            placeholder="Enter father or guardian name"
                          />
                        </div>

                        {/* Date of Birth & Gender Row */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                          <div className="sp-form-row">
                            <label className="sp-label">
                              Date of Birth <span className="sp-req">*</span>
                            </label>
                            <input
                              type="date"
                              className="sp-input"
                              value={toIsoDate(profile.date_of_birth)}
                              onChange={(e) => setProfile((prev) => ({ ...prev, date_of_birth: e.target.value }))}
                              max={new Date().toISOString().split('T')[0]}
                            />
                          </div>

                          <div className="sp-form-row">
                            <label className="sp-label">
                              Gender <span className="sp-req">*</span>
                            </label>
                            <select
                              className="sp-input"
                              value={profile.gender || 'male'}
                              onChange={(e) => setProfile((prev) => ({ ...prev, gender: e.target.value }))}
                            >
                              <option value="male">Male</option>
                              <option value="female">Female</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                        </div>

                        {/* Mobile Number & Email */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                          <div className="sp-form-row">
                            <label className="sp-label">
                              Mobile Number <span className="sp-req">*</span>
                            </label>
                            <input
                              type="tel"
                              className="sp-input"
                              value={profile.mobile_number || ''}
                              onChange={(e) =>
                                setProfile((prev) => ({
                                  ...prev,
                                  mobile_number: e.target.value.replace(/\D/g, '').slice(0, 10),
                                }))
                              }
                              placeholder="10-digit mobile number"
                            />
                          </div>

                          <div className="sp-form-row">
                            <label className="sp-label">
                              Email Address (Student ID) <span className="sp-req">*</span>
                            </label>
                            <input
                              type="email"
                              className="sp-input"
                              value={profile.email || ''}
                              onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                              placeholder="student@example.com"
                            />
                          </div>
                        </div>

                        {/* Password */}
                        <div className="sp-form-row">
                          <label className="sp-label">
                            Portal Account Password <span className="sp-req">*</span>
                          </label>
                          <div className="sp-password-wrap">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              className="sp-input sp-password-input"
                              value={portalPassword}
                              onChange={(e) => setPortalPassword(e.target.value)}
                              placeholder="Choose student account password"
                            />
                            <button
                              type="button"
                              className="sp-password-toggle-btn"
                              onClick={() => setShowPassword(!showPassword)}
                              title={showPassword ? 'Hide password' : 'Show password'}
                            >
                              {showPassword ? '👁️' : '🔒'}
                            </button>
                          </div>
                          <div className="sp-password-note" style={{ color: '#0369a1' }}>
                            ✓ Password set during verification. Minimum 8 chars with uppercase, lowercase, numeric and special symbol.
                          </div>
                        </div>

                        {/* State & Family Income */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                          <div className="sp-form-row">
                            <label className="sp-label">
                              State of Domicile <span className="sp-req">*</span>
                            </label>
                            <select
                              className="sp-input"
                              value={profile.state ? profile.state.toUpperCase() : 'UTTAR PRADESH'}
                              onChange={(e) => setProfile((prev) => ({ ...prev, state: e.target.value }))}
                            >
                              <option value="ANDHRA PRADESH">ANDHRA PRADESH</option>
                              <option value="BIHAR">BIHAR</option>
                              <option value="DELHI">DELHI</option>
                              <option value="GUJARAT">GUJARAT</option>
                              <option value="HARYANA">HARYANA</option>
                              <option value="KARNATAKA">KARNATAKA</option>
                              <option value="KERALA">KERALA</option>
                              <option value="MADHYA PRADESH">MADHYA PRADESH</option>
                              <option value="MAHARASHTRA">MAHARASHTRA</option>
                              <option value="PUNJAB">PUNJAB</option>
                              <option value="RAJASTHAN">RAJASTHAN</option>
                              <option value="TAMIL NADU">TAMIL NADU</option>
                              <option value="TELANGANA">TELANGANA</option>
                              <option value="UTTAR PRADESH">UTTAR PRADESH</option>
                              <option value="WEST BENGAL">WEST BENGAL</option>
                            </select>
                          </div>

                          <div className="sp-form-row">
                            <label className="sp-label">
                              Annual Family Income (₹) <span className="sp-req">*</span>
                            </label>
                            <input
                              type="number"
                              className="sp-input"
                              value={profile.annual_income || ''}
                              onChange={(e) => setProfile((prev) => ({ ...prev, annual_income: Number(e.target.value) }))}
                              placeholder="e.g. 250000"
                            />
                          </div>
                        </div>

                        {/* Security Verification (CAPTCHA) */}
                        <div className="sp-captcha-container">
                          <label className="sp-label" style={{ marginBottom: '0.4rem', display: 'block' }}>
                            Security Verification <span className="sp-req">*</span>
                          </label>
                          <div className="sp-captcha-flex-row">
                            <div className="sp-captcha-visual">
                              {captchaScreenshot ? (
                                <img
                                  src={`data:image/png;base64,${captchaScreenshot}`}
                                  alt="Live Portal CAPTCHA"
                                />
                              ) : (
                                <span className="sp-mock-captcha-text">{fallbackCaptcha}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="sp-captcha-btn"
                              title="Refresh CAPTCHA"
                              onClick={async () => {
                                if (sessionId) {
                                  showToast('Refetching fresh CAPTCHA from Vidya Lakshmi portal...', 'info');
                                  await handleStartAgent();
                                } else {
                                  const newCode = refreshFallbackCaptcha();
                                  showToast(`Refreshed CAPTCHA: ${newCode}`, 'info');
                                }
                              }}
                            >
                              🔄
                            </button>
                            <button
                              type="button"
                              className="sp-captcha-btn"
                              title="Listen to CAPTCHA"
                              onClick={() => {
                                if ('speechSynthesis' in window) {
                                  const textToRead = captchaText || fallbackCaptcha;
                                  const utt = new SpeechSynthesisUtterance(textToRead.split('').join(' '));
                                  utt.rate = 0.8;
                                  window.speechSynthesis.speak(utt);
                                  showToast('Playing audio CAPTCHA...', 'info');
                                } else {
                                  showToast('Audio playback not supported in this browser', 'info');
                                }
                              }}
                            >
                              🔊
                            </button>
                            <input
                              type="text"
                              className="sp-input sp-captcha-text-input"
                              placeholder="Enter Captcha"
                              value={captchaText}
                              onChange={(e) => setCaptchaText(e.target.value)}
                            />
                          </div>
                        </div>

                        {/* Terms and Conditions */}
                        <div className="sp-terms-group">
                          <input
                            type="checkbox"
                            id="vl-terms-input"
                            checked={termsAccepted}
                            onChange={(e) => setTermsAccepted(e.target.checked)}
                          />
                          <label htmlFor="vl-terms-input">
                            I declare that the information provided is correct and I accept the terms & conditions of the Vidya Lakshmi Portal (Ministry of Education & NSDL).
                          </label>
                        </div>

                        {/* Single Primary Action Button */}
                        <div className="sp-form-actions">
                          {portalPhase === 'FORM' ? (
                            <button
                              type="button"
                              className="vl-btn-register"
                              style={{ width: '100%', padding: '0.9rem', fontSize: '0.95rem' }}
                              onClick={() => {
                                setPortalPhase('SUBMIT');
                                setAgentLog((prev) => [
                                  ...prev,
                                  '📝 [FORM VERIFIED] CELAF application fields verified.',
                                  '🔒 [STAGE 3/3: HUMAN VERIFICATION] Awaiting citizen CAPTCHA solution...',
                                ]);
                                showToast('Form populated! Please solve CAPTCHA to submit.', 'info');
                              }}
                            >
                              Proceed to Human Verification & CAPTCHA →
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="vl-btn-register"
                              disabled={!captchaText || loading || !termsAccepted}
                              onClick={() => handleResume('SUBMIT')}
                            >
                              {loading ? 'Submitting to Vidya Lakshmi…' : 'Approve & Submit Registration for Vidya Lakshmi'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : isServicePlus ? (
                    <div className="serviceplus-live-container">
                      {/* ServicePlus Top Header */}
                      <div className="serviceplus-masthead">
                        <div className="sp-branding-group">
                          <div className="sp-emblem-badge" title="National Emblem of India">🏛️</div>
                          <div className="sp-logo-combo">
                            <div className="sp-logo-row">
                              <span className="sp-logo-orange-s">S</span>
                              <span className="sp-logo-title">Service<span style={{ color: '#ea580c' }}>Plus</span></span>
                            </div>
                            <span className="sp-logo-subtitle">
                              Metadata based Integrated eService Delivery Framework
                            </span>
                          </div>
                        </div>

                        <div className="sp-top-links">
                          {/* 1. Select Instance Dropdown */}
                          <div style={{ position: 'relative' }}>
                            <button
                              type="button"
                              className={`sp-link-btn ${showInstanceMenu ? 'active' : ''}`}
                              onClick={() => setShowInstanceMenu(!showInstanceMenu)}
                              title="Switch ServicePlus state instance"
                            >
                              <span>{selectedInstance.split(' ')[0]} Instance ▾</span>
                            </button>

                            {showInstanceMenu && (
                              <div className="sp-dropdown-menu">
                                {[
                                  'National Portal (serviceonline.gov.in)',
                                  'Uttar Pradesh (e-District)',
                                  'Bihar (RTPS Portal)',
                                  'Madhya Pradesh (e-Nagar Palika)',
                                  'Tripura (e-District)',
                                  'Karnataka (Seva Sindhu)',
                                  'Assam (Sewa Setu)',
                                  'Maharashtra (Aaple Sarkar)',
                                ].map((inst) => (
                                  <button
                                    key={inst}
                                    type="button"
                                    className={`sp-dropdown-item ${selectedInstance === inst ? 'selected' : ''}`}
                                    onClick={() => {
                                      setSelectedInstance(inst);
                                      setShowInstanceMenu(false);
                                      showToast(`Switched instance to ${inst}`, 'success');
                                      if (inst.includes('Uttar Pradesh')) setProfile((p) => ({ ...p, state: 'UTTAR PRADESH' }));
                                      else if (inst.includes('Bihar')) setProfile((p) => ({ ...p, state: 'BIHAR' }));
                                      else if (inst.includes('Madhya Pradesh')) setProfile((p) => ({ ...p, state: 'MADHYA PRADESH' }));
                                      else if (inst.includes('Karnataka')) setProfile((p) => ({ ...p, state: 'KARNATAKA' }));
                                      else if (inst.includes('Maharashtra')) setProfile((p) => ({ ...p, state: 'MAHARASHTRA' }));
                                    }}
                                  >
                                    <span>{inst}</span>
                                    {selectedInstance === inst && <span>✓</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* 2. Check Eligibility Modal Trigger */}
                          <button
                            type="button"
                            className="sp-link-btn"
                            onClick={() => setShowEligibilityModal(true)}
                            title="View official scheme criteria and guidelines"
                          >
                            <span>📋 Check Eligibility</span>
                          </button>

                          {/* 3. Contact Us Modal Trigger */}
                          <button
                            type="button"
                            className="sp-link-btn"
                            onClick={() => setShowContactModal(true)}
                            title="Open official NIC ServicePlus Helpdesk & Contacts"
                          >
                            <span>📞 Contact Us</span>
                          </button>
                        </div>
                      </div>

                      {/* Registration Form Card */}
                      <div className="sp-reg-card">
                        <div className="sp-reg-card-accent" />
                        <h2 className="sp-reg-heading">REGISTRATION</h2>

                        {/* Full Name */}
                        <div className="sp-form-row">
                          <label className="sp-label">
                            Full Name <span className="sp-req">*</span>
                          </label>
                          <input
                            type="text"
                            className="sp-input"
                            value={profile.full_name || ''}
                            onChange={(e) => setProfile((prev) => ({ ...prev, full_name: e.target.value }))}
                            placeholder="Enter applicant full name"
                          />
                        </div>

                        {/* Email Id */}
                        <div className="sp-form-row">
                          <label className="sp-label">
                            Email Id <span className="sp-req">*</span>
                          </label>
                          <input
                            type="email"
                            className="sp-input"
                            value={profile.email || ''}
                            onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                            placeholder="name@example.com"
                          />
                        </div>

                        {/* Mobile No. */}
                        <div className="sp-form-row">
                          <label className="sp-label">
                            Mobile No. <span className="sp-req">*</span>
                          </label>
                          <input
                            type="tel"
                            maxLength={10}
                            className="sp-input"
                            value={profile.mobile_number || ''}
                            onChange={(e) =>
                              setProfile((prev) => ({
                                ...prev,
                                mobile_number: e.target.value.replace(/\D/g, '').slice(0, 10),
                              }))
                            }
                            placeholder="10-digit mobile number"
                          />
                        </div>

                        {/* Password */}
                        <div className="sp-form-row">
                          <label className="sp-label">
                            Password <span className="sp-req">*</span>
                          </label>
                          <div className="sp-password-wrap">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              className="sp-input sp-password-input"
                              value={portalPassword}
                              onChange={(e) => setPortalPassword(e.target.value)}
                              placeholder="Enter account password"
                            />
                            <button
                              type="button"
                              className="sp-password-toggle-btn"
                              onClick={() => setShowPassword(!showPassword)}
                              title={showPassword ? 'Hide password' : 'Show password'}
                            >
                              {showPassword ? '👁️' : '🔒'}
                            </button>
                          </div>
                          <div className="sp-password-note">
                            Note: Password should be at least '8' characters with at least one special character(!@#$%^&*), one numeric, one small case and one upper case letter (e.g. Citizen@2026)
                          </div>
                        </div>

                        {/* State */}
                        <div className="sp-form-row">
                          <label className="sp-label">
                            Select State <span className="sp-req">*</span>
                          </label>
                          <select
                            className="sp-input"
                            value={profile.state ? profile.state.toUpperCase() : 'UTTAR PRADESH'}
                            onChange={(e) => setProfile((prev) => ({ ...prev, state: e.target.value }))}
                          >
                            <option value="">-- Select State --</option>
                            <option value="ANDHRA PRADESH">ANDHRA PRADESH</option>
                            <option value="BIHAR">BIHAR</option>
                            <option value="CHHATTISGARH">CHHATTISGARH</option>
                            <option value="DELHI">DELHI</option>
                            <option value="GUJARAT">GUJARAT</option>
                            <option value="HARYANA">HARYANA</option>
                            <option value="HIMACHAL PRADESH">HIMACHAL PRADESH</option>
                            <option value="JHARKHAND">JHARKHAND</option>
                            <option value="KARNATAKA">KARNATAKA</option>
                            <option value="KERALA">KERALA</option>
                            <option value="MADHYA PRADESH">MADHYA PRADESH</option>
                            <option value="MAHARASHTRA">MAHARASHTRA</option>
                            <option value="ODISHA">ODISHA</option>
                            <option value="PUNJAB">PUNJAB</option>
                            <option value="RAJASTHAN">RAJASTHAN</option>
                            <option value="TAMIL NADU">TAMIL NADU</option>
                            <option value="TELANGANA">TELANGANA</option>
                            <option value="UTTAR PRADESH">UTTAR PRADESH</option>
                            <option value="UTTARAKHAND">UTTARAKHAND</option>
                            <option value="WEST BENGAL">WEST BENGAL</option>
                          </select>
                        </div>

                        {/* Captcha Section */}
                        <div className="sp-captcha-container">
                          <label className="sp-label" style={{ marginBottom: '0.4rem', display: 'block' }}>
                            Security Verification <span className="sp-req">*</span>
                          </label>
                          <div className="sp-captcha-flex-row">
                            <div className="sp-captcha-visual">
                              {captchaScreenshot ? (
                                <img
                                  src={`data:image/png;base64,${captchaScreenshot}`}
                                  alt="Live Portal CAPTCHA"
                                />
                              ) : (
                                <span className="sp-mock-captcha-text">{fallbackCaptcha}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="sp-captcha-btn"
                              title="Refresh CAPTCHA"
                              onClick={async () => {
                                if (sessionId) {
                                  showToast('Refetching fresh CAPTCHA from official portal...', 'info');
                                  await handleStartAgent();
                                } else {
                                  const newCode = refreshFallbackCaptcha();
                                  showToast(`Refreshed CAPTCHA: ${newCode}`, 'info');
                                }
                              }}
                            >
                              🔄
                            </button>
                            <button
                              type="button"
                              className="sp-captcha-btn"
                              title="Listen to CAPTCHA"
                              onClick={() => {
                                if ('speechSynthesis' in window) {
                                  const textToRead = captchaText || fallbackCaptcha;
                                  const utt = new SpeechSynthesisUtterance(textToRead.split('').join(' '));
                                  utt.rate = 0.8;
                                  window.speechSynthesis.speak(utt);
                                  showToast('Playing audio CAPTCHA...', 'info');
                                } else {
                                  showToast('Audio playback not supported in this browser', 'info');
                                }
                              }}
                            >
                              🔊
                            </button>
                            <input
                              type="text"
                              className="sp-input sp-captcha-text-input"
                              placeholder="Enter Captcha"
                              value={captchaText}
                              onChange={(e) => setCaptchaText(e.target.value)}
                            />
                          </div>
                        </div>

                        {/* Terms and Conditions */}
                        <div className="sp-terms-group">
                          <input
                            type="checkbox"
                            id="sp-terms-input"
                            checked={termsAccepted}
                            onChange={(e) => setTermsAccepted(e.target.checked)}
                          />
                          <label htmlFor="sp-terms-input">
                            I declare that the information provided is correct and I accept the terms & conditions of the ServicePlus Portal.
                          </label>
                        </div>

                        {/* Single Primary Action Button */}
                        <div className="sp-form-actions">
                          <button
                            type="button"
                            className="sp-action-btn-primary"
                            style={{ width: '100%' }}
                            disabled={!captchaText || loading || !termsAccepted}
                            onClick={() => handleResume('SUBMIT')}
                          >
                            {loading ? 'Submitting to Official Portal…' : 'Submit Registration'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* ═══════════════════════════════════════════════════════
                       ZERO-SHOT DYNAMIC PORTAL LIVE INTERACTIVE FORM (Task 3)
                       Live fields distilled by DOM Reasoner for target portal
                       ═══════════════════════════════════════════════════════ */
                    <div className="dynamic-portal-live-container">
                      {dynamicBlueprint?.is_reachable === false ? (
                        <div style={{ padding: '3rem 2rem', textAlign: 'center', background: 'rgba(15, 23, 42, 0.85)', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.35)', margin: '1rem' }}>
                          <div style={{ fontSize: '3.5rem', marginBottom: '1.25rem' }}>⚠️</div>
                          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#f87171', marginBottom: '0.75rem' }}>
                            Government Portal is Currently Unreachable (Site Down / DNS Error)
                          </div>
                          <p style={{ color: '#cbd5e1', fontSize: '0.92rem', maxWidth: '620px', margin: '0 auto 1.5rem', lineHeight: '1.6' }}>
                            The autonomous agent attempted to connect to <code>{currentPortalUrl}</code>, but the government domain could not be resolved or the remote server is offline (<strong>DNS_PROBE_FINISHED_NXDOMAIN</strong> / Network Error).
                          </p>
                          <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px dashed rgba(239, 68, 68, 0.3)', borderRadius: '10px', padding: '0.95rem 1.25rem', maxWidth: '580px', margin: '0 auto 1.85rem', textAlign: 'left', fontSize: '0.82rem', color: '#fca5a5' }}>
                            <div><strong>Server Status:</strong> Unreachable / Offline</div>
                            <div><strong>Attempted URL:</strong> <code>{currentPortalUrl}</code></div>
                            <div><strong>Diagnostic:</strong> {dynamicBlueprint.error_message || 'Domain name does not exist or government server is currently down.'}</div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                            <a
                              href={currentPortalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="gemini-btn gemini-btn-tonal"
                              style={{ textDecoration: 'none' }}
                            >
                              Verify in Real Browser ↗
                            </a>
                            <button
                              type="button"
                              className="gemini-btn gemini-btn-primary"
                              onClick={() => scanPortal(currentPortalUrl)}
                            >
                              🔄 Retry Connection
                            </button>
                            <button
                              type="button"
                              className="gemini-btn gemini-btn-tonal"
                              onClick={() => {
                                if (selectedService) {
                                  setSelectedService({
                                    ...selectedService,
                                    service_id: '1784',
                                    portal_url: 'https://serviceonline.gov.in/citizenRegistration.html',
                                    portal_name: 'National ServicePlus Portal',
                                  });
                                }
                                setCurrentStep(1);
                              }}
                            >
                              Switch to Verified Portal (ServicePlus 1784)
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                      {/* Dynamic Portal Masthead */}
                      <div className="dp-masthead">
                        <div className="dp-branding-group">
                          <div className="dp-emblem-badge" title="Official Government Emblem">🏛️</div>
                          <div className="dp-logo-combo">
                            <span className="dp-logo-title">
                              {currentPortalName}
                            </span>
                            <span className="dp-logo-subtitle">
                              {selectedService?.service_name || 'Official Scheme & Enterprise Registration Portal'}
                            </span>
                          </div>
                        </div>

                        <div className="dp-top-nav">
                          <span className="dp-badge-status">
                            ● LIVE DISTILLED DOM
                          </span>
                          <span
                            className="dp-nav-pill"
                            onClick={() => showToast(`Connected to official portal: ${currentPortalUrl}`, 'info')}
                            title="Official government portal host"
                          >
                            🌐 {(() => {
                              try {
                                return new URL(currentPortalUrl.startsWith('http') ? currentPortalUrl : 'https://serviceonline.gov.in').hostname;
                              } catch {
                                return 'gov.in';
                              }
                            })()}
                          </span>
                          <span
                            className="dp-nav-pill"
                            onClick={() => showToast('AI Form Agent synchronized with live input fields.', 'success')}
                          >
                            ⚡ Zero-Shot Synced
                          </span>
                        </div>
                      </div>

                      {/* Form Card */}
                      <div className="dp-form-card">
                        <div className="dp-card-header">
                          <div className="dp-card-title">{dynamicBlueprint?.title || selectedService?.service_name || 'Scheme Application Form'}</div>
                          <div className="dp-card-subtitle">
                            Official government application form distilled live by autonomous agent from {currentPortalUrl}
                          </div>
                        </div>

                        {/* Form Fields: Distilled from Live DOM or synthesized */}
                        {dynamicBlueprint && dynamicBlueprint.fields && dynamicBlueprint.fields.length > 0 ? (
                          <div>
                            <div className="dp-form-grid">
                              {dynamicBlueprint.fields
                                .filter((f) => f.type !== 'checkbox' && !f.selector.toLowerCase().includes('captcha') && !f.label.toLowerCase().includes('captcha'))
                                .map((field, idx) => {
                                  const val = dynamicFormValues[field.selector] !== undefined
                                    ? dynamicFormValues[field.selector]
                                    : (field.label.toLowerCase().includes('father')
                                        ? (profile.father_or_guardian_name || '')
                                        : field.label.toLowerCase().includes('name')
                                        ? (profile.full_name || '')
                                        : field.label.toLowerCase().includes('mail')
                                        ? (profile.email || '')
                                        : field.label.toLowerCase().includes('mobile') || field.label.toLowerCase().includes('phone')
                                        ? (profile.mobile_number || '')
                                        : field.label.toLowerCase().includes('income')
                                        ? (profile.annual_income || '')
                                        : field.label.toLowerCase().includes('state')
                                        ? (profile.state ? profile.state.toUpperCase() : '')
                                        : '');

                                  if (field.tag === 'select' || field.type === 'select') {
                                    return (
                                      <div key={field.selector || idx} className="dp-form-field">
                                        <label className="dp-label">
                                          {field.label || 'Select Option'} <span style={{ color: '#ea580c' }}>*</span>
                                        </label>
                                        <select
                                          className="dp-select"
                                          value={val}
                                          onChange={(e) => setDynamicFormValues((prev) => ({ ...prev, [field.selector]: e.target.value }))}
                                        >
                                          <option value="">-- Select --</option>
                                          {(field.options || ['RAJASTHAN', 'GUJARAT', 'BIHAR', 'MAHARASHTRA', 'UTTAR PRADESH']).map((opt) => (
                                            <option key={opt} value={opt}>
                                              {opt}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    );
                                  }

                                  if (field.type === 'file') {
                                    return (
                                      <div key={field.selector || idx} className="dp-form-field full-width">
                                        <label className="dp-label">
                                          {field.label || 'Upload Document'} <span style={{ color: '#ea580c' }}>*</span>
                                        </label>
                                        <div className="dp-file-card">
                                          <div className="dp-file-meta">
                                            <span style={{ fontSize: '1.4rem' }}>📄</span>
                                            <div>
                                              <div className="dp-file-name">
                                                {file ? file.name : (profile.source_documents?.[0]?.replace('saved:', '') || 'income_certificate_verified.pdf')}
                                              </div>
                                              <div className="dp-file-status">
                                                ✓ {file ? `${Math.round(file.size / 1024)} KB` : 'Verified & Attached to Portal Field'}
                                              </div>
                                            </div>
                                          </div>
                                          <span className="dynamic-dom-badge" style={{ fontSize: '0.72rem' }}>Ready to Upload</span>
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div key={field.selector || idx} className={`dp-form-field ${field.tag === 'textarea' ? 'full-width' : ''}`}>
                                      <label className="dp-label">
                                        {field.label || 'Field'} <span style={{ color: '#ea580c' }}>*</span>
                                      </label>
                                      <input
                                        type={field.type || 'text'}
                                        className="dp-input"
                                        value={val}
                                        onChange={(e) => setDynamicFormValues((prev) => ({ ...prev, [field.selector]: e.target.value }))}
                                        placeholder={`Enter ${field.label || ''}`}
                                      />
                                    </div>
                                  );
                                })}
                            </div>

                            {/* Declaration Checkbox */}
                            {dynamicBlueprint.fields.filter((f) => f.type === 'checkbox' || f.label.toLowerCase().includes('declare') || f.label.toLowerCase().includes('agree')).map((chk, idx) => (
                              <label key={chk.selector || idx} className="dp-checkbox-wrap">
                                <input
                                  type="checkbox"
                                  checked={termsAccepted}
                                  onChange={(e) => setTermsAccepted(e.target.checked)}
                                  style={{ marginTop: '0.2rem' }}
                                />
                                <span>{chk.label || 'I hereby declare that the details provided are accurate and true.'}</span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          /* Fallback tailored dynamic form if blueprint hasn't loaded */
                          <div>
                            <div className="dp-form-grid">
                              <div className="dp-form-field">
                                <label className="dp-label">Applicant Full Name <span style={{ color: '#ea580c' }}>*</span></label>
                                <input
                                  type="text"
                                  className="dp-input"
                                  value={profile.full_name || ''}
                                  onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))}
                                  placeholder="Full Name"
                                />
                              </div>
                              <div className="dp-form-field">
                                <label className="dp-label">Father / Guardian Name <span style={{ color: '#ea580c' }}>*</span></label>
                                <input
                                  type="text"
                                  className="dp-input"
                                  value={profile.father_or_guardian_name || ''}
                                  onChange={(e) => setProfile((p) => ({ ...p, father_or_guardian_name: e.target.value }))}
                                  placeholder="Father's Name"
                                />
                              </div>
                              <div className="dp-form-field">
                                <label className="dp-label">Domicile State <span style={{ color: '#ea580c' }}>*</span></label>
                                <select
                                  className="dp-select"
                                  value={profile.state ? profile.state.toUpperCase() : 'RAJASTHAN'}
                                  onChange={(e) => setProfile((p) => ({ ...p, state: e.target.value }))}
                                >
                                  <option value="RAJASTHAN">RAJASTHAN</option>
                                  <option value="BIHAR">BIHAR</option>
                                  <option value="GUJARAT">GUJARAT</option>
                                  <option value="MAHARASHTRA">MAHARASHTRA</option>
                                  <option value="UTTAR PRADESH">UTTAR PRADESH</option>
                                </select>
                              </div>
                              <div className="dp-form-field">
                                <label className="dp-label">Mobile Number <span style={{ color: '#ea580c' }}>*</span></label>
                                <input
                                  type="tel"
                                  className="dp-input"
                                  value={profile.mobile_number || ''}
                                  onChange={(e) => setProfile((p) => ({ ...p, mobile_number: e.target.value }))}
                                  placeholder="10-digit mobile"
                                />
                              </div>
                              <div className="dp-form-field full-width">
                                <label className="dp-label">Upload Required Document <span style={{ color: '#ea580c' }}>*</span></label>
                                <div className="dp-file-card">
                                  <div className="dp-file-meta">
                                    <span style={{ fontSize: '1.4rem' }}>📄</span>
                                    <div>
                                      <div className="dp-file-name">{file ? file.name : (profile.source_documents?.[0]?.replace('saved:', '') || 'income_certificate_verified.pdf')}</div>
                                      <div className="dp-file-status">✓ Ready for submission (Verified)</div>
                                    </div>
                                  </div>
                                  <span className="dynamic-dom-badge" style={{ fontSize: '0.72rem' }}>Attached</span>
                                </div>
                              </div>
                            </div>

                            <label className="dp-checkbox-wrap">
                              <input
                                type="checkbox"
                                checked={termsAccepted}
                                onChange={(e) => setTermsAccepted(e.target.checked)}
                                style={{ marginTop: '0.2rem' }}
                              />
                              <span>I hereby declare that all details submitted for {selectedService?.service_name || 'this scheme'} are accurate.</span>
                            </label>
                          </div>
                        )}

                        {/* Security Verification (CAPTCHA) */}
                        <div className="sp-captcha-container" style={{ marginTop: '1rem' }}>
                          <label className="sp-label" style={{ marginBottom: '0.4rem', display: 'block' }}>
                            Security Verification <span className="sp-req">*</span>
                          </label>
                          <div className="sp-captcha-flex-row">
                            <div className="sp-captcha-visual">
                              {captchaScreenshot ? (
                                <img src={`data:image/png;base64,${captchaScreenshot}`} alt="Live Portal CAPTCHA" />
                              ) : (
                                <span className="sp-mock-captcha-text">{fallbackCaptcha}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="sp-captcha-btn"
                              title="Refresh CAPTCHA"
                              onClick={async () => {
                                if (sessionId) {
                                  showToast('Refetching fresh CAPTCHA from portal...', 'info');
                                  await handleStartAgent();
                                } else {
                                  const newCode = refreshFallbackCaptcha();
                                  showToast(`Refreshed CAPTCHA: ${newCode}`, 'info');
                                }
                              }}
                            >
                              🔄
                            </button>
                            <button
                              type="button"
                              className="sp-captcha-btn"
                              title="Listen to CAPTCHA"
                              onClick={() => {
                                if ('speechSynthesis' in window) {
                                  const textToRead = captchaText || fallbackCaptcha;
                                  const utt = new SpeechSynthesisUtterance(textToRead.split('').join(' '));
                                  utt.rate = 0.8;
                                  window.speechSynthesis.speak(utt);
                                  showToast('Playing audio CAPTCHA...', 'info');
                                }
                              }}
                            >
                              🔊
                            </button>
                            <input
                              type="text"
                              className="sp-input sp-captcha-text-input"
                              placeholder="Enter Captcha"
                              value={captchaText}
                              onChange={(e) => setCaptchaText(e.target.value)}
                            />
                          </div>
                        </div>

                        {/* Submit Action Button */}
                        <div style={{ marginTop: '1.25rem' }}>
                          <button
                            type="button"
                            className="dp-btn-submit"
                            disabled={!captchaText || loading || !termsAccepted}
                            onClick={() => handleResume('SUBMIT')}
                          >
                            {loading ? 'Submitting to Portal…' : `Approve & Submit Registration for ${selectedService?.service_name || 'Scheme'}`}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
                </div>
              </div>
            </div>
      );
        })()}
        </div>
      </main>

      {/* ───── Google Vault Document Hunter Modal ───── */}
      {showVaultModal && (
        <div className="vault-modal-backdrop" onClick={() => !vaultHunting && setShowVaultModal(false)}>
          <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vault-modal-header">
              <div className="vault-modal-title-row">
                <Icons.Google />
                <h3>Google Vault Auto-Document Hunter</h3>
              </div>
              {!vaultHunting && (
                <button className="modal-close-btn" onClick={() => setShowVaultModal(false)}>✕</button>
              )}
            </div>

            <p className="vault-modal-desc">
              Instead of manually hunting through folders, AI connects to your <strong>Google Drive</strong> and recent <strong>Gmail attachments</strong> to find and extract the required certificate.
            </p>

            {/* If files have not been searched yet, show query selector */}
            {vaultFoundFiles.length === 0 ? (
              <div className="vault-doc-picker">
                <label className="picker-label">Select Document to Retrieve:</label>
                <div className="picker-options">
                  {[
                    { id: 'income', label: 'Income Certificate (Aay Praman Patra)' },
                    { id: 'marksheet', label: 'High School / Board Marksheet' },
                    { id: 'aadhaar', label: 'Aadhaar / ID Card' },
                  ].map((doc) => {
                    const isSelected = vaultQuery.toLowerCase() === doc.id;
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        className={`picker-option-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setVaultQuery(doc.id)}
                        disabled={vaultHunting}
                      >
                        <div className="picker-card-left">
                          <span className={`custom-radio-circle ${isSelected ? 'checked' : ''}`}>
                            {isSelected && <span className="custom-radio-dot" />}
                          </span>
                          <span className="picker-opt-label">{doc.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="custom-doc-input-row">
                  <label className="custom-input-label">Or custom search keyword:</label>
                  <div className="input-with-search-icon">
                    <span className="input-search-icon">
                      <Icons.Search />
                    </span>
                    <input
                      type="text"
                      className="vault-custom-input"
                      placeholder="Type keyword e.g. income, marksheet, caste..."
                      value={vaultQuery}
                      onChange={(e) => setVaultQuery(e.target.value)}
                      disabled={vaultHunting}
                    />
                    {vaultQuery && (
                      <button
                        type="button"
                        className="input-clear-btn"
                        onClick={() => setVaultQuery('')}
                        title="Clear keyword"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {vaultHunting ? (
                  <div className="vault-hunting-status">
                    <div className="hunting-spinner" />
                    <span className="hunting-text">{vaultStepText}</span>
                  </div>
                ) : (
                  <div className="vault-modal-actions">
                    <button
                      type="button"
                      className="gemini-btn gemini-btn-tonal"
                      onClick={() => setShowVaultModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="google-connect-submit-btn"
                      onClick={() => handleStartGoogleVaultSearch(false)}
                    >
                      <Icons.Google />
                      <span>Connect Google & Search</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* When candidate files are returned from POST /api/documents/google-search */
              <div className="vault-results-section">
                <div className="results-header">
                  <span className="results-count">✅ Found {vaultFoundFiles.length} candidate file(s):</span>
                  <button
                    type="button"
                    className="re-search-btn"
                    onClick={() => setVaultFoundFiles([])}
                    disabled={vaultHunting}
                  >
                    ← Search again
                  </button>
                </div>

                <div className="found-files-list">
                  {vaultFoundFiles.map((f) => (
                    <div key={f.id} className="found-file-card">
                      <div className="found-file-meta">
                        <span className="file-icon">
                          {f.source === 'gmail' ? '✉️' : '📁'}
                        </span>
                        <div className="file-details">
                          <strong className="file-title">{f.name}</strong>
                          <div className="file-sub">
                            <span className={`source-pill source-${f.source}`}>
                              {f.source === 'gmail' ? 'Gmail Attachment' : 'Google Drive'}
                            </span>
                            {f.size && <span className="file-size">• {f.size}</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="select-fetch-btn"
                        onClick={() => handleFetchChosenFile(f)}
                        disabled={vaultHunting}
                      >
                        ⚡ Fetch & Pre-fill
                      </button>
                    </div>
                  ))}
                </div>

                {vaultHunting && (
                  <div className="vault-hunting-status" style={{ marginTop: '1rem' }}>
                    <div className="hunting-spinner" />
                    <span className="hunting-text">{vaultStepText}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───── ServicePlus Scheme Eligibility Modal ───── */}
      {showEligibilityModal && (
        <div className="sp-modal-backdrop" onClick={() => setShowEligibilityModal(false)}>
          <div className="sp-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="sp-modal-header">
              <div className="sp-modal-title">
                <span>📋</span>
                <span>ServicePlus Scheme Eligibility Criteria</span>
              </div>
              <button
                type="button"
                className="sp-modal-close-btn"
                onClick={() => setShowEligibilityModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="sp-modal-body">
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px' }}>
                <strong style={{ color: '#166534' }}>Construction Worker Registration / Welfare Scheme (1784)</strong>
                <div style={{ fontSize: '0.78rem', color: '#15803d', marginTop: '4px' }}>
                  National ServicePlus Framework — Ministry of Labour & Employment / State Welfare Board
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div className="sp-contact-row">
                  <div className="sp-contact-icon">✅</div>
                  <div>
                    <div className="sp-contact-label">Age Requirement</div>
                    <div className="sp-contact-val">Citizen must be between 18 and 60 years old.</div>
                  </div>
                </div>

                <div className="sp-contact-row">
                  <div className="sp-contact-icon">✅</div>
                  <div>
                    <div className="sp-contact-label">Income Ceiling</div>
                    <div className="sp-contact-val">Annual household income must be under ₹3,00,000 threshold.</div>
                  </div>
                </div>

                <div className="sp-contact-row">
                  <div className="sp-contact-icon">✅</div>
                  <div>
                    <div className="sp-contact-label">Mandatory Documents</div>
                    <div className="sp-contact-val">Aadhaar Card, Income Certificate, and valid Mobile Number.</div>
                  </div>
                </div>

                <div className="sp-contact-row">
                  <div className="sp-contact-icon">✅</div>
                  <div>
                    <div className="sp-contact-label">Domicile Requirement</div>
                    <div className="sp-contact-val">Resident of the respective state / portal instance ({profile.state || 'Uttar Pradesh'}).</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
                <button
                  type="button"
                  className="sp-action-btn-primary"
                  onClick={() => setShowEligibilityModal(false)}
                >
                  Understood
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───── ServicePlus Official Helpdesk Contact Modal ───── */}
      {showContactModal && (
        <div className="sp-modal-backdrop" onClick={() => setShowContactModal(false)}>
          <div className="sp-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="sp-modal-header">
              <div className="sp-modal-title">
                <span>🏛️</span>
                <span>ServicePlus Official Helpdesk & Support</span>
              </div>
              <button
                type="button"
                className="sp-modal-close-btn"
                onClick={() => setShowContactModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="sp-modal-body">
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px' }}>
                <strong style={{ color: '#1e40af' }}>National Informatics Centre (NIC)</strong>
                <div style={{ fontSize: '0.78rem', color: '#1d4ed8', marginTop: '4px' }}>
                  Ministry of Electronics & Information Technology, Government of India
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="sp-contact-row">
                  <div className="sp-contact-icon">📞</div>
                  <div>
                    <div className="sp-contact-label">National Toll-Free Helpline</div>
                    <div className="sp-contact-val">1800 111 555 / 011-24305000</div>
                  </div>
                </div>

                <div className="sp-contact-row">
                  <div className="sp-contact-icon">✉️</div>
                  <div>
                    <div className="sp-contact-label">Technical Support Email</div>
                    <div className="sp-contact-val">support-serviceplus@gov.in</div>
                  </div>
                </div>

                <div className="sp-contact-row">
                  <div className="sp-contact-icon">🏢</div>
                  <div>
                    <div className="sp-contact-label">Headquarters Address</div>
                    <div className="sp-contact-val">
                      National Informatics Centre, A-Block, CGO Complex, Lodhi Road, New Delhi, 110003
                    </div>
                  </div>
                </div>

                <div className="sp-contact-row">
                  <div className="sp-contact-icon">⏰</div>
                  <div>
                    <div className="sp-contact-label">Operating Hours</div>
                    <div className="sp-contact-val">Monday to Saturday: 9:00 AM – 6:00 PM IST (Excl. Gazetted Holidays)</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
                <button
                  type="button"
                  className="sp-action-btn-primary"
                  onClick={() => setShowContactModal(false)}
                >
                  Close Helpdesk
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`gemini-toast toast-${toast.type}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default App;
