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
      const tabId = sender.tab?.id;
      let lastJob = null;
      
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

/**
 * Initialize background script
 */
async function init(): Promise<void> {
  log('Background script initializing...');
  
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
