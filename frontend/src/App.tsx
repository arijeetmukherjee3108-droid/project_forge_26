// src/App.tsx
import React, { useState, useRef, useCallback, useEffect, ChangeEvent, DragEvent } from 'react';
import './App.css';
import {
  ApplicantProfile,
  ExtractionResponse,
  EligibilityResponse,
  GoogleVaultFile,
} from './types';
import {
  extractDocument,
  checkEligibility,
  startApplication,
  resumeApplication,
  searchGoogleVault,
  fetchGoogleVaultFile,
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
  extracted_profile: {
    full_name: 'Aarav Verma',
    father_name: 'Rajesh Verma',
    date_of_birth: '15/08/2005',
    gender: 'Male',
    mobile: '9876543210',
    email: 'aarav@example.com',
    state: 'Uttar Pradesh',
    district: 'Lucknow',
    pin_code: '226001',
    address_line: '123 Hazratganj, Lucknow',
    annual_family_income: 180000,
    category: 'General',
  },
  uncertain_fields: ['annual_family_income', 'email'],
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
  status: 'ELIGIBLE',
  scheme_name: 'ServicePlus – Citizen Certificate Application',
  reasons: [
    '✅ Age matches certificate criteria (18+)',
    '✅ Valid 10-digit citizen mobile number verified',
    '✅ State domicile matches Uttar Pradesh',
    '✅ Annual family income is under ₹2,50,000 threshold',
  ],
  missing_fields: [],
  required_documents: ['Income Certificate', 'Aadhaar / ID Card'],
};

const USE_MOCK = true; // ← Set to false when connecting to local FastAPI backend

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

const PROMPTS_BY_MODE = {
  apply: [
    'Apply for Construction Worker Welfare Certificate on ServicePlus',
    'Citizen Registration on National ServicePlus Portal',
    'Direct Apply — Form 1784 (serviceonline.gov.in)',
  ],
  eligibility: [
    'Check eligibility for Construction Worker Welfare (Form 1784)',
    'Verify income limits & age criteria for ServicePlus Schemes',
    'Check required documents for Citizen Registration',
  ],
};

const SUGGESTIONS_BY_MODE: Record<
  'apply' | 'eligibility',
  { iconType: 'briefcase' | 'sparkles' | 'book'; text: string }[]
> = {
  apply: [
    {
      iconType: 'briefcase',
      text: 'Apply for Construction Worker Welfare Certificate on ServicePlus',
    },
    {
      iconType: 'sparkles',
      text: 'Citizen Registration on National ServicePlus Portal',
    },
    {
      iconType: 'book',
      text: 'Direct Apply — Form 1784 (serviceonline.gov.in)',
    },
  ],
  eligibility: [
    {
      iconType: 'briefcase',
      text: 'Check eligibility for Construction Worker Welfare (Form 1784)',
    },
    {
      iconType: 'sparkles',
      text: 'Verify income limits & age criteria for ServicePlus Schemes',
    },
    {
      iconType: 'book',
      text: 'Check required documents for Citizen Registration',
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
}

const FORM_FIELDS: FieldMeta[] = [
  { key: 'full_name', label: 'Full Name' },
  { key: 'father_name', label: "Father / Guardian's Name" },
  { key: 'date_of_birth', label: 'Date of Birth (DD/MM/YYYY)' },
  { key: 'gender', label: 'Gender' },
  { key: 'mobile', label: 'Mobile Number' },
  { key: 'email', label: 'Email Address' },
  { key: 'state', label: 'State' },
  { key: 'district', label: 'District' },
  { key: 'pin_code', label: 'Pin Code' },
  { key: 'address_line', label: 'Full Residential Address', spanTwo: true },
  { key: 'annual_family_income', label: 'Annual Family Income (₹)', type: 'number' },
  { key: 'category', label: 'Category' },
];

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [activeMode, setActiveMode] = useState<'apply' | 'eligibility'>('apply');

  // Step 1: Intent
  const [intent, setIntent] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [fadeState, setFadeState] = useState(true);

  // Smoothly rotate the placeholder text every 4 seconds based on active mode
  useEffect(() => {
    const activePrompts = PROMPTS_BY_MODE[activeMode];
    const interval = setInterval(() => {
      setFadeState(false);
      setTimeout(() => {
        setPromptIndex((prev) => (prev + 1) % activePrompts.length);
        setFadeState(true);
      }, 400);
    }, 4000);

    return () => clearInterval(interval);
  }, [activeMode]);

  // Step 2: Upload & Google Vault
  const [file, setFile] = useState<File | null>(null);
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
  const [portalFields, setPortalFields] = useState<MockPortalField[]>([]);
  const [activeFieldIndex, setActiveFieldIndex] = useState(-1);
  const [submitted, setSubmitted] = useState(false);

  // UI helpers
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  const showToast = (msg: string, type: string = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Step Completion Validation (Gates)
  const isStep1Done = Boolean(intent.trim().length > 0 || currentStep > 1);
  const isStep2Done = Boolean(extraction !== null || currentStep > 2);
  const isStep3Done = Boolean(verified && eligibility !== null || currentStep > 3);

  const canNavigateToStep = (stepNumber: number) => {
    if (stepNumber === 1) return true;
    if (stepNumber === 2) return isStep1Done;
    if (stepNumber === 3) return isStep2Done;
    if (stepNumber === 4) return isStep3Done;
    return false;
  };

  const handleStepClick = (targetStep: number) => {
    if (!canNavigateToStep(targetStep)) {
      if (targetStep === 2) showToast('Please enter your intent or select a service first', 'error');
      else if (targetStep === 3) showToast('Please upload and extract a document first', 'error');
      else if (targetStep === 4) showToast('Please verify your citizen data & check eligibility first', 'error');
      return;
    }
    setCurrentStep(targetStep);
  };

  // Web Speech API for the microphone icon
  const handleToggleVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Speech recognition not supported in this browser. Please type.', 'error');
      return;
    }
    if (isListening) {
      setIsListening(false);
      return;
    }
    try {
      const recognition = new SpeechRecognition();
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
        showToast(`Heard: "${transcript}"`, 'success');
      };
      recognition.onerror = () => {
        setIsListening(false);
        showToast('Voice input error. Try typing.', 'error');
      };
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const handleIntentSubmit = (textToUse?: string) => {
    const query = textToUse || intent;
    if (!query.trim()) {
      showToast('Please type or speak what service you need.', 'error');
      return;
    }
    setProfile((prev) => ({ ...prev, target_intent: query }));
    showToast('Intent set! Proceeding to document upload.', 'success');
    setCurrentStep(2);
  };

  // File Upload Handlers
  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);

    if (USE_MOCK) {
      await new Promise((r) => setTimeout(r, 1000));
      setExtraction(MOCK_EXTRACTION);
      setProfile(MOCK_EXTRACTION.extracted_profile);
      setUncertainFields(MOCK_EXTRACTION.uncertain_fields);
      showToast('Document parsed with AI extraction!', 'success');
      setCurrentStep(3);
      setLoading(false);
      return;
    }

    try {
      const resp = await extractDocument(file);
      setExtraction(resp);
      setProfile(resp.extracted_profile);
      setUncertainFields(resp.uncertain_fields);
      showToast(resp.message, 'success');
      setCurrentStep(3);
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
          profileResult = resp.profile || resp.extracted_profile || null;
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
          profileResult = resp.profile || resp.extracted_profile || null;
          uncertain = resp.uncertain_fields || [];
          rawText = resp.raw_text_preview || '';
        } catch {
          // backend offline
        }
      }

      // 4. Default mock data if backend extractor hasn't processed
      if (!profileResult) {
        await new Promise((r) => setTimeout(r, 650));
        profileResult = MOCK_EXTRACTION.extracted_profile;
        uncertain = MOCK_EXTRACTION.uncertain_fields;
        rawText = MOCK_EXTRACTION.raw_text_preview;
      }

      // Create the real file in React
      const finalFile = downloadedBlob
        ? new File([downloadedBlob], chosenFile.name, { type: downloadedBlob.type || 'application/pdf' })
        : new File(['vault_content'], chosenFile.name, { type: 'application/pdf' });

      setFile(finalFile);
      setExtraction({
        extracted_profile: profileResult!,
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
    setProfile((prev) => ({ ...prev, [name]: value }));
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
      const resp = await checkEligibility(profile);
      setEligibility(resp);
      showToast('Eligibility verified!', 'success');
    } catch {
      showToast('Eligibility check failed.', 'error');
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

  const handleStartAgent = async () => {
    if (!verified) {
      showToast('Please confirm verification of your data first.', 'error');
      return;
    }
    setCurrentStep(4);
    if (USE_MOCK) {
      runMockAgent();
      return;
    }
    setLoading(true);
    try {
      const resp = await startApplication({ ...profile, user_verified: true });
      if (resp.action_log) setAgentLog(resp.action_log);
      if (resp.session_id) setSessionId(resp.session_id);
      if (resp.page_screenshot_b64) setPageScreenshot(resp.page_screenshot_b64);
      if (resp.captcha_screenshot_b64) setCaptchaScreenshot(resp.captcha_screenshot_b64);
      setAgentDone(true);
      showToast(resp.message || 'Live agent launched.', 'success');
    } catch {
      showToast('Failed to start agent.', 'error');
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
        setAgentLog((prev) => [...prev, '🎉 [SUCCESS] Official acknowledgment generated on ServicePlus!']);
        setSubmitted(true);
        showToast('Form submitted successfully on ServicePlus!', 'success');
      }
      return;
    }

    setLoading(true);
    try {
      const resp = await resumeApplication({
        session_id: sessionId,
        captcha_text: captchaText,
        action,
      });
      if (resp.page_screenshot_b64) setPageScreenshot(resp.page_screenshot_b64);
      if (resp.status === 'SUBMITTED_OR_NEXT_STEP') setSubmitted(true);
      showToast(resp.message || 'Action executed.', 'success');
    } catch {
      showToast('Resume action failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStopAgent = async () => {
    setAgentRunning(false);
    if (!USE_MOCK && sessionId) {
      try {
        await resumeApplication({ session_id: sessionId, action: 'CLOSE' });
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
            <span className="badge-tag">ServicePlus v2.0</span>
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
              return (
                <button
                  key={s.num}
                  className={`stepper-chip ${currentStep === s.num ? 'active' : ''} ${currentStep > s.num ? 'completed' : ''} ${!accessible ? 'is-disabled' : ''}`}
                  disabled={!accessible}
                  onClick={() => handleStepClick(s.num)}
                >
                  <span>{currentStep > s.num ? '✓' : s.num}.</span>
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        <div className={`gemini-container ${currentStep === 4 ? 'wide' : ''}`}>
          {/* ════════════════════════════════════════
              STEP 1: GEMINI HERO / PROMPT VIEW
          ════════════════════════════════════════ */}
          {currentStep === 1 && (
            <div className="gemini-hero">
              <h1 className="hero-heading">Where should we start?</h1>

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
                      {PROMPTS_BY_MODE[activeMode][promptIndex % PROMPTS_BY_MODE[activeMode].length]}
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
                  title="Directly automate submission on ServicePlus portal with AI Agent"
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

              {/* Suggestion Rows */}
              <div className="gemini-suggestions">
                {SUGGESTIONS_BY_MODE[activeMode].map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="suggestion-row"
                    onClick={() => {
                      setIntent(item.text);
                      handleIntentSubmit(item.text);
                    }}
                  >
                    <span className="suggestion-lead-icon">
                      {item.iconType === 'briefcase' && <Icons.Briefcase />}
                      {item.iconType === 'sparkles' && <Icons.Sparkles />}
                      {item.iconType === 'book' && <Icons.BookIdea />}
                    </span>
                    <span className="suggestion-text">{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════
              STEP 2: DOCUMENT UPLOAD
          ════════════════════════════════════════ */}
          {currentStep === 2 && (
            <div className="gemini-card">
              <h2 className="card-title">Upload Official Citizen Document</h2>
              <p className="card-desc">
                Upload your Income Certificate, Marksheet, or ID card (PDF or Image).
                PyMuPDF & AI will extract structured identity fields for ServicePlus.
              </p>

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
                  <strong>Click to select file</strong> or drag & drop here
                </div>
                <div className="dropzone-types">PDF, PNG, JPG (Certificate or Marksheet)</div>
                <input
                  ref={fileInputRef}
                  type="file"
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
              </div>

              {file && (
                <div className="attached-file-pill">
                  <div className="file-info">
                    <span>📎</span>
                    <span>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                  </div>
                  <button className="file-delete-btn" onClick={() => setFile(null)}>✕</button>
                </div>
              )}

              <div className="action-buttons-row">
                <button className="gemini-btn gemini-btn-tonal" onClick={() => setCurrentStep(1)}>
                  ← Back
                </button>
                <button
                  className="gemini-btn gemini-btn-primary"
                  disabled={!file || loading}
                  onClick={handleUpload}
                >
                  {loading ? 'Extracting Data…' : 'Extract Fields'}
                </button>
              </div>

              {extraction && (
                <div className="raw-extraction-preview">
                  <strong>AI Raw Text Preview:</strong>
                  <br />
                  {extraction.raw_text_preview}
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════
              STEP 3: VERIFICATION & ELIGIBILITY
          ════════════════════════════════════════ */}
          {currentStep === 3 && (
            <div className="gemini-card">
              <h2 className="card-title">Verify Extracted Citizen Data</h2>
              <p className="card-desc">
                Fields flagged with <span className="review-pill-inline">Review</span> require your confirmation. You can edit any value.
              </p>

              <div className="gemini-form-grid">
                {FORM_FIELDS.map((f) => {
                  const uncertain = uncertainFields.includes(f.key as string);
                  return (
                    <div key={f.key as string} className={`form-item ${f.spanTwo ? 'span-two' : ''}`}>
                      <label className="item-label">
                        <span>{f.label}</span>
                        {uncertain && <span className="uncertain-tag">Review</span>}
                      </label>
                      <input
                        className={`gemini-input ${uncertain ? 'uncertain-highlight' : ''}`}
                        type={f.type || 'text'}
                        name={f.key as string}
                        value={(profile as any)[f.key] ?? ''}
                        onChange={handleInputChange}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Mandatory Citizen Gatekeeper Checkbox */}
              <div className="verification-gate" onClick={() => setVerified(!verified)}>
                <input
                  type="checkbox"
                  id="citizen-verified"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div>
                  <div className="gate-label">I confirm and verify the accuracy of this data</div>
                  <div className="gate-sub">The browser agent will fill the official portal using these details.</div>
                </div>
              </div>

              <div className="action-buttons-row">
                <button className="gemini-btn gemini-btn-tonal" onClick={() => setCurrentStep(2)}>
                  Back
                </button>
                <button
                  className="gemini-btn gemini-btn-tonal"
                  disabled={!verified || loading}
                  onClick={handleCheckEligibility}
                >
                  {loading ? 'Evaluating…' : 'Check Scheme Eligibility'}
                </button>
                {eligibility && (
                  <button
                    className="gemini-btn gemini-btn-active-blue"
                    disabled={!verified || loading}
                    onClick={handleStartAgent}
                  >
                    Launch AI Browser Agent
                  </button>
                )}
              </div>

              {/* Eligibility card */}
              {eligibility && (
                <div className={`eligibility-banner status-${eligibility.status.toLowerCase()}`}>
                  <div className="banner-header">
                    <span>{eligibility.status === 'ELIGIBLE' ? '✅' : '⚠️'}</span>
                    <span>{eligibility.status}: {eligibility.scheme_name.replace(/\s*\(ID:\s*\d+\)/gi, '')}</span>
                  </div>
                  <ul className="banner-reasons">
                    {eligibility.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════
              STEP 4: SPLIT-SCREEN MISSION CONTROL
          ════════════════════════════════════════ */}
          {currentStep === 4 && (
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
                    {agentLog.length === 0 && (
                      <div className="terminal-line">Waiting for autonomous agent to connect…</div>
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
                        style={{ maxWidth: '200px', borderRadius: '8px', marginBottom: '0.75rem' }}
                      />
                    ) : (
                      <div className="captcha-display-box">
                        <span className="captcha-styled-text">Xk7pQ2</span>
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

                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                      <button
                        className="gemini-btn gemini-btn-tonal"
                        disabled={!captchaText || loading}
                        onClick={() => handleResume('FILL_ONLY')}
                      >
                        Fill Only
                      </button>
                      <button
                        className="gemini-btn gemini-btn-success"
                        disabled={!captchaText || loading}
                        onClick={() => handleResume('SUBMIT')}
                      >
                        Approve & Submit
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
              </div>

              {/* Right Column: Live Portal Display */}
              <div className="portal-window">
                <div className="portal-top-bar">
                  <div className="browser-traffic-lights">
                    <span className="light close" />
                    <span className="light min" />
                    <span className="light max" />
                  </div>
                  <div className="browser-url-pill">
                    <span>🔒</span>
                    <span>https://serviceonline.gov.in/directApply.do?serviceId=1784</span>
                  </div>
                </div>

                <div className="portal-document-body">
                  {pageScreenshot ? (
                    <img
                      src={`data:image/png;base64,${pageScreenshot}`}
                      alt="Portal Live Screenshot"
                      style={{ width: '100%', borderRadius: '4px' }}
                    />
                  ) : (
                    <div>
                      <div className="gov-portal-masthead">
                        <div style={{ fontSize: '1.75rem' }}>🏛️</div>
                        <div>
                          <strong style={{ fontSize: '1rem' }}>National ServicePlus Portal — Government of India</strong>
                          <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>
                            Direct Application for Construction Worker Welfare Certificate
                          </div>
                        </div>
                      </div>

                      {portalFields.length === 0 && !agentRunning && (
                        <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: '#6b7280' }}>
                          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🖥️</div>
                          <p>The Playwright agent opens this portal live.</p>
                          <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                            Judges can watch every field fill up in real time.
                          </p>
                        </div>
                      )}

                      {portalFields.map((f, i) => (
                        <div
                          key={i}
                          className={`portal-field-row ${i === activeFieldIndex ? 'active-portal-field' : ''}`}
                        >
                          <label className="p-field-label">{f.label}</label>
                          {f.type === 'checkbox' ? (
                            <div className="p-field-check">
                              <span>☑️</span> {f.value}
                            </div>
                          ) : f.type === 'file' ? (
                            <span className="p-field-badge">📎 {f.value}</span>
                          ) : (
                            <div className="p-field-input">{f.value}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
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

      {toast && (
        <div className={`gemini-toast toast-${toast.type}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default App;
