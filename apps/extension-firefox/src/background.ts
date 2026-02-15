/**
 * Background script for managing Ollama communication and relaying events
 */

import type { ApplyEvent, TabJobInfo, JobApplication } from './shared/types';
import { getSettings, setTabJobInfo, addJobApplication } from './shared/storage';
import { log, info, warn, error } from './shared/log';
import { sendDailySummary } from './shared/whatsapp';
import { mastraAgent as ollama } from './shared/mastra-agent';
import { ragParser } from './shared/rag-parser';

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
      
      try {
        // Check if user wants RAG parsing (default: true for better accuracy)
        const useRAG = (message as any).useRAG !== false; // Default to RAG
        
        let profile: any;
        
        if (useRAG) {
          info('Using RAG-based parsing for higher accuracy...');
          
          // Parse with RAG
          profile = await ragParser.parseResume(resumeText, (stage, percent) => {
            info(`RAG parsing: ${stage} (${percent}%)`);
          });
          
          info('Successfully parsed profile with RAG');
        } else {
          info('Using legacy chunking parser...');
          
          // Fallback to legacy parser
          profile = await ollama.parseResume(resumeText, (stage, percent) => {
            info(`Parsing progress: ${stage} (${percent}%)`);
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
        
        let messageText = err instanceof Error ? err.message : 'Failed to parse resume';
        if (messageText.includes('403') || messageText.includes('Forbidden')) {
          messageText += ' Ollama is blocking the extension. Restart Ollama with: OLLAMA_ORIGINS=\'moz-extension://*\' ollama serve (see OLLAMA_CORS_FIX.md)';
        }
        
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
      
      // Track application for daily summary
      if (event.jobMeta.jobTitle && event.jobMeta.company) {
        const app: JobApplication = {
          jobTitle: event.jobMeta.jobTitle,
          company: event.jobMeta.company,
          url: event.jobMeta.url,
          atsHint: event.jobMeta.atsHint,
          timestamp: Date.now(),
          status: event.eventType === 'SUBMIT_ATTEMPT' ? 'submitted' : 'detected',
        };
        await addJobApplication(app);
        log(`Tracked ${app.status} application:`, app.jobTitle, 'at', app.company);
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
      
      return {
        kind: 'STATE_UPDATE',
        enabled: settings.enabled,
        dryRun: settings.dryRun,
        nativeHostConnected: connectionState.connected,
        lastError: connectionState.lastError,
        lastJob,
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
    title: 'Offlyn AI',
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
  if (!action) return;

  info(`Context menu: "${action}" on tab ${tab.id}`);

  // Send message to the content script in the active tab / frame
  browser.tabs.sendMessage(tab.id, {
    kind: 'TEXT_TRANSFORM',
    action,
  }, menuInfo.frameId != null ? { frameId: menuInfo.frameId } : undefined);
});

// ── Init ───────────────────────────────────────────────────────────────────

/**
 * Initialize background script
 */
async function init(): Promise<void> {
  log('Background script initializing...');
  
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
