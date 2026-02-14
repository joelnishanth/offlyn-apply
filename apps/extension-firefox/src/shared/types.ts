/**
 * Shared type definitions for the Offlyn Firefox extension
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
  status: 'detected' | 'submitted';
}

export interface DailySummary {
  date: string; // YYYY-MM-DD
  applications: JobApplication[];
  lastSentAt: number | null;
}
