/**
 * Background script for managing Ollama communication and relaying events
 */

import type { ApplyEvent, TabJobInfo, JobApplication } from './shared/types';
import { getSettings, setTabJobInfo, addJobApplication, getAllApplications } from './shared/storage';
import { log, info, warn, error } from './shared/log';
import { sendDailySummary } from './shared/whatsapp';
import { mastraAgent as ollama } from './shared/mastra-agent';
import { ragParser } from './shared/rag-parser';
import { ParseValidator } from './shared/parse-validator';
import { enrichParseErrorMessage } from './shared/error-classify';
import { graphMemory } from './shared/graph/service';
import { getUserProfile, formatPhone, formatLocation, type UserProfile } from './shared/profile';
import { fieldClassifier, isTypeCompatible } from './shared/field-classifier';
import { normalizeValue } from './shared/value-normalizer';
import { isGenericJobEntry, isDuplicateSubmit, GENERIC_JOB_TITLES, GENERIC_COMPANY_NAMES } from './shared/job-dedup';

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

// isGenericJobEntry and isDuplicateSubmit are imported from ./shared/job-dedup

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

    // ── Native Messaging — Ollama Setup Helper ───────────────────────────────
    // Must live inside the async listener; a separate synchronous listener is
    // never reached because Firefox (like Chrome MV3) treats Promise<undefined>
    // returned by an async listener as the final response, closing the channel.
    const NATIVE_HOST_ID = 'ai.offlyn.helper';

    if ((message as any).kind === 'CHECK_NATIVE_HELPER') {
      return new Promise((resolve) => {
        try {
          const port = browser.runtime.connectNative(NATIVE_HOST_ID);
          port.postMessage({ cmd: 'ping' });
          port.onMessage.addListener((res: any) => {
            resolve({ installed: true, version: res.version ?? '?' });
            port.disconnect();
          });
          port.onDisconnect.addListener(() => {
            resolve({ installed: false, error: (browser.runtime.lastError as any)?.message });
          });
        } catch {
          resolve({ installed: false });
        }
      });
    }

    if ((message as any).kind === 'RUN_OLLAMA_SETUP') {
      return new Promise((resolve) => {
        let port: browser.runtime.Port;
        try {
          port = browser.runtime.connectNative(NATIVE_HOST_ID);
        } catch (err) {
          resolve({ ok: false, error: String(err) });
          return;
        }
        port.postMessage({ cmd: 'run_setup' });
        resolve({ ok: true });
        port.onMessage.addListener((nativeMsg: any) => {
          browser.runtime.sendMessage({ kind: 'SETUP_PROGRESS', ...nativeMsg }).catch(() => {});
          if (nativeMsg.type === 'done') {
            port.disconnect();
          }
        });
        port.onDisconnect.addListener(() => {
          const errMsg = (browser.runtime.lastError as any)?.message ?? 'Host disconnected';
          browser.runtime.sendMessage({ kind: 'SETUP_PROGRESS', type: 'done', ok: false, error: errMsg }).catch(() => {});
        });
      });
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
        info('Running dual-parse: RAG + legacy in parallel for best field coverage...');
        broadcastProgress('Starting dual-pass analysis...', 62);

        // Run both parsers concurrently — each contributes its strengths
        const [ragResult, legacyResult] = await Promise.allSettled([
          ragParser.parseResume(resumeText, (stage, percent, detail) => {
            info(`RAG: ${stage} (${percent}%)`);
            broadcastProgress(stage, percent, detail);
          }),
          ollama.parseResume(resumeText, (stage, percent) => {
            info(`Legacy: ${stage} (${percent}%)`);
          }),
        ]);

        const ragProfile   = ragResult.status    === 'fulfilled' ? ragResult.value    : null;
        const legacyProfile = legacyResult.status === 'fulfilled' ? legacyResult.value : null;

        if (ragResult.status    === 'rejected') warn('RAG parser failed:', ragResult.reason);
        if (legacyResult.status === 'rejected') warn('Legacy parser failed:', legacyResult.reason);

        if (!ragProfile && !legacyProfile) {
          throw new Error('Both parsers failed — no profile could be extracted');
        }

        let profile: any;

        if (ragProfile && legacyProfile) {
          // Both succeeded — use ParseValidator to pick best value per field
          const validator = new ParseValidator();
          const comparison = validator.merge(ragProfile, legacyProfile);
          profile = comparison.merged;
          info(`Merged profiles — RAG wins: ${comparison.differences.filter(d => d.recommended === 'rag').length} fields, Legacy wins: ${comparison.differences.filter(d => d.recommended === 'legacy').length} fields`);
          broadcastProgress('Merging results...', 98);
        } else {
          // Only one succeeded — use it directly
          profile = ragProfile ?? legacyProfile;
          info('Single parser result used:', ragProfile ? 'RAG' : 'legacy');
        }
        
        return {
          kind: 'RESUME_PARSED',
          requestId,
          profile,
        };
      } catch (err) {
        error('Failed to parse resume:', err);
        
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
        } else if (isDuplicateSubmit(company, jobTitle)) {
          // Suppress the second SUBMIT_ATTEMPT that fires when the ATS iframe
          // navigates to its /confirmation URL (the real one already saved above).
          console.warn('[Background] Duplicate SUBMIT_ATTEMPT suppressed within dedup window:', jobTitle, 'at', company);
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
      const questionText: string = msg.questionText ?? '';
      const inputType:    string = msg.inputType    ?? 'text';
      const fieldName:    string = msg.fieldName    ?? '';

      // Stage 1: classify the field — determines if we should autofill at all
      const classification = await fieldClassifier.classify(questionText, inputType, fieldName);

      if (!classification.shouldAutofill) {
        // Junk or unclassifiable field — abstain silently
        return { value: null, confidence: 0, source: null, selectionReason: null, abstained: true, reason: classification.reason };
      }

      // Stage 2: graph lookup with canonicalField + promptType for type-compatibility gating
      const canonicalField = classification.canonicalField ?? msg.canonicalField;
      const result = await graphMemory.getBestAnswerForField({
        questionText,
        canonicalField,
        platform:  msg.platform,
        company:   msg.company,
        jobTitle:  msg.jobTitle,
        url:       msg.url,
        promptType: classification.promptType,
      });

      // Stage 3: normalize the value before returning
      if (result.value) {
        result.value = normalizeValue(result.value, classification.promptType);
      }

      return result;
    }

    // ── Graph: record a successfully used answer ──────────────────────────────
    if (message.kind === 'GRAPH_RECORD_ANSWER') {
      const msg = message as any;
      const questionText: string = msg.questionText ?? '';
      const inputType:    string = msg.inputType    ?? 'text';
      const fieldName:    string = msg.fieldName    ?? '';

      // Only persist if classification allows it
      const classification = await fieldClassifier.classify(questionText, inputType, fieldName);
      if (!classification.shouldPersist) return;

      graphMemory.recordAnswer(
        questionText,
        msg.value ?? '',
        msg.source ?? 'profile',
        classification.canonicalField ?? msg.canonicalField ?? undefined,
        {
          company:  msg.context?.company,
          jobTitle: msg.context?.jobTitle,
          url:      msg.context?.url,
          platform: msg.context?.platform,
        },
        // Mark as internal if field was unclassified (shouldPersist=true but no canonicalField)
        !classification.canonicalField
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

    // ── Smart Fill: generate context-aware answer for a specific field ─────────
    if (message.kind === 'SMART_FILL_QUERY') {
      const msg = message as any;
      const label: string = msg.label ?? '';
      const fieldType: string = msg.fieldType ?? 'text';
      const options: string[] = msg.options ?? [];
      const currentValue: string = msg.currentValue ?? '';

      const profile = await getUserProfile();
      if (!profile) {
        return { error: 'No profile found. Please set up your profile first.' };
      }

      // ── Classify response type based on the field ──
      const classification = classifySmartFillResponse(label, fieldType, options);

      // Build profile context (concise version for focused queries)
      const phone = formatPhone(profile.personal.phone);
      const location = formatLocation(profile.personal.location);
      const latestJob = profile.work?.[0];
      const profileSummary = [
        `Name: ${profile.personal.firstName} ${profile.personal.lastName}`,
        `Email: ${profile.personal.email}`,
        `Phone: ${phone}`,
        `Location: ${location}`,
        `LinkedIn: ${profile.professional?.linkedin ?? 'n/a'}`,
        `GitHub: ${profile.professional?.github ?? 'n/a'}`,
        `Portfolio: ${profile.professional?.portfolio ?? 'n/a'}`,
        `Current role: ${latestJob?.title ?? (profile.professional as any)?.currentRole ?? 'n/a'}`,
        `Current company: ${latestJob?.company ?? 'n/a'}`,
        `Years of experience: ${profile.professional?.yearsOfExperience ?? 'n/a'}`,
        `Skills: ${(profile.skills ?? []).join(', ') || 'n/a'}`,
        profile.summary ? `Summary: ${profile.summary}` : '',
        `Work auth — requires sponsorship: ${profile.workAuth?.requiresSponsorship ? 'Yes' : 'No'}`,
        `Work auth — legally authorized (US): ${profile.workAuth?.legallyAuthorized ? 'Yes' : 'No'}`,
        profile.workAuth?.visaType ? `Visa: ${profile.workAuth.visaType}` : '',
      ].filter(Boolean).join('\n');

      const systemPrompt = `You are filling out a job application on behalf of this candidate.
${classification.instruction}
Respond with ONLY the answer — no labels, no quotes, no explanation, no punctuation around the answer.

CANDIDATE PROFILE:
${profileSummary}
${currentValue ? `\nCurrent value in field (may be empty or incorrect): "${currentValue}"` : ''}`;

      const userPrompt = options.length > 0
        ? `Field: "${label}"\nAvailable options: ${options.join(', ')}\n\nChoose the single best option from the list above.`
        : `Field: "${label}"`;

      try {
        const answer = await ollama.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          { temperature: 0.05, timeout: 30000 }
        );

        const trimmed = answer.trim().replace(/^["']|["']$/g, '');
        info(`[SmartFill] "${label}" → "${trimmed}" (${classification.responseType})`);
        return { value: trimmed, responseType: classification.responseType };
      } catch (llmErr) {
        warn('[SmartFill] LLM error:', llmErr);
        return { error: 'Ollama is not responding. Make sure it is running.' };
      }
    }

    // ── Chat with Resume: profile status check ────────────────────────────────
    if (message.kind === 'CHAT_PROFILE_STATUS') {
      const profile = await getUserProfile();
      if (!profile) return { hasProfile: false };
      const name = [profile.personal.firstName, profile.personal.lastName].filter(Boolean).join(' ');
      return { hasProfile: true, name: name || undefined };
    }

    // ── Chat with Resume: answer a question ───────────────────────────────────
    if (message.kind === 'CHAT_QUERY') {
      const question = (message as any).question as string;
      if (!question?.trim()) return { answer: 'Please ask a question.', source: 'error' };

      const profile = await getUserProfile();
      if (!profile) {
        return {
          answer: "You haven't uploaded a resume yet. Head to the onboarding page to get started.",
          source: 'error',
        };
      }

      // Build a plain-text profile context for the LLM
      const phone = formatPhone(profile.personal.phone);
      const location = formatLocation(profile.personal.location);
      const workHistory = (profile.work ?? [])
        .map(w => `  - ${w.title} at ${w.company} (${w.startDate} – ${w.current ? 'Present' : w.endDate})`)
        .join('\n');
      const education = (profile.education ?? [])
        .map(e => `  - ${e.degree} in ${e.field} from ${e.school} (${e.graduationYear})`)
        .join('\n');
      const skills = (profile.skills ?? []).join(', ');
      const workAuthLines = profile.workAuth
        ? [
            `Requires sponsorship: ${profile.workAuth.requiresSponsorship ? 'Yes' : 'No'}`,
            `Legally authorized in US: ${profile.workAuth.legallyAuthorized ? 'Yes' : 'No'}`,
            profile.workAuth.visaType ? `Visa type: ${profile.workAuth.visaType}` : '',
          ].filter(Boolean).join('\n  ')
        : 'Not provided';

      const profileContext = `
Name: ${profile.personal.firstName} ${profile.personal.lastName}
Email: ${profile.personal.email}
Phone: ${phone}
Location: ${location}
LinkedIn: ${profile.professional?.linkedin ?? 'Not provided'}
GitHub: ${profile.professional?.github ?? 'Not provided'}
Portfolio: ${profile.professional?.portfolio ?? 'Not provided'}
Years of experience: ${profile.professional?.yearsOfExperience ?? 'Not specified'}
Skills: ${skills || 'Not provided'}
Summary: ${profile.summary ?? 'Not provided'}

Work history:
${workHistory || '  None provided'}

Education:
${education || '  None provided'}

Work authorization:
  ${workAuthLines}
`.trim();

      const systemPrompt = `You are a helpful assistant that answers questions about a job applicant's resume and background.
Answer based ONLY on the profile data provided below. Be concise and direct.
If the answer is not in the profile, say so honestly rather than guessing.

PROFILE DATA:
${profileContext}`;

      try {
        const answer = await ollama.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ], { temperature: 0.1, timeout: 30000 });

        return { answer: answer.trim(), source: 'llm' };
      } catch (chatErr) {
        warn('Chat LLM error:', chatErr);
        // Fallback: try to answer from profile directly for simple field questions
        const lq = question.toLowerCase();
        const simpleAnswers: Array<[string[], string]> = [
          [['email'], profile.personal.email],
          [['phone'], phone],
          [['location', 'city', 'where'], location],
          [['linkedin'], profile.professional?.linkedin ?? 'Not provided'],
          [['github'], profile.professional?.github ?? 'Not provided'],
          [['portfolio', 'website'], profile.professional?.portfolio ?? 'Not provided'],
          [['first name'], profile.personal.firstName],
          [['last name'], profile.personal.lastName],
          [['name'], `${profile.personal.firstName} ${profile.personal.lastName}`],
          [['skills'], skills || 'Not provided'],
          [['years', 'experience'], String(profile.professional?.yearsOfExperience ?? 'Not specified')],
          [['sponsor', 'visa'], profile.workAuth ? (profile.workAuth.requiresSponsorship ? 'Yes' : 'No') : 'Not specified'],
          [['authorized', 'legal'], profile.workAuth ? (profile.workAuth.legallyAuthorized ? 'Yes' : 'No') : 'Not specified'],
        ];

        for (const [keywords, value] of simpleAnswers) {
          if (keywords.some(k => lq.includes(k)) && value) {
            return { answer: value, source: 'profile' };
          }
        }

        return {
          answer: 'Ollama is not available right now. Please make sure it is running and try again.',
          source: 'error',
        };
      }
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

  // Sub-items — Smart Fill first (primary action)
  browser.menus.create({
    id: 'offlyn-smart-fill',
    parentId: 'offlyn-text-transform',
    title: '✨ Smart Fill this field',
    contexts: ['editable'],
  });

  browser.menus.create({
    id: 'offlyn-smart-fill-separator',
    parentId: 'offlyn-text-transform',
    type: 'separator',
    contexts: ['editable'],
  });

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

  // Smart Fill: generate answer from profile + LLM for the right-clicked field
  if (menuInfo.menuItemId === 'offlyn-smart-fill') {
    info(`Context menu: "smart-fill" on tab ${tab.id}`);
    browser.tabs.sendMessage(
      tab.id,
      { kind: 'SMART_FILL_FIELD' },
      menuInfo.frameId != null ? { frameId: menuInfo.frameId } : undefined
    );
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

// ── Smart Fill response classifier ─────────────────────────────────────────

/**
 * Determines what kind of answer a field expects so the LLM prompt gives
 * appropriately-sized output. Never write an essay for a Yes/No question.
 */
function classifySmartFillResponse(
  label: string,
  fieldType: string,
  options: string[]
): { responseType: 'yesno' | 'short' | 'medium' | 'long'; instruction: string } {
  const l = label.toLowerCase();

  // ── Yes / No ──────────────────────────────────────────────────────────────
  // 1. Explicit two-option dropdown with Yes and No
  if (
    options.length === 2 &&
    options.some(o => /^yes$/i.test(o.trim())) &&
    options.some(o => /^no$/i.test(o.trim()))
  ) {
    return { responseType: 'yesno', instruction: 'Answer with exactly one word: either "Yes" or "No".' };
  }
  // 2. Question starting with interrogative verbs
  if (/^(do you|are you|have you|will you|would you|can you|did you|is this|does this|were you|is your|has your)/i.test(l)) {
    return { responseType: 'yesno', instruction: 'Answer with exactly one word: either "Yes" or "No".' };
  }

  // ── Single-value short fields ─────────────────────────────────────────────
  const shortPatterns = [
    /\b(first name|last name|full name|middle name)\b/i,
    /\b(email|e-mail)\b/i,
    /\b(phone|telephone|mobile)\b/i,
    /\b(city|state|country|zip|postal code|address)\b/i,
    /\b(linkedin|github|portfolio|website|url)\b/i,
    /\b(job title|current title|position|role)\b/i,
    /\b(company|employer|organization)\b/i,
    /\b(salary|compensation|pay|rate)\b/i,
    /\b(date|start date|end date|graduation)\b/i,
    /\b(degree|major|field of study|gpa)\b/i,
    /\b(years of experience|experience years)\b/i,
    /\b(visa|work authorization|citizenship)\b/i,
  ];
  if (shortPatterns.some(re => re.test(l))) {
    return {
      responseType: 'short',
      instruction: 'Answer with just the value — no explanation, no punctuation, no extra words.',
    };
  }

  // ── Long-form textarea fields ─────────────────────────────────────────────
  const longPatterns = [
    /cover letter/i,
    /personal statement/i,
    /\bdescribe\b.{0,40}\b(yourself|background|experience|career|role|project)\b/i,
    /tell us (about|why|what)/i,
    /\babout yourself\b/i,
    /\bprofessional summary\b/i,
    /\bmotivation\b/i,
    /\bessay\b/i,
    /\badditional information\b/i,
    /\bsupplemental\b/i,
    /\bwork samples?\b/i,
  ];
  if (fieldType === 'textarea' && longPatterns.some(re => re.test(l))) {
    return {
      responseType: 'long',
      instruction: 'Write a detailed, professional 2-3 paragraph response (150-250 words). Use first person.',
    };
  }

  // ── Medium: short descriptive questions and un-matched textareas ──────────
  if (fieldType === 'textarea' || l.length > 60) {
    return {
      responseType: 'medium',
      instruction: 'Write 2-3 concise professional sentences (40-80 words). Be specific and direct.',
    };
  }

  // ── Default: short answer ─────────────────────────────────────────────────
  return {
    responseType: 'short',
    instruction: 'Answer with just the value — no explanation, no punctuation, no extra words.',
  };
}

// ── Graph profile seeding ───────────────────────────────────────────────────

/**
 * Convert a UserProfile into flat seed entries for the graph.
 * Each entry maps a canonical field name to a canonical question text and value.
 * Question texts are chosen to match common ATS label wording so similarity
 * lookups fire even on first-visit forms.
 */
/**
 * Build profile seed entries for the graph memory.
 *
 * Design rules that keep the graph clean for ANY form type (job apps, DMV,
 * DS-160, financial, HR onboarding, etc.):
 *
 *  1. Every entry MUST have a real canonicalField — no 'unknown' fallback.
 *  2. Work entries without a startDate are phantom parser artifacts; skip them.
 *  3. Deduplicate work entries by company+title to prevent multiple identical nodes.
 *  4. Only seed the most-recent dated job as current_role/current_company so the
 *     graph doesn't accumulate stale entries on every startup.
 *  5. Identity / document fields (DOB, passport, address) are included when present
 *     so the system can fill DMV/DS-160 fields without user re-entry.
 */
function buildProfileSeedEntries(profile: UserProfile): Array<{ canonicalField: string; questionText: string; value: string }> {
  const p = profile;
  const phone = formatPhone(p.personal.phone);
  const location = formatLocation(p.personal.location);

  // Build full name correctly — keep middleName out of lastName
  const nameParts = [p.personal.firstName, p.personal.middleName, p.personal.lastName].filter(Boolean);
  const fullName = nameParts.join(' ');

  // ── Personal identity ──────────────────────────────────────────────────────
  const entries: Array<{ canonicalField: string; questionText: string; value: string }> = [
    { canonicalField: 'first_name',    questionText: 'What is your first name?',      value: p.personal.firstName ?? '' },
    { canonicalField: 'last_name',     questionText: 'What is your last name?',       value: p.personal.lastName ?? '' },
    { canonicalField: 'full_name',     questionText: 'What is your full name?',       value: fullName },
    { canonicalField: 'email',         questionText: 'What is your email address?',   value: p.personal.email ?? '' },
    { canonicalField: 'phone',         questionText: 'What is your phone number?',    value: phone },
    { canonicalField: 'location',      questionText: 'What is your current location?', value: location },
  ];

  if (p.personal.middleName) {
    entries.push({ canonicalField: 'middle_name', questionText: 'What is your middle name?', value: p.personal.middleName });
  }
  if (p.personal.preferredName) {
    entries.push({ canonicalField: 'preferred_name', questionText: 'What is your preferred name?', value: p.personal.preferredName });
  }

  // ── Address (used by DMV, tax, HR forms) ────────────────────────────────
  const primaryAddress = p.personal.addresses?.[0];
  if (primaryAddress) {
    if (primaryAddress.line1)   entries.push({ canonicalField: 'address_line1', questionText: 'What is your street address?',      value: primaryAddress.line1 });
    if (primaryAddress.line2)   entries.push({ canonicalField: 'address_line2', questionText: 'Apartment, suite, or unit number?', value: primaryAddress.line2 });
    if (primaryAddress.city)    entries.push({ canonicalField: 'city',          questionText: 'What city do you live in?',          value: primaryAddress.city });
    if (primaryAddress.state)   entries.push({ canonicalField: 'state',         questionText: 'What state do you live in?',         value: primaryAddress.state });
    if (primaryAddress.zipCode) entries.push({ canonicalField: 'zip_code',      questionText: 'What is your ZIP code?',             value: primaryAddress.zipCode });
    if (primaryAddress.country) entries.push({ canonicalField: 'country',       questionText: 'What country do you live in?',       value: primaryAddress.country });
  }

  // ── Professional links ───────────────────────────────────────────────────
  if (p.professional?.linkedin)  entries.push({ canonicalField: 'linkedin',  questionText: 'What is your LinkedIn profile URL?',    value: p.professional.linkedin });
  if (p.professional?.github)    entries.push({ canonicalField: 'github',    questionText: 'What is your GitHub profile URL?',      value: p.professional.github });
  if (p.professional?.portfolio) entries.push({ canonicalField: 'portfolio', questionText: 'What is your portfolio or website URL?', value: p.professional.portfolio });

  if (p.professional?.yearsOfExperience != null) {
    entries.push({ canonicalField: 'years_of_experience', questionText: 'How many years of experience do you have?', value: String(p.professional.yearsOfExperience) });
  }
  if (p.professional?.salaryExpectation) {
    entries.push({ canonicalField: 'salary_expectation', questionText: 'What is your expected salary?', value: p.professional.salaryExpectation });
  }
  if (p.professional?.noticePeriod) {
    entries.push({ canonicalField: 'notice_period', questionText: 'What is your notice period?', value: p.professional.noticePeriod });
  }

  // ── Work history — only dated, deduplicated entries ──────────────────────
  // A "real" job entry has at least a startDate. Sub-responsibility bullets
  // extracted by the LLM parser have no dates and should not be seeded.
  const seen = new Set<string>();
  const datedJobs = (p.work ?? []).filter(w => w.startDate);
  for (const job of datedJobs) {
    const key = `${job.company}|${job.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
  }

  // Pick the most recent dated job as the canonical current_role / current_company
  const latestJob = datedJobs[0];
  if (latestJob?.title)   entries.push({ canonicalField: 'current_role',    questionText: 'What is your current job title?',                  value: latestJob.title });
  if (latestJob?.company) entries.push({ canonicalField: 'current_company', questionText: 'What is your current or most recent employer?',    value: latestJob.company });

  // ── Work authorization ────────────────────────────────────────────────────
  if (p.workAuth) {
    entries.push({ canonicalField: 'requires_sponsorship', questionText: 'Do you require visa sponsorship?',                               value: p.workAuth.requiresSponsorship ? 'Yes' : 'No' });
    entries.push({ canonicalField: 'legally_authorized',   questionText: 'Are you legally authorized to work in the United States?',       value: p.workAuth.legallyAuthorized ? 'Yes' : 'No' });
    if (p.workAuth.currentStatus)        entries.push({ canonicalField: 'immigration_status',    questionText: 'What is your current immigration or work authorization status?', value: p.workAuth.currentStatus });
    if (p.workAuth.visaType)             entries.push({ canonicalField: 'visa_type',             questionText: 'What type of visa do you hold?',                                value: p.workAuth.visaType });
    if (p.workAuth.sponsorshipTimeline)  entries.push({ canonicalField: 'sponsorship_timeline',  questionText: 'When would you need sponsorship?',                              value: p.workAuth.sponsorshipTimeline });
  }

  // ── Identity documents (DS-160, DMV, TSA PreCheck, ESTA, etc.) ──────────
  if (p.identity) {
    const id = p.identity;
    if (id.dateOfBirth)          entries.push({ canonicalField: 'date_of_birth',           questionText: 'What is your date of birth?',                         value: id.dateOfBirth });
    if (id.placeOfBirth)         entries.push({ canonicalField: 'place_of_birth',          questionText: 'What is your place of birth?',                        value: id.placeOfBirth });
    if (id.nationality)          entries.push({ canonicalField: 'nationality',             questionText: 'What is your nationality?',                            value: id.nationality });
    if (id.countryOfBirth)       entries.push({ canonicalField: 'country_of_birth',        questionText: 'What is your country of birth?',                      value: id.countryOfBirth });
    if (id.passportNumber)       entries.push({ canonicalField: 'passport_number',         questionText: 'What is your passport number?',                       value: id.passportNumber });
    if (id.passportCountry)      entries.push({ canonicalField: 'passport_country',        questionText: 'Which country issued your passport?',                  value: id.passportCountry });
    if (id.passportExpiryDate)   entries.push({ canonicalField: 'passport_expiry',         questionText: 'When does your passport expire?',                     value: id.passportExpiryDate });
    if (id.passportIssueDate)    entries.push({ canonicalField: 'passport_issue_date',     questionText: 'When was your passport issued?',                      value: id.passportIssueDate });
    if (id.ssnLast4)             entries.push({ canonicalField: 'ssn_last4',               questionText: 'What are the last 4 digits of your Social Security Number?', value: id.ssnLast4 });
    if (id.driversLicenseNumber) entries.push({ canonicalField: 'drivers_license_number',  questionText: "What is your driver's license number?",               value: id.driversLicenseNumber });
    if (id.driversLicenseState)  entries.push({ canonicalField: 'drivers_license_state',   questionText: "Which state issued your driver's license?",           value: id.driversLicenseState });
    if (id.driversLicenseExpiry) entries.push({ canonicalField: 'drivers_license_expiry',  questionText: "When does your driver's license expire?",             value: id.driversLicenseExpiry });
  }

  // ── Emergency contacts ────────────────────────────────────────────────────
  const ec = p.emergencyContacts?.[0];
  if (ec) {
    if (ec.name)         entries.push({ canonicalField: 'emergency_contact_name',         questionText: 'Emergency contact name?',                  value: ec.name });
    if (ec.relationship) entries.push({ canonicalField: 'emergency_contact_relationship', questionText: 'Emergency contact relationship?',           value: ec.relationship });
    if (ec.phone)        entries.push({ canonicalField: 'emergency_contact_phone',        questionText: 'Emergency contact phone number?',          value: ec.phone });
    if (ec.email)        entries.push({ canonicalField: 'emergency_contact_email',        questionText: 'Emergency contact email address?',         value: ec.email });
  }

  // ── Skills & summary ─────────────────────────────────────────────────────
  if (p.skills?.length) {
    entries.push({ canonicalField: 'skills', questionText: 'What are your key skills?', value: p.skills.join(', ') });
  }
  if (p.summary) {
    entries.push({ canonicalField: 'summary', questionText: 'Please provide a brief professional summary.', value: p.summary });
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
    await graphMemory.flushSave();
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
