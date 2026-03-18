/**
 * Shared type definitions for the Offlyn Apply extension
 */

export interface JobMeta {
  jobTitle: string | null;
  company: string | null;
  url: string;
  atsHint: string | null;
}

export interface FieldSchema {
  tagName: string;
  type: string | null;
  name: string | null;
  id: string | null;
  autocomplete: string | null;
  required: boolean;
  disabled: boolean;
  multiple: boolean;
  label: string | null;
  selector: string;
  valuePreview: string | null;
  radioOptions?: Array<{ selector: string; label: string; value: string }>;
  /** 1 = verified ATS/application form, 2 = probable first-party form, 3 = untrusted (cookie/chat/marketing) */
  trustTier?: 1 | 2 | 3;
  /** Where the field was detected from, e.g. "greenhouse.io iframe", "parent_page", "onetrust_banner" */
  detectedFrom?: string;
  /** Type of container the field lives in, e.g. "ats_iframe", "onetrust", "chat_widget", "marketing" */
  containerType?: string;
  /** Whether this field is eligible to be autofilled */
  fillEligible?: boolean;
  /** Whether patterns from this field should be learned into graph memory */
  learnEligible?: boolean;
  /** Human-readable reason why this field was excluded from fill/learn, if applicable */
  exclusionReason?: string;
}

/** Page classification states used to gate scanning, filling, and learning */
export type PageState = 'NOT_JOB_PAGE' | 'JOB_POSTING_PAGE' | 'JOB_APPLICATION_PAGE' | 'FORM_HELPER_PAGE';

export interface PageClassification {
  state: PageState;
  reason: string;
  /** True if a trusted ATS iframe (Greenhouse, Lever, Workday, etc.) was detected in the DOM */
  hasTrustedATSIframe: boolean;
  /** True when parent page field scanning is suppressed because a trusted ATS iframe handles the form */
  parentFillSuppressed: boolean;
  /** True when at least one real application form or ATS iframe with fields has been verified */
  applicationFieldsVerified: boolean;
  /** Detailed trace of which signals fired during detection */
  detectionReason: string;
}

export type ApplyEventType = 'PAGE_DETECTED' | 'SUBMIT_ATTEMPT';

export interface ApplyEvent {
  kind: 'JOB_APPLY_EVENT';
  eventType: ApplyEventType;
  jobMeta: JobMeta;
  schema: FieldSchema[];
  timestamp: number;
}

export interface FillMapping {
  selector: string;
  value: string | boolean | number;
}

export interface FillPlan {
  kind: 'FILL_PLAN';
  requestId: string;
  mappings: FillMapping[];
  dryRun: boolean;
}

export interface FillResult {
  kind: 'FILL_RESULT';
  requestId: string;
  filledCount: number;
  failedSelectors: string[];
  timestamp: number;
}

export interface ExtensionSettings {
  enabled: boolean;
  dryRun: boolean;
  whatsappTarget?: string; // Phone number in E.164 format (e.g., +15555550123)
}

export interface NativeMessageEnvelope {
  kind: 'EXT_EVENT' | 'FILL_PLAN' | 'ACK' | 'ERROR' | 'PARSE_RESUME' | 'RESUME_PARSED';
  payload?: ApplyEvent;
  tabId?: number;
  frameId?: number;
  requestId?: string;
  mappings?: FillMapping[];
  message?: string;
  timestamp?: number;
  resumeText?: string;
  profile?: any;
}

export interface PopupState {
  enabled: boolean;
  dryRun: boolean;
  nativeHostConnected: boolean;
  lastError: string | null;
  lastJob: {
    title: string | null;
    atsHint: string | null;
    hostname: string;
  } | null;
}

export interface TabJobInfo {
  lastJobMeta: JobMeta | null;
  lastSchemaHash: string | null;
  lastSeenAt: number;
}

export interface JobApplication {
  jobTitle: string;
  company: string;
  url: string;
  atsHint: string | null;
  timestamp: number;
  status: 'detected' | 'submitted' | 'interviewing' | 'rejected' | 'accepted' | 'withdrawn';
  notes?: string; // Optional notes for tracking
  id?: string; // Unique identifier for updates/deletes
}

export interface DailySummary {
  date: string; // YYYY-MM-DD
  applications: JobApplication[];
  lastSentAt: number | null;
}
