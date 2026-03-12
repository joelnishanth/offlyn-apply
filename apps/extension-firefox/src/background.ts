/**
 * Background script for managing Ollama communication and relaying events
 */

import type { ApplyEvent, TabJobInfo, JobApplication } from './shared/types';
import { getSettings, setTabJobInfo, addJobApplication, getAllApplications } from './shared/storage';
import { log, info, warn, error } from './shared/log';
import { sendDailySummary } from './shared/whatsapp';
import { mastraAgent as ollama } from './shared/mastra-agent';
import { ragParser } from './shared/rag-parser';
import { enrichParseErrorMessage } from './shared/error-classify';
import { graphMemory } from './shared/graph/service';
import { getUserProfile, formatPhone, formatLocation, type UserProfile } from './shared/profile';

interface ConnectionState {
  connected: boolean;
  lastError: string | null;
  checking: boolean;
}

const connectionState: ConnectionState = {
  connected: false,
  lastError: null,
  checking: false,
};

const tabJobInfo: Map<number, TabJobInfo> = new Map();

/**
 * Generic/garbage job titles that appear on job board listing pages
 * rather than on actual ATS application forms.
 * Used to filter out false-positive SUBMIT_ATTEMPT captures.
 */
const GENERIC_JOB_TITLES = new Set([
  'apply for this job',
  'apply now',
  'apply to this job',
  'apply to this position',
  'submit application',
  'submit your application',
  'job application',
  'application form',
  'apply',
  'apply here',
  'apply today',
  'apply online',
  'apply for this position',
  'apply for this role',
  'apply for job',
  'quick apply',
]);

const GENERIC_COMPANY_NAMES = new Set([
  'job-boards',
  'job boards',
  'jobs',
  'careers',
  'jobboard',
  'job board',
  'career',
  'hiring',
  'recruiter',
  'recruitment',
  'talent',
  'hr',
  'human resources',
  'greenhouse',  // ATS provider names, not actual companies
  'lever',
  'workday',
  'ashby',
  'bamboohr',
  'icims',
  'smartrecruiters',
  'taleo',
  'boards',
]);

/**
 * Returns true if the job title or company name looks like a generic
 * listing-page artifact rather than a real application entry.
 */
function isGenericJobEntry(jobTitle: string, company: string): boolean {
  const titleNorm = jobTitle.trim().toLowerCase();
  const companyNorm = company.trim().toLowerCase();
  return GENERIC_JOB_TITLES.has(titleNorm) || GENERIC_COMPANY_NAMES.has(companyNorm);
}

/**
 * Check Ollama connection status
 */
async function checkOllamaConnection(): Promise<void> {
  if (connectionState.checking) return;
  
  connectionState.checking = true;
  
  try {
    const isAvailable = await ollama.isAvailable();
    
    if (isAvailable) {
      if (!connectionState.connected) {
        connectionState.connected = true;
        connectionState.lastError = null;
        info('Connected to Ollama');
        
        // Get version info
        const version = await ollama.getVersion();
        if (version) {
          log('Ollama version:', version.version);
        }
      }
    } else {
      if (connectionState.connected) {
        connectionState.connected = false;
        connectionState.lastError = 'Ollama not reachable at http://localhost:11434';
        warn('Ollama connection lost');
      }
    }
  } catch (err) {
    connectionState.connected = false;
    connectionState.lastError = err instanceof Error ? err.message : 'Unknown error';
    error('Error checking Ollama connection:', err);
  } finally {
    connectionState.checking = false;
  }
}

/**
 * Handle messages from extension components
 */
browser.runtime.onMessage.addListener(async (message: unknown, sender: browser.runtime.MessageSender) => {
  try {
    if (typeof message !== 'object' || message === null || !('kind' in message)) {
      return;
    }
    
    // Handle PARSE_RESUME from onboarding page
    if (message.kind === 'PARSE_RESUME') {
      info('Received PARSE_RESUME request from onboarding');
      
      // Check if Ollama is available
      if (!connectionState.connected) {
        await checkOllamaConnection();
      }
      
      if (!connectionState.connected) {
        error('Ollama not connected');
        return {
          kind: 'ERROR',
          requestId: 'parse_error',
          message: 'Ollama not connected. Please ensure Ollama is running at http://localhost:11434',
        };
      }
      
      const requestId = `parse_${Date.now()}`;
      const resumeText = (message as any).resumeText;
      
      info('Parsing resume with Ollama, length:', resumeText?.length);

      const broadcastProgress = (stage: string, percent: number, detail?: string) => {
        browser.runtime.sendMessage({
          kind: 'PARSE_PROGRESS',
          stage,
          percent,
          detail: detail || '',
        }).catch(() => {});
      };
      
      try {
        // Check if user wants RAG parsing (default: true for better accuracy)
        const useRAG = (message as any).useRAG !== false; // Default to RAG
        
        let profile: any;
        
        if (useRAG) {
          info('Using RAG-based parsing for higher accuracy...');
          
          // Parse with RAG
          profile = await ragParser.parseResume(resumeText, (stage, percent, detail) => {
            info(`RAG parsing: ${stage} (${percent}%)`);
            broadcastProgress(stage, percent, detail);
          });
          
          info('Successfully parsed profile with RAG');
        } else {
          info('Using legacy chunking parser...');
          
          // Fallback to legacy parser
          profile = await ollama.parseResume(resumeText, (stage, percent) => {
            info(`Parsing progress: ${stage} (${percent}%)`);
            broadcastProgress(stage, percent);
          });
          
          info('Successfully parsed profile with chunking');
        }
        
        return {
          kind: 'RESUME_PARSED',
          requestId,
          profile,
        };
      } catch (err) {
        error('Failed to parse resume:', err);
        
        // If RAG fails, try fallback to legacy parser
        if ((message as any).useRAG !== false) {
          warn('RAG parsing failed, trying legacy parser...');
          try {
            const profile = await ollama.parseResume(resumeText, (stage, percent) => {
              info(`Fallback parsing: ${stage} (${percent}%)`);
            });
            
            return {
              kind: 'RESUME_PARSED',
              requestId,
              profile,
            };
          } catch (fallbackErr) {
            error('Fallback parsing also failed:', fallbackErr);
          }
        }
        
        const messageText = enrichParseErrorMessage(
          err instanceof Error ? err.message : 'Failed to parse resume',
        );
        
        return {
          kind: 'ERROR',
          requestId,
          message: messageText,
        };
      }
    }
    
    // Handle SUGGEST_FIELD from onboarding page - AI-powered field suggestion
    if (message.kind === 'SUGGEST_FIELD') {
      const { fieldName, resumeText } = message as any;
      info('Received SUGGEST_FIELD request for:', fieldName);

      if (!connectionState.connected) {
        await checkOllamaConnection();
      }
      if (!connectionState.connected) {
        return { kind: 'SUGGEST_FIELD_RESULT', fieldName, value: '', error: 'Ollama not connected' };
      }

      const fieldHints: Record<string, string> = {
        firstName: 'the person\'s first name',
        lastName: 'the person\'s last name',
        email: 'the person\'s email address',
        phone: 'the person\'s phone number',
        location: 'the person\'s city and state/country location',
        linkedin: 'the person\'s LinkedIn profile URL',
        github: 'the person\'s GitHub profile URL',
        portfolio: 'the person\'s portfolio or personal website URL',
        yearsOfExperience: 'the total years of professional experience (just the number)',
        summary: 'a concise 2-3 sentence professional summary highlighting key qualifications',
      };

      const hint = fieldHints[fieldName] || `the value for the "${fieldName}" field`;

      try {
        const { OllamaClient } = await import('./shared/ollama-client');
        const client = new OllamaClient();
        const raw = await client.chat([
          {
            role: 'system',
            content: 'You extract information from resumes. Return ONLY the requested value, nothing else. No labels, no quotes, no explanation. If the information is not found, return an empty string.',
          },
          {
            role: 'user',
            content: `From this resume, extract ${hint}:\n\n${(resumeText || '').substring(0, 4000)}`,
          },
        ], { temperature: 0.1 });

        const value = (raw || '').trim().replace(/^["']|["']$/g, '');
        info('SUGGEST_FIELD result for', fieldName, ':', value.substring(0, 80));
        return { kind: 'SUGGEST_FIELD_RESULT', fieldName, value };
      } catch (err) {
        error('SUGGEST_FIELD failed:', err);
        return {
          kind: 'SUGGEST_FIELD_RESULT',
          fieldName,
          value: '',
          error: err instanceof Error ? err.message : 'Failed to generate suggestion',
        };
      }
    }

    // Handle JOB_APPLY_EVENT from content script
    if (message.kind === 'JOB_APPLY_EVENT') {
      const event = message as ApplyEvent;
      const tabId = sender.tab?.id;
      
      if (!tabId) {
        warn('Received event without tab ID');
        return;
      }
      
      // Store job info for popup
      const jobInfo: TabJobInfo = {
        lastJobMeta: event.jobMeta,
        lastSchemaHash: JSON.stringify(event.schema).length.toString(),
        lastSeenAt: Date.now(),
      };
      tabJobInfo.set(tabId, jobInfo);
      await setTabJobInfo(tabId, jobInfo);
      
      // Track application for daily summary - ONLY on actual submission, not detection
      if (event.eventType === 'SUBMIT_ATTEMPT') {
        console.log('[Background] SUBMIT_ATTEMPT event received:', {
          jobTitle: event.jobMeta.jobTitle,
          company: event.jobMeta.company,
          url: event.jobMeta.url,
        });

        // Use fallbacks instead of silently dropping — a missing title or company
        // from a poorly-structured ATS page should still be tracked.
        let jobTitle = event.jobMeta.jobTitle;
        let company = event.jobMeta.company;

        if (!jobTitle) {
          console.warn('[Background] Missing jobTitle - using fallback');
          // Derive from URL path: /jobs/software-engineer → "software engineer"
          try {
            const pathParts = new URL(event.jobMeta.url).pathname.split('/').filter(Boolean);
            const lastPart = pathParts[pathParts.length - 1];
            jobTitle = lastPart ? lastPart.replace(/[-_]/g, ' ') : 'Unknown Position';
          } catch {
            jobTitle = 'Unknown Position';
          }
        }

        if (!company) {
          console.warn('[Background] Missing company - using fallback');
          try {
            const parsedUrl = new URL(event.jobMeta.url);
            const hostname = parsedUrl.hostname.toLowerCase();
            const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
            // For shared ATS boards, company is the first path segment
            if (hostname === 'job-boards.greenhouse.io' || hostname === 'boards.greenhouse.io' || hostname === 'jobs.lever.co') {
              company = pathParts[0] || 'Unknown Company';
            } else {
              const parts = hostname.replace(/^www\./, '').split('.');
              const GENERIC_SUBDOMAINS = new Set(['careers', 'jobs', 'hiring', 'apply', 'work', 'talent', 'recruit', 'hr', 'job', 'career', 'boards', 'job-boards']);
              const companyPart = parts.find(p => !GENERIC_SUBDOMAINS.has(p.toLowerCase()) && p !== 'com' && p !== 'io' && p !== 'net' && p !== 'org' && p !== 'co' && p.length > 1);
              company = companyPart || parts[0] || 'Unknown Company';
            }
          } catch {
            company = 'Unknown Company';
          }
        }

        // Skip generic/garbage titles that come from job board listing pages
        // rather than the actual ATS application form
        if (isGenericJobEntry(jobTitle, company)) {
          console.warn('[Background] Skipping generic/invalid entry:', jobTitle, 'at', company);
        } else {
          const app: JobApplication = {
            jobTitle,
            company,
            url: event.jobMeta.url,
            atsHint: event.jobMeta.atsHint,
            timestamp: Date.now(),
            status: 'submitted',
          };
          await addJobApplication(app);
          console.log('[Background] Application tracked:', app.jobTitle, 'at', app.company);
          log(`Tracked submitted application:`, app.jobTitle, 'at', app.company);
        }
      }
      
      return;
    }
    
    // Handle GET_STATE from popup
    if (message.kind === 'GET_STATE') {
      const settings = await getSettings();
      let lastJob = null;
      
      // The popup doesn't have a sender.tab, so look up the currently active tab
      let tabId = sender.tab?.id;
      
      if (!tabId) {
        // Query for the active tab in the current window
        try {
          const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
          if (activeTabs[0]?.id) {
            tabId = activeTabs[0].id;
          }
        } catch {
          // Ignore query errors
        }
      }
      
      if (tabId) {
        const jobInfo = tabJobInfo.get(tabId);
        if (jobInfo?.lastJobMeta) {
          try {
            const url = new URL(jobInfo.lastJobMeta.url);
            lastJob = {
              title: jobInfo.lastJobMeta.jobTitle,
              atsHint: jobInfo.lastJobMeta.atsHint,
              hostname: url.hostname,
            };
          } catch {
            // Ignore
          }
        }
      }
      
      // Re-check Ollama connection so the popup gets a fresh status
      if (!connectionState.connected) {
        await checkOllamaConnection();
      }

      // Read application stats in background context (reliable storage access)
      let statTotal = 0;
      let statInterviewing = 0;
      try {
        const apps = await getAllApplications();
        statTotal = apps.length;
        statInterviewing = apps.filter(a => a.status === 'interviewing').length;
      } catch {
        // Non-fatal — stats stay at 0
      }
      
      return {
        kind: 'STATE_UPDATE',
        enabled: settings.enabled,
        dryRun: settings.dryRun,
        nativeHostConnected: connectionState.connected,
        lastError: connectionState.lastError,
        lastJob,
        statTotal,
        statInterviewing,
      };
    }
    
    // Handle SEND_DAILY_SUMMARY request
    if (message.kind === 'SEND_DAILY_SUMMARY') {
      const result = await sendDailySummary();
      return {
        kind: 'SUMMARY_SENT',
        success: result.success,
        error: result.error,
      };
    }
    
    // Handle GET_CONNECTION_STATUS request
    if (message.kind === 'GET_CONNECTION_STATUS') {
      // Check connection on demand
      await checkOllamaConnection();
      
      return {
        connected: connectionState.connected,
        lastError: connectionState.lastError,
      };
    }
    
    // ── Graph: record correction (sent from content script) ──────────────────
    if (message.kind === 'GRAPH_RECORD_CORRECTION') {
      const msg = message as any;
      graphMemory.recordCorrection(
        msg.questionText ?? '',
        msg.canonicalField,
        msg.originalValue ?? '',
        msg.correctedValue ?? '',
        {
          company: msg.context?.company,
          jobTitle: msg.context?.jobTitle,
          url: msg.context?.url,
          platform: msg.context?.platform,
        }
      );
      return;
    }

    // ── Graph: look up best answer for a field (called from content script) ──────
    if (message.kind === 'GRAPH_GET_BEST_ANSWER') {
      const msg = message as any;
      const result = await graphMemory.getBestAnswerForField({
        questionText: msg.questionText ?? '',
        canonicalField: msg.canonicalField,
        platform: msg.platform,
        company: msg.company,
        jobTitle: msg.jobTitle,
        url: msg.url,
      });
      return result;
    }

    // ── Graph: record a successfully used answer ──────────────────────────────
    if (message.kind === 'GRAPH_RECORD_ANSWER') {
      const msg = message as any;
      graphMemory.recordAnswer(
        msg.questionText ?? '',
        msg.value ?? '',
        msg.source ?? 'profile',
        msg.canonicalField ?? 'unknown',
        {
          company: msg.context?.company,
          jobTitle: msg.context?.jobTitle,
          url: msg.context?.url,
          platform: msg.context?.platform,
        }
      );
      return;
    }

    // ── Graph: record fill provenance (for debug panel) ───────────────────────
    if (message.kind === 'GRAPH_RECORD_PROVENANCE') {
      const msg = message as any;
      graphMemory.recordFillProvenance(msg.label ?? '', msg.record);
      return;
    }

    // ── Graph debug: "Why was this filled?" ───────────────────────────────────
    if (message.kind === 'GRAPH_DEBUG_REQUEST') {
      const msg = message as any;
      const provenance = graphMemory.getLastFillProvenance(msg.label ?? '');
      return { kind: 'GRAPH_DEBUG_RESPONSE', provenance };
    }

    // ── Graph seed from profile ────────────────────────────────────────────────
    if (message.kind === 'GRAPH_SEED_FROM_PROFILE') {
      const profile = (message as any).profile as UserProfile;
      if (profile) {
        const entries = buildProfileSeedEntries(profile);
        graphMemory.seedFromProfile(entries);
        info(`[Graph] Profile seeded with ${entries.length} entries`);
      }
      return { kind: 'GRAPH_SEED_FROM_PROFILE_ACK' };
    }

    return;
  } catch (err) {
    error('Error handling message:', err);
    return {
      kind: 'ERROR',
      message: err instanceof Error ? err.message : 'Unknown error',
    };
  }
});

// ── Context Menus (right-click text transform) ─────────────────────────────

/**
 * Create context menu items for text transformation.
 * These appear when the user selects text inside an editable field.
 */
function createContextMenus(): void {
  // Remove any stale menus first
  browser.menus.removeAll();

  // Parent menu
  browser.menus.create({
    id: 'offlyn-text-transform',
    title: 'Offlyn Apply',
    contexts: ['editable'],
  });

  // Sub-items
  browser.menus.create({
    id: 'offlyn-professional-fix',
    parentId: 'offlyn-text-transform',
    title: 'Professional Fix',
    contexts: ['editable'],
  });

  browser.menus.create({
    id: 'offlyn-expand',
    parentId: 'offlyn-text-transform',
    title: 'Expand',
    contexts: ['editable'],
  });

  browser.menus.create({
    id: 'offlyn-shorten',
    parentId: 'offlyn-text-transform',
    title: 'Shorten',
    contexts: ['editable'],
  });

  browser.menus.create({
    id: 'offlyn-debug-separator',
    parentId: 'offlyn-text-transform',
    type: 'separator',
    contexts: ['editable'],
  });

  browser.menus.create({
    id: 'offlyn-debug-fill',
    parentId: 'offlyn-text-transform',
    title: 'Why was this filled?',
    contexts: ['editable'],
  });

  info('Context menus created');
}

/**
 * Handle context menu clicks — relay to the content script.
 */
browser.menus.onClicked.addListener((menuInfo, tab) => {
  if (!tab?.id) return;

  const actionMap: Record<string, string> = {
    'offlyn-professional-fix': 'professional-fix',
    'offlyn-expand': 'expand',
    'offlyn-shorten': 'shorten',
  };

  const action = actionMap[menuInfo.menuItemId as string];
  if (action) {
    info(`Context menu: "${action}" on tab ${tab.id}`);
    browser.tabs.sendMessage(tab.id, {
      kind: 'TEXT_TRANSFORM',
      action,
    }, menuInfo.frameId != null ? { frameId: menuInfo.frameId } : undefined);
    return;
  }

  // Debug: "Why was this filled?"
  if (menuInfo.menuItemId === 'offlyn-debug-fill') {
    info(`Context menu: "debug-fill" on tab ${tab.id}`);
    browser.tabs.sendMessage(
      tab.id,
      { kind: 'GRAPH_DEBUG_FIELD' },
      menuInfo.frameId != null ? { frameId: menuInfo.frameId } : undefined
    );
  }
});

// ── Graph profile seeding ───────────────────────────────────────────────────

/**
 * Convert a UserProfile into flat seed entries for the graph.
 * Each entry maps a canonical field name to a canonical question text and value.
 * Question texts are chosen to match common ATS label wording so similarity
 * lookups fire even on first-visit forms.
 */
function buildProfileSeedEntries(profile: UserProfile): Array<{ canonicalField: string; questionText: string; value: string }> {
  const p = profile;
  const phone = formatPhone(p.personal.phone);
  const location = formatLocation(p.personal.location);
  const fullName = [p.personal.firstName, p.personal.lastName].filter(Boolean).join(' ');
  const currentRole = (p.professional as any)?.currentRole ?? '';
  const yearsExp = p.professional?.yearsOfExperience != null ? String(p.professional.yearsOfExperience) : '';

  const entries: Array<{ canonicalField: string; questionText: string; value: string }> = [
    { canonicalField: 'first_name',          questionText: 'What is your first name?',                   value: p.personal.firstName ?? '' },
    { canonicalField: 'last_name',           questionText: 'What is your last name?',                    value: p.personal.lastName ?? '' },
    { canonicalField: 'full_name',           questionText: 'What is your full name?',                    value: fullName },
    { canonicalField: 'email',               questionText: 'What is your email address?',                value: p.personal.email ?? '' },
    { canonicalField: 'phone',               questionText: 'What is your phone number?',                 value: phone },
    { canonicalField: 'location',            questionText: 'What is your current location?',             value: location },
    { canonicalField: 'linkedin',            questionText: 'What is your LinkedIn profile URL?',         value: p.professional?.linkedin ?? '' },
    { canonicalField: 'github',              questionText: 'What is your GitHub profile URL?',           value: p.professional?.github ?? '' },
    { canonicalField: 'portfolio',           questionText: 'What is your portfolio or website URL?',     value: p.professional?.portfolio ?? '' },
    { canonicalField: 'current_role',        questionText: 'What is your current job title?',            value: currentRole },
    { canonicalField: 'years_of_experience', questionText: 'How many years of experience do you have?',  value: yearsExp },
  ];

  // Work authorization
  if (p.workAuth) {
    entries.push({
      canonicalField: 'requires_sponsorship',
      questionText: 'Do you require visa sponsorship?',
      value: p.workAuth.requiresSponsorship ? 'Yes' : 'No',
    });
    entries.push({
      canonicalField: 'legally_authorized',
      questionText: 'Are you legally authorized to work in the United States?',
      value: p.workAuth.legallyAuthorized ? 'Yes' : 'No',
    });
  }

  // Most recent job title and company
  const latestJob = p.work?.[0];
  if (latestJob?.title) {
    entries.push({ canonicalField: 'current_role', questionText: 'What is your most recent job title?', value: latestJob.title });
  }
  if (latestJob?.company) {
    entries.push({ canonicalField: 'current_company', questionText: 'What is your current or most recent employer?', value: latestJob.company });
  }

  // Skills summary
  if (p.skills?.length) {
    entries.push({
      canonicalField: 'skills',
      questionText: 'What are your key skills?',
      value: p.skills.join(', '),
    });
  }

  // Professional summary
  if (p.summary) {
    entries.push({
      canonicalField: 'summary',
      questionText: 'Please provide a brief professional summary.',
      value: p.summary,
    });
  }

  return entries.filter(e => e.value.trim() !== '');
}

// ── Init ───────────────────────────────────────────────────────────────────

/**
 * Initialize background script
 */
async function init(): Promise<void> {
  log('Background script initializing...');

  // Initialize graph memory layer
  await graphMemory.initialize();

  // Seed graph with existing profile (handles users who installed before this feature)
  const existingProfile = await getUserProfile();
  if (existingProfile) {
    const entries = buildProfileSeedEntries(existingProfile);
    graphMemory.seedFromProfile(entries);
  }

  // Create right-click context menus
  createContextMenus();
  
  // Check Ollama connection on startup
  await checkOllamaConnection();
  
  // Periodically check Ollama connection (every 10 seconds)
  setInterval(() => {
    checkOllamaConnection();
  }, 10000);
  
  // Clean up old tab info periodically
  setInterval(() => {
    browser.tabs.query({}).then(tabs => {
      const activeTabs = new Set(tabs.map(t => t.id));
      for (const tabId of tabJobInfo.keys()) {
        if (!activeTabs.has(tabId)) {
          tabJobInfo.delete(tabId);
        }
      }
    });
  }, 60000); // Every minute
  
  info('Background script initialized');
}

init();
