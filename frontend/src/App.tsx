// src/App.tsx
import React, { useState, useRef, useCallback, useEffect, ChangeEvent, DragEvent } from 'react';
import './App.css';
import {
  ApplicantProfile,
  ExtractionResponse,
  EligibilityResponse,
} from './types';
import {
  extractDocument,
  checkEligibility,
  startApplication,
  resumeApplication,
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
  scheme_name: 'ServicePlus – Citizen Certificate Application (ID: 1784)',
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

const ROTATING_PROMPTS = [
  'Apply for Construction Worker Welfare Certificate on ServicePlus',
  'Citizen Registration on National ServicePlus Portal',
  'Direct Apply — Form 1784 (serviceonline.gov.in)',
];

const SUGGESTIONS = [
  { icon: '💼', text: 'Apply for Construction Worker Welfare Certificate on ServicePlus' },
  { icon: '🏛️', text: 'Citizen Registration on National ServicePlus Portal' },
  { icon: '📄', text: 'Direct Apply — Form 1784 (serviceonline.gov.in)' },
];

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
  const [activeMode, setActiveMode] = useState<'task' | 'chat'>('chat');

  // Step 1: Intent
  const [intent, setIntent] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [fadeState, setFadeState] = useState(true);

  // Smoothly rotate the placeholder text every 4 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setFadeState(false);
      setTimeout(() => {
        setPromptIndex((prev) => (prev + 1) % ROTATING_PROMPTS.length);
        setFadeState(true);
      }, 400);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  // Step 2: Upload
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extraction, setExtraction] = useState<ExtractionResponse | null>(null);

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
                      {ROTATING_PROMPTS[promptIndex]}
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

              {/* Mode Pills (Chat / Task) */}
              <div className="gemini-mode-pills">
                <button
                  className={`mode-pill ${activeMode === 'chat' ? 'active' : ''}`}
                  onClick={() => setActiveMode('chat')}
                >
                  Chat
                </button>
                <button
                  className={`mode-pill ${activeMode === 'task' ? 'active' : ''}`}
                  onClick={() => setActiveMode('task')}
                >
                  Task
                </button>
              </div>

              {/* Suggestion Rows */}
              <div className="gemini-suggestions">
                {SUGGESTIONS.map((item, idx) => (
                  <div
                    key={idx}
                    className="suggestion-row"
                    onClick={() => {
                      setIntent(item.text);
                      handleIntentSubmit(item.text);
                    }}
                  >
                    <span className="suggestion-lead-icon">{item.icon}</span>
                    <span>{item.text}</span>
                  </div>
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
                  {loading ? 'Extracting Data…' : '⚡ Extract Fields'}
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
                Fields flagged in <span style={{ color: 'var(--gemini-warning-yellow)', fontWeight: 600 }}>yellow</span> require your manual review. You can edit any value.
              </p>

              <div className="gemini-form-grid">
                {FORM_FIELDS.map((f) => {
                  const uncertain = uncertainFields.includes(f.key as string);
                  return (
                    <div key={f.key as string} className={`form-item ${f.spanTwo ? 'span-two' : ''}`}>
                      <label className="item-label">
                        <span>{f.label}</span>
                        {uncertain && <span className="uncertain-tag">⚠ Check</span>}
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
                />
                <div>
                  <div className="gate-label">I confirm and verify the accuracy of this citizen data</div>
                  <div className="gate-sub">The autonomous browser agent will fill the official portal using these details.</div>
                </div>
              </div>

              <div className="action-buttons-row">
                <button className="gemini-btn gemini-btn-tonal" onClick={() => setCurrentStep(2)}>
                  ← Back
                </button>
                <button
                  className="gemini-btn gemini-btn-tonal"
                  disabled={!verified || loading}
                  onClick={handleCheckEligibility}
                >
                  {loading ? 'Evaluating…' : '📊 Check Scheme Eligibility'}
                </button>
                {eligibility && (
                  <button
                    className="gemini-btn gemini-btn-success"
                    disabled={!verified || loading}
                    onClick={handleStartAgent}
                  >
                    🚀 Launch AI Browser Agent
                  </button>
                )}
              </div>

              {/* Eligibility card */}
              {eligibility && (
                <div className={`eligibility-banner status-${eligibility.status.toLowerCase()}`}>
                  <div className="banner-header">
                    <span>{eligibility.status === 'ELIGIBLE' ? '✅' : '⚠️'}</span>
                    <span>{eligibility.status}: {eligibility.scheme_name}</span>
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
                  <button className="gemini-btn gemini-btn-danger">
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

      {toast && (
        <div className={`gemini-toast toast-${toast.type}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default App;
