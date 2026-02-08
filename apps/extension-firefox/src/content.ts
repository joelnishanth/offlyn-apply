/**
 * Content script for detecting job application pages and filling forms
 */

import type { ApplyEvent, FillPlan, FillResult, JobMeta, FieldSchema } from './shared/types';
import { extractJobMetadata, extractFormSchema, isJobApplicationPage } from './shared/dom';
import { log, info, warn, error } from './shared/log';
import { showFieldSummary, hideFieldSummary } from './ui/field-summary';
import { getUserProfile } from './shared/profile';
import { generateFillMappings } from './shared/autofill';
import { 
  analyzeUnfilledFields, 
  buildFieldAnalysisPrompt,
  suggestSelfIdMatches,
  analyzeUnmatchedSelfIdFields,
  type UnfilledField
} from './shared/smart-autofill';
import {
  checkOllamaConnection,
  analyzeFieldsWithOllama,
  inferFieldValue
} from './shared/ollama-service';
import {
  buildBrowserUseActionsFromEmbeddings,
  type BrowserUseAction
} from './shared/browser-use-actions';
import {
  validateFieldValue,
  type ValidationResult
} from './shared/field-validator';
import { learningSystem } from './shared/learning-system';
import { 
  generateBatchSuggestions, 
  filterSuggestionsByConfidence,
  getPrimarySuggestions,
  type FieldSuggestion
} from './shared/suggestion-service';
import { 
  showSuggestionPanel, 
  hideSuggestionPanel,
  isSuggestionPanelVisible
} from './ui/suggestion-panel';
import { getContextualStorage, migrateProfileToContextual } from './shared/context-aware-storage';
import {
  highlightFieldAsFilling,
  highlightFieldAsSuccess,
  highlightFieldAsError,
  showFieldLabel,
  clearAllHighlights
} from './ui/field-highlighter';
import { showNotification, showSuccess, showError, showWarning, showInfo } from './ui/notification';
import { showProgress, updateProgress, hideProgress, showProgressComplete } from './ui/progress-indicator';

let lastJobMeta: JobMeta | null = null;
let lastSchema: string | null = null;
let resumeFilesUploaded: Set<string> = new Set(); // Track which file inputs we've already filled
let filledSelectors: Set<string> = new Set(); // Track which fields have been filled
let userEditedFields: Set<string> = new Set(); // Track which fields user has manually edited
let allDetectedFields: ReturnType<typeof extractFormSchema> = []; // Store all detected fields
let autofillInProgress = false; // Flag to prevent overwriting during autofill
let autoFilledValues: Map<string, { field: FieldSchema; value: string | boolean }> = new Map(); // Track what we auto-filled

/**
 * Generate a simple hash of the schema for change detection
 */
function hashSchema(schema: unknown[]): string {
  return JSON.stringify(schema).length.toString();
}

/**
 * Send event to background script
 */
async function sendToBackground(event: ApplyEvent): Promise<void> {
  try {
    await browser.runtime.sendMessage(event);
  } catch (err) {
    error('Failed to send message to background:', err);
  }
}

/**
 * Setup listeners to track user edits and learn from corrections
 */
function setupUserEditTracking(): void {
  // Track when user manually changes fields
  document.addEventListener('input', (e) => {
    if (autofillInProgress) return; // Ignore events during autofill
    
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || 
        target instanceof HTMLTextAreaElement || 
        target instanceof HTMLSelectElement) {
      
      // Get selector for this field
      const selector = generateFieldSelector(target);
      if (selector) {
        userEditedFields.add(selector);
        log(`User edited field: ${selector}`);
        
        // Check if this was an auto-filled field - record correction
        recordUserCorrection(selector, target);
      }
    }
  }, true);

  // Also track on change event for dropdowns/checkboxes
  document.addEventListener('change', (e) => {
    if (autofillInProgress) return;
    
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || 
        target instanceof HTMLSelectElement) {
      
      const selector = generateFieldSelector(target);
      if (selector) {
        userEditedFields.add(selector);
        log(`User changed field: ${selector}`);
        
        // Record correction
        recordUserCorrection(selector, target);
      }
    }
  }, true);
}

/**
 * Record user correction for learning
 */
async function recordUserCorrection(
  selector: string,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): Promise<void> {
  // Check if we auto-filled this field
  const autoFilled = autoFilledValues.get(selector);
  if (!autoFilled) {
    return; // We didn't auto-fill this, so no correction to learn
  }

  // Get current (user-corrected) value
  const userValue = getFieldValue(element);
  
  // Skip if user didn't actually change it
  if (String(userValue) === String(autoFilled.value)) {
    return;
  }

  info(`[Learning] User corrected "${autoFilled.field.label}": "${autoFilled.value}" → "${userValue}"`);

  // Record the correction
  try {
    await learningSystem.recordCorrection(
      autoFilled.field,
      autoFilled.value,
      userValue,
      {
        url: window.location.href,
        company: lastJobMeta?.company,
        jobTitle: lastJobMeta?.jobTitle,
      }
    );
    
    // Remove from auto-filled tracking (already learned from)
    autoFilledValues.delete(selector);
  } catch (err) {
    error('[Learning] Failed to record correction:', err);
  }
}

/**
 * Generate a selector for a field
 */
function generateFieldSelector(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string | null {
  if (field.id) return `#${field.id}`;
  if (field.name) return `[name="${field.name}"]`;
  
  // Try to generate a unique selector
  try {
    const parent = field.closest('form, div, fieldset');
    if (parent) {
      const index = Array.from(parent.querySelectorAll(field.tagName)).indexOf(field);
      return `${field.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
    }
  } catch (e) {
    // Fallback
  }
  
  return null;
}

/**
 * Detect job application page and extract metadata
 */
function detectPage(): void {
  try {
    console.log('[Offlyn] detectPage() called');
    console.log('[Offlyn] URL:', window.location.href);
    
    const isJobPage = isJobApplicationPage();
    console.log('[Offlyn] isJobApplicationPage():', isJobPage);
    
    if (!isJobPage) {
      console.warn('[Offlyn] Page does not appear to be a job application page');
      return;
    }
    
    console.log('[Offlyn] ✓ Detected as job application page!');
    
    const jobMeta = extractJobMetadata();
    const forms = Array.from(document.querySelectorAll('form'));
    
    // Extract schema from all forms
    const allFields: ReturnType<typeof extractFormSchema> = [];
    
    if (forms.length > 0) {
      for (const form of forms) {
        const fields = extractFormSchema(form);
        allFields.push(...fields);
      }
    } else {
      // No forms found, scan entire document for form fields
      // This handles single-page apps and custom form implementations
      info('No <form> elements found, scanning entire document');
      const fields = extractFormSchema(document);
      allFields.push(...fields);
    }
    
    if (allFields.length === 0) {
      info('No form fields found yet');
      
      // Check for iframes (SmartRecruiters might use one)
      const iframes = document.querySelectorAll('iframe');
      if (iframes.length > 0) {
        warn(`Found ${iframes.length} iframe(s) - fields might be inside iframe (not accessible due to browser security)`);
        iframes.forEach((iframe, i) => {
          info(`  iframe ${i}: ${iframe.src || 'about:blank'}`);
        });
      }
      
      // Check for shadow DOM elements
      const shadowHosts = document.querySelectorAll('*');
      let hasShadowDOM = false;
      shadowHosts.forEach(el => {
        if (el.shadowRoot) {
          hasShadowDOM = true;
        }
      });
      
      if (hasShadowDOM) {
        error('Shadow DOM detected! Fields are hidden inside web components and not accessible.');
        error('This is a limitation of browser extensions - we cannot access Shadow DOM content.');
      }
      
      // Show a hint to the user
      const applyButtons = Array.from(document.querySelectorAll('button, a')).filter(
        btn => /apply|start application|submit application/i.test(btn.textContent || '')
      );
      
      if (applyButtons.length > 0) {
        info(`Found ${applyButtons.length} "Apply" button(s) - waiting for form to load after click`);
      }
      
      // Don't return - keep monitoring for fields to appear
      return;
    }
    
    info(`Detected ${allFields.length} form fields`);
    
    // Deduplicate fields by selector
    const uniqueFields = Array.from(
      new Map(allFields.map(field => [field.selector, field])).values()
    );
    
    info(`After deduplication: ${uniqueFields.length} unique fields`);
    
    const schemaHash = hashSchema(uniqueFields);
    
    // Only send if metadata or schema changed
    if (schemaHash !== lastSchema || JSON.stringify(jobMeta) !== JSON.stringify(lastJobMeta)) {
      lastJobMeta = jobMeta;
      lastSchema = schemaHash;
      
      // Store detected fields globally
      allDetectedFields = uniqueFields;
      
      const event: ApplyEvent = {
        kind: 'JOB_APPLY_EVENT',
        eventType: 'PAGE_DETECTED',
        jobMeta,
        schema: uniqueFields,
        timestamp: Date.now(),
      };
      
      info('Detected job application page:', jobMeta.jobTitle || 'Unknown');
      sendToBackground(event);
      
      // Show field summary UI with detected fields
      showFieldSummary(uniqueFields, jobMeta.jobTitle || undefined, jobMeta.company || undefined);
      
      // Don't auto-fill automatically - wait for user to trigger it
      // tryAutoFill(uniqueFields);
    }
  } catch (err) {
    error('Error in page detection:', err);
  }
}

/**
 * Try to auto-fill form with user profile
 */
async function tryAutoFill(schema: ReturnType<typeof extractFormSchema>): Promise<void> {
  try {
    const profile = await getUserProfile();
    if (!profile) {
      warn('⚠️ No user profile found. Please set up your profile first.');
      showNotification('No profile found', 'Please set up your profile in the extension popup.', 'warning');
      return;
    }
    
    // Store all detected fields for smart autofill
    allDetectedFields = schema;
    
    // Migrate existing profile to contextual storage if needed
    try {
      await migrateProfileToContextual(profile);
    } catch (err) {
      warn('Failed to migrate profile to contextual storage:', err);
    }
    
    const mappings = generateFillMappings(schema, profile);
    if (mappings.length === 0) {
      info('ℹ️ No fields matched profile data. Try Smart Suggestions instead.');
      showNotification('No matches found', 'No fields could be auto-filled. Try Smart Suggestions for better results.', 'info');
      return;
    }
    
    info(`🚀 Starting auto-fill: ${mappings.length} fields detected`);
    showNotification('Auto-filling form...', `Filling ${mappings.length} fields with your profile data`, 'info');
    
    // Create a fill plan
    const fillPlan: FillPlan = {
      kind: 'FILL_PLAN',
      requestId: `autofill_${Date.now()}`,
      mappings,
      dryRun: false, // Will check settings
    };
    
    // Execute immediately (settings will be checked in executeFillPlan)
    await executeFillPlan(fillPlan);
    
    // Also try to fill resume file inputs
    fillResumeFileInputs();
    
    // After basic autofill, offer smart suggestions for remaining fields
    const unfilledCount = allDetectedFields.length - filledSelectors.size;
    if (unfilledCount > 0) {
      info(`ℹ️ ${unfilledCount} fields remain unfilled. Consider using Smart Suggestions.`);
    }
  } catch (err) {
    error('Error in auto-fill:', err);
    showError('Auto-fill Error', 'An error occurred during auto-fill. Please try again.', 5000);
  }
}

/**
 * Try smart suggestions - show suggestion panel instead of auto-filling
 * This is similar to superfill.ai's approach: suggest appropriate answers
 */
async function trySmartSuggestions(): Promise<void> {
  try {
    const profile = await getUserProfile();
    if (!profile) {
      log('No profile for smart suggestions');
      return;
    }
    
    // Check if AI is available for better suggestions
    const ollamaAvailable = await checkOllamaConnection();
    
    // Get unfilled fields
    const unfilledFields = analyzeUnfilledFields(allDetectedFields, filledSelectors);
    
    if (unfilledFields.length === 0) {
      info('All fields filled! No suggestions needed.');
      return;
    }
    
    info(`Generating smart suggestions for ${unfilledFields.length} unfilled fields...`);
    
    // Generate suggestions for unfilled fields
    const suggestions = await generateBatchSuggestions(
      unfilledFields.map(f => f.field),
      profile,
      {
        company: lastJobMeta?.company,
        jobTitle: lastJobMeta?.jobTitle,
        url: window.location.href
      },
      ollamaAvailable // Use AI if available
    );
    
    // Filter by confidence
    const highConfidenceSuggestions = filterSuggestionsByConfidence(suggestions, 0.6);
    
    if (highConfidenceSuggestions.length === 0) {
      info('No high-confidence suggestions found');
      return;
    }
    
    info(`Generated ${highConfidenceSuggestions.length} high-confidence suggestions`);
    
    // Show suggestion panel
    showSuggestionPanel(
      highConfidenceSuggestions,
      async (selections) => {
        console.log('[Suggestions] onApply callback invoked!');
        console.log('[Suggestions] Total selections to apply:', selections.size);
        info(`Applying ${selections.size} selected suggestions`);
        
        let successCount = 0;
        let failCount = 0;
        let currentIndex = 0;
        
        // Convert Map to array to track progress
        const selectionsArray = Array.from(selections.entries());
        console.log('[Suggestions] Selections array created, length:', selectionsArray.length);
        
        // Apply selected suggestions
        for (const [selector, option] of selectionsArray) {
          currentIndex++;
          console.log(`[Suggestions] ==== Processing ${currentIndex}/${selectionsArray.length} ====`);
          
          try {
            console.log(`[Suggestions] Attempting to apply: ${selector} = ${option.value}`);
            const field = allDetectedFields.find(f => f.selector === selector);
            if (!field) {
              console.warn(`[Suggestions] Field not found for selector: ${selector}`);
              failCount++;
              continue;
            }
            
            console.log(`[Suggestions] Field found:`, field.label, field.type);
            console.log(`[Suggestions] About to call fillFieldWithValue...`);
            
            await fillFieldWithValue(selector, option.value, field.label || 'Field');
            
            console.log(`[Suggestions] fillFieldWithValue completed successfully`);
            
            // Track for learning
            autoFilledValues.set(selector, {
              field,
              value: option.value
            });
            
            info(`✓ Applied suggestion: ${field.label} = ${option.value}`);
            successCount++;
            console.log(`[Suggestions] Success count now: ${successCount}`);
          } catch (err) {
            warn(`Failed to apply suggestion for ${selector}:`, err);
            console.error(`[Suggestions] Error applying suggestion:`, err);
            console.error(`[Suggestions] Error stack:`, err.stack);
            failCount++;
          }
          
          console.log(`[Suggestions] ==== Completed ${currentIndex}/${selectionsArray.length}, moving to next ====`);
        }
        
        console.log('[Suggestions] Loop completed!');
        info(`Successfully applied ${successCount} suggestions, ${failCount} failed`);
        
        // Show notification
        if (successCount > 0) {
          showNotification(`✓ Applied ${successCount} suggestion${successCount > 1 ? 's' : ''}!`, 'success');
        }
        if (failCount > 0) {
          showNotification(`⚠️ Failed to apply ${failCount} suggestion${failCount > 1 ? 's' : ''}`, 'warning');
        }
      },
      () => {
        info('User dismissed suggestion panel');
      }
    );
  } catch (err) {
    error('Error in smart suggestions:', err);
  }
}

/**
 * Smart autofill using Ollama for unfilled fields
 */
async function trySmartAutoFill(): Promise<void> {
  try {
    const profile = await getUserProfile();
    if (!profile) {
      log('No profile for smart autofill');
      return;
    }

    // Analyze unfilled fields
    const unfilledFields = analyzeUnfilledFields(allDetectedFields, filledSelectors);
    
    if (unfilledFields.length === 0) {
      info('All fields filled! No smart autofill needed.');
      return;
    }

    info(`Found ${unfilledFields.length} unfilled fields. Attempting smart autofill...`);

    // First, try improved Self-ID matching with fuzzy logic
    const selfIdFields = analyzeUnmatchedSelfIdFields(unfilledFields, profile);
    if (selfIdFields.length > 0) {
      info(`Attempting to fill ${selfIdFields.length} Self-ID fields with fuzzy matching`);
      const selfIdSuggestions = suggestSelfIdMatches(selfIdFields, profile);
      
      for (const suggestion of selfIdSuggestions) {
        if (suggestion.confidence > 0.6) {
          try {
            const element = document.querySelector(suggestion.selector);
            if (element instanceof HTMLInputElement && element.type === 'checkbox') {
              element.checked = true;
              element.dispatchEvent(new Event('change', { bubbles: true }));
              filledSelectors.add(suggestion.selector);
              info(`✓ Filled Self-ID field: ${suggestion.reasoning}`);
            }
          } catch (err) {
            warn(`Failed to fill Self-ID field ${suggestion.selector}:`, err);
          }
        }
      }
    }

    // Check if Ollama is available for remaining fields
    const ollamaAvailable = await checkOllamaConnection();
    if (!ollamaAvailable) {
      warn('Ollama not available. Skipping AI-powered smart autofill.');
      warn(`Still have ${unfilledFields.length - selfIdFields.length} unfilled fields.`);
      showUnfilledFieldsNotification(unfilledFields.length - selfIdFields.length);
      return;
    }

    info('Ollama connected! Using AI to analyze remaining fields...');

    // Get remaining unfilled fields after Self-ID pass
    const remainingUnfilled = analyzeUnfilledFields(allDetectedFields, filledSelectors);
    
    if (remainingUnfilled.length === 0) {
      info('All fields filled after Self-ID matching!');
      return;
    }

    // Use Ollama to analyze fields (limit to 10 at a time to avoid overwhelming)
    const fieldsToAnalyze = remainingUnfilled.slice(0, 10);
    
    for (const unfilled of fieldsToAnalyze) {
      try {
        // Skip if user has edited this field
        if (userEditedFields.has(unfilled.field.selector)) {
          info(`Skipping ${unfilled.field.selector} - user has edited`);
          continue;
        }
        
        // Check learning system first (faster than AI)
        let value: string | null = null;
        try {
          const suggestion = await learningSystem.suggestValue(
            unfilled.field,
            '', // No proposed value yet
            {
              url: window.location.href,
              company: lastJobMeta?.company,
            }
          );
          
          // Only use learning when it suggests a non-empty value — never overwrite with empty
          const suggestedStr = suggestion?.suggestedValue != null ? String(suggestion.suggestedValue).trim() : '';
          if (suggestion && suggestion.confidence > 0.7 && suggestedStr !== '') {
            info(`[Learning] Using learned value for "${unfilled.context.label}": "${suggestion.suggestedValue}"`);
            value = String(suggestion.suggestedValue);
          }
        } catch (err) {
          // Learning failed, continue to AI inference
        }
        
        // If no learned value, infer using AI
        if (!value) {
          value = await inferFieldValue(
            unfilled.context.label,
            unfilled.context.fieldType,
            unfilled.context.nearbyText,
            {
              personal: profile.personal,
              professional: profile.professional,
              skills: profile.skills,
              work: profile.work.slice(0, 2), // Limit work history
              education: profile.education.slice(0, 2), // Limit education
              summary: profile.summary
            },
            unfilled.context.options
          );
        }

        if (value) {
          // Validate the value before filling
          const validation = await validateFieldValue(
            unfilled.field,
            value,
            profile,
            true // Use Ollama for validation
          );

          if (!validation.isValid) {
            warn(`Validation failed for "${unfilled.context.label}": ${validation.reason}`);
            
            // Try suggested value if available
            if (validation.suggestedValue) {
              info(`Using suggested value: ${validation.suggestedValue}`);
              const validationRetry = await validateFieldValue(
                unfilled.field,
                validation.suggestedValue,
                profile,
                false // Skip Ollama for retry
              );
              
              if (validationRetry.isValid) {
                await fillFieldWithValue(unfilled.field.selector, validation.suggestedValue, unfilled.context.label);
              }
            }
            continue;
          }
          
          // Low confidence - log warning but still fill
          if (validation.confidence < 0.7) {
            warn(`Low confidence (${validation.confidence}) for "${unfilled.context.label}": ${value}`);
          }
          
          // Fill the field
          await fillFieldWithValue(unfilled.field.selector, value, unfilled.context.label);
          
          // Track for learning
          autoFilledValues.set(unfilled.field.selector, {
            field: unfilled.field,
            value,
          });
        }
      } catch (err) {
        warn(`Failed to AI-fill field ${unfilled.field.selector}:`, err);
      }
    }

    // Show notification about remaining unfilled fields
    const finalUnfilled = analyzeUnfilledFields(allDetectedFields, filledSelectors);
    if (finalUnfilled.length > 0) {
      info(`Smart autofill complete. ${finalUnfilled.length} fields still require manual attention.`);
      showUnfilledFieldsNotification(finalUnfilled.length);
    } else {
      info('✅ All fields successfully filled!');
    }

  } catch (err) {
    error('Error in smart autofill:', err);
  }
}

/**
 * Show notification about unfilled fields
 */
function showUnfilledFieldsNotification(count: number): void {
  // Could show a banner or update the field summary panel
  info(`ℹ️ ${count} field(s) still need your attention. Please review and fill manually.`);
}

/**
 * Listen for refresh scan events from the UI
 */
window.addEventListener('offlyn-refresh-scan', () => {
  // Don't hide the panel - just update it with new data
  detectPage();
});

window.addEventListener('offlyn-browser-use-fill', () => {
  if (allDetectedFields.length > 0) {
    tryBrowserUseFill(allDetectedFields);
  } else {
    warn('[Browser-Use] No detected fields. Refresh the scan first.');
  }
});

/**
 * Listen for smart suggestions trigger
 */
window.addEventListener('offlyn-show-suggestions', () => {
  if (allDetectedFields.length > 0) {
    info('Manual trigger: showing smart suggestions');
    trySmartSuggestions();
  } else {
    warn('[Suggestions] No detected fields. Refresh the scan first.');
  }
});

/**
 * Listen for manual autofill trigger
 */
window.addEventListener('offlyn-manual-autofill', async () => {
  if (allDetectedFields.length > 0) {
    info('Manual trigger: starting autofill with highlighting');
    await tryAutoFill(allDetectedFields);
  } else {
    warn('[Autofill] No detected fields. Refresh the scan first.');
  }
});

/**
 * Handle submit/apply button clicks
 */
function handleSubmitAttempt(e: Event): void {
  try {
    const target = e.target as HTMLElement;
    const text = target.textContent || target.getAttribute('value') || '';
    const applyPattern = /apply|submit|next|continue/i;
    
    if (!applyPattern.test(text)) {
      return;
    }
    
    const jobMeta = lastJobMeta || extractJobMetadata();
    const forms = Array.from(document.querySelectorAll('form'));
    const allFields: ReturnType<typeof extractFormSchema> = [];
    for (const form of forms) {
      const fields = extractFormSchema(form);
      allFields.push(...fields);
    }
    
    const event: ApplyEvent = {
      kind: 'JOB_APPLY_EVENT',
      eventType: 'SUBMIT_ATTEMPT',
      jobMeta,
      schema: allFields,
      timestamp: Date.now(),
    };
    
    info('Submit attempt detected');
    sendToBackground(event);
  } catch (err) {
    error('Error handling submit attempt:', err);
  }
}

/**
 * Auto-fill resume file inputs
 */
async function fillResumeFileInputs(): Promise<void> {
  try {
    // Get stored resume file
    const storage = await browser.storage.local.get('resumeFile');
    const resumeFile = storage.resumeFile;
    
    if (!resumeFile || !resumeFile.data) {
      log('No resume file stored for auto-upload');
      return;
    }
    
    // Find file input fields that might be for resume upload
    const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    
    if (fileInputs.length === 0) {
      return;
    }
    
    info(`Found ${fileInputs.length} file input(s), attempting resume upload`);
    
    for (const fileInput of fileInputs) {
      try {
        // Generate unique identifier for this input
        const inputId = fileInput.id || fileInput.name || fileInput.outerHTML;
        
        // Check if we've already uploaded to this input
        if (resumeFilesUploaded.has(inputId)) {
          log(`Already uploaded resume to this input: ${fileInput.name || fileInput.id}`);
          continue;
        }
        
        // Check if this is likely a resume upload field
        const label = fileInput.labels?.[0]?.textContent?.toLowerCase() || '';
        const placeholder = fileInput.placeholder?.toLowerCase() || '';
        const name = fileInput.name?.toLowerCase() || '';
        const id = fileInput.id?.toLowerCase() || '';
        const accept = fileInput.accept?.toLowerCase() || '';
        
        const isResumeField = 
          label.includes('resume') || label.includes('cv') ||
          placeholder.includes('resume') || placeholder.includes('cv') ||
          name.includes('resume') || name.includes('cv') ||
          id.includes('resume') || id.includes('cv') ||
          accept.includes('pdf') || accept.includes('doc');
        
        if (!isResumeField) {
          log(`Skipping file input (doesn't appear to be for resume): ${fileInput.name || fileInput.id}`);
          continue;
        }
        
        // Check if already has a file
        if (fileInput.files && fileInput.files.length > 0) {
          log(`File input already has a file: ${fileInput.name || fileInput.id}`);
          continue;
        }
        
        // Convert stored array back to Uint8Array and create File
        const uint8Array = new Uint8Array(resumeFile.data);
        const blob = new Blob([uint8Array], { type: resumeFile.type });
        const file = new File([blob], resumeFile.name, { type: resumeFile.type });
        
        // Create DataTransfer to set files
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        
        // Dispatch events
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Mark this input as filled
        resumeFilesUploaded.add(inputId);
        
        info(`Auto-uploaded resume to: ${fileInput.name || fileInput.id || 'file input'}`);
      } catch (err) {
        error('Failed to fill file input:', err);
      }
    }
  } catch (err) {
    error('Error in fillResumeFileInputs:', err);
  }
}

/**
 * Execute fill plan on form fields
 */
async function executeFillPlan(plan: FillPlan): Promise<void> {
  autofillInProgress = true; // Set flag to prevent tracking our own fills as user edits
  
  const result: FillResult = {
    kind: 'FILL_RESULT',
    requestId: plan.requestId,
    filledCount: 0,
    failedSelectors: [],
    timestamp: Date.now(),
  };
  
  // Clear any existing highlights
  clearAllHighlights();
  
  // Show progress indicator
  showProgress(plan.mappings.length);
  
  // Small delay to ensure page is ready
  await new Promise(resolve => setTimeout(resolve, 300));
  
  let processedCount = 0;
  
  for (const mapping of plan.mappings) {
    processedCount++;
    
    // Highlight field as being filled
    highlightFieldAsFilling(mapping.selector);
    try {
      // Check if this is a shadow DOM selector
      let element: Element | null = null;
      
      if (mapping.selector.includes('::shadow::')) {
        // Parse shadow DOM selector
        const [hostSelector, fieldSelector] = mapping.selector.split('::shadow::');
        const host = document.querySelector(hostSelector);
        
        if (host && host.shadowRoot) {
          element = host.shadowRoot.querySelector(fieldSelector);
          if (element) {
            console.log('[Offlyn] Found field in Shadow DOM:', hostSelector);
          }
        }
      } else {
        // Standard DOM query
        element = document.querySelector(mapping.selector);
      }
      
      if (!element) {
        result.failedSelectors.push(mapping.selector);
        warn(`Selector not found: ${mapping.selector}`);
        continue;
      }
      
      // Skip if user has manually edited this field
      if (userEditedFields.has(mapping.selector)) {
        info(`Skipping ${mapping.selector} - user has edited this field`);
        continue;
      }
      
      // Skip if field already has a value (don't overwrite)
      const currentValue = getFieldValue(element);
      if (currentValue && currentValue.trim() !== '') {
        info(`Skipping ${mapping.selector} - field already has value: ${currentValue}`);
        continue;
      }
      
      // Find the field schema for this selector
      const fieldSchema = allDetectedFields.find(f => f.selector === mapping.selector);

      // Skip duplicate placeholder inputs — same dropdown is the autocomplete field with id/options
      const isPlaceholderDuplicate =
        fieldSchema &&
        fieldSchema.type === 'text' &&
        !fieldSchema.id &&
        (fieldSchema.label === 'Select...' ||
         fieldSchema.label === 'Select' ||
         fieldSchema.label === 'No options' ||
         fieldSchema.label?.includes('Decline To Self Identify') || // e.g. "MaleFemaleDecline To Self Identify"
         fieldSchema.label?.includes('YesNo')); // e.g. "YesNoDecline To Self Identify"
      if (isPlaceholderDuplicate) {
        continue;
      }

      // Query learning system for suggestions
      let finalValue = mapping.value;
      if (fieldSchema) {
        try {
          const suggestion = await learningSystem.suggestValue(
            fieldSchema,
            mapping.value,
            {
              url: window.location.href,
              company: lastJobMeta?.company,
            }
          );
          
          // Only apply learning when it suggests a non-empty value — never overwrite profile with empty
          const suggestedStr = suggestion?.suggestedValue != null ? String(suggestion.suggestedValue).trim() : '';
          if (suggestion && suggestion.confidence > 0.6 && suggestedStr !== '') {
            info(`[Learning] Using learned value for "${fieldSchema.label}": "${suggestion.suggestedValue}" (${suggestion.reason})`);
            finalValue = suggestion.suggestedValue;
          }
        } catch (err) {
          // Learning failed, use original value
          warn('[Learning] Failed to query suggestions:', err);
        }
      }
      
      if (plan.dryRun) {
        // Just report what would be filled
        log(`[DRY RUN] Would fill ${mapping.selector} with ${mapping.value}`);
        result.filledCount++;
        continue;
      }
      
      // Get field schema to check type and options (for dropdown vs fill)
      const fieldType = fieldSchema?.type;
      const hasOptionsArray = fieldSchema && 'options' in fieldSchema &&
        Array.isArray((fieldSchema as { options?: string[] }).options) &&
        ((fieldSchema as { options?: string[] }).options?.length ?? 0) > 0;

      // Handle Shadow DOM autocomplete/dropdown components (SmartRecruiters, etc.)
      if (mapping.selector.includes('::shadow::') && 
          (fieldType === 'autocomplete' || fieldType === 'select' || 
           fieldSchema?.shadowHost?.toLowerCase().includes('autocomplete'))) {
        console.log('[Offlyn] Filling Shadow DOM dropdown/autocomplete:', mapping.selector, 'with:', finalValue);
        
        // For autocomplete fields, we need to:
        // 1. Set the value
        // 2. Trigger input event (to search)
        // 3. Wait for options to appear
        // 4. Click the matching option
        
        if (element instanceof HTMLInputElement) {
          element.value = String(finalValue);
          element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          
          // Wait a bit for autocomplete to react
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Try to find and click the option in the shadow root
          const [hostSelector] = mapping.selector.split('::shadow::');
          const host = document.querySelector(hostSelector);
          
          if (host && host.shadowRoot) {
            const options = host.shadowRoot.querySelectorAll('[role="option"], li[data-value], .option, [class*="option"]');
            console.log('[Offlyn] Found', options.length, 'options in dropdown');
            
            for (const option of options) {
              const optionText = option.textContent?.trim().toLowerCase();
              const valueText = String(finalValue).toLowerCase();
              
              if (optionText?.includes(valueText) || valueText.includes(optionText || '')) {
                console.log('[Offlyn] ✓ Clicking autocomplete option:', optionText);
                (option as HTMLElement).click();
                await new Promise(resolve => setTimeout(resolve, 100));
                break;
              }
            }
          }
        }
      }
      // Handle regular autocomplete/dropdown fields (Lever, Greenhouse, Discord ATS, etc.)
      else if ((fieldType === 'autocomplete' || hasOptionsArray) && element instanceof HTMLInputElement) {
        console.log('[Offlyn] Handling autocomplete/dropdown field:', mapping.selector);
        console.log('[Offlyn] Field label:', fieldSchema?.label);
        console.log('[Offlyn] Field type:', fieldType, '| Has options:', hasOptionsArray);
        console.log('[Offlyn] Setting value:', finalValue);
        
        // Skip fields with empty values
        if (!finalValue || String(finalValue).trim() === '') {
          console.log('[Offlyn] Skipping field with empty value');
          result.failedSelectors.push(mapping.selector);
          continue;
        }
        
        // Close any lingering dropdowns from previous fields
        document.body.click();
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // If field has known options, validate against them first
        if (hasOptionsArray && fieldSchema && 'options' in fieldSchema) {
          const knownOptions = (fieldSchema as any).options;
          const hasMatch = knownOptions.some((opt: string) => 
            opt.toLowerCase().includes(String(finalValue).toLowerCase()) ||
            String(finalValue).toLowerCase().includes(opt.toLowerCase())
          );
          
          if (!hasMatch) {
            console.warn(`[Offlyn] Value "${finalValue}" not in known options for ${fieldSchema.label}`);
            console.warn('[Offlyn] Known options:', knownOptions.slice(0, 5).join(', '));
            // Skip this field - wrong value for these options
            result.failedSelectors.push(mapping.selector);
            highlightFieldAsError(mapping.selector);
            showFieldLabel(mapping.selector, '✗ Invalid value');
            continue;
          }
        }
        
        // TWO-PHASE APPROACH: Try setting value first, then interact with dropdown if needed
        element.focus();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Phase 1: Set value and dispatch events (works for some ATSs)
        element.value = String(finalValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Wait longer for dropdown to appear (Greenhouse can be slow)
        await new Promise(resolve => setTimeout(resolve, 400));
        
        // Phase 2: Check if dropdown appeared, if so, click the matching option
        // Look for options that are in an active dropdown (parent container is visible)
        const allOptions = document.querySelectorAll(DROPDOWN_OPTION_SELECTORS.join(','));
        
        const visibleOptions = Array.from(allOptions).filter(option => {
          const style = window.getComputedStyle(option);
          
          // Skip if explicitly hidden
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          
          // Check if option or its parent container is part of a visible dropdown
          // Look for parent container with meaningful dimensions
          let current = option.parentElement;
          let hasVisibleParent = false;
          let depth = 0;
          
          while (current && depth < 10) {
            const parentRect = current.getBoundingClientRect();
            const parentStyle = window.getComputedStyle(current);
            
            // If parent has dimensions and is visible, this option is in an active dropdown
            if (parentRect.height > 0 && 
                parentStyle.display !== 'none' && 
                parentStyle.visibility !== 'hidden') {
              hasVisibleParent = true;
              break;
            }
            
            current = current.parentElement;
            depth++;
          }
          
          return hasVisibleParent;
        });
        
        console.log('[Offlyn] Found', visibleOptions.length, 'dropdown options in visible containers (out of', allOptions.length, 'total)');
        
        // Debug: Log all option texts to understand what we're matching against
        if (visibleOptions.length > 0 && visibleOptions.length < 30) {
          console.log('[Offlyn] Available options:', visibleOptions.map(opt => 
            (opt.textContent || '').trim().substring(0, 50)
          ));
        }
        
        if (visibleOptions.length > 0 && visibleOptions.length < 50) { // Sanity check - dropdown shouldn't have 255 options
          let optionClicked = false;
          const valueToMatch = String(finalValue).toLowerCase().trim();
          
          // Skip if value is empty
          if (!valueToMatch) {
            console.log('[Offlyn] Skipping empty value - using Enter key');
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 100));
            element.blur();
          } else {
            // Try to find and click matching option
            for (const option of visibleOptions) {
              const optionText = (option.textContent || '').toLowerCase().trim();
              
              // Debug: Log each option we're checking
              console.log('[Offlyn] Checking option:', optionText.substring(0, 50), 'against:', valueToMatch);
              
              // Skip empty or very short options
              if (optionText.length < 2) continue;
              
              // Skip container elements that show "options: ..." labels
              if (optionText.startsWith('options:') || optionText.startsWith('option:')) {
                continue;
              }
              
              // Skip if option text is way too long (likely a container with multiple options)
              if (optionText.length > 100) {
                continue;
              }
              
              // For short values like "yes" or "no", require exact match or very close match
              if (valueToMatch.length <= 4) {
                // Exact match only for short values
                if (optionText === valueToMatch || optionText.startsWith(valueToMatch + ' ') || optionText.endsWith(' ' + valueToMatch)) {
                  console.log('[Offlyn] Clicking exact-match option:', optionText.substring(0, 50));
                  (option as HTMLElement).click();
                  optionClicked = true;
                  await new Promise(resolve => setTimeout(resolve, 100));
                  break;
                }
              } else {
                // For longer values, allow partial matching
                if (optionText.includes(valueToMatch) || valueToMatch.includes(optionText)) {
                  console.log('[Offlyn] Clicking partial-match option:', optionText.substring(0, 50));
                  (option as HTMLElement).click();
                  optionClicked = true;
                  await new Promise(resolve => setTimeout(resolve, 100));
                  break;
                }
              }
            }
            
            if (!optionClicked) {
              console.warn('[Offlyn] No matching option found, trying keyboard navigation...');
              // Use keyboard to select - Type each character to trigger filtering
              element.value = ''; // Clear first
              element.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Type the value character by character
              for (const char of String(finalValue)) {
                element.value += char;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(resolve => setTimeout(resolve, 30));
              }
              
              // Wait for dropdown to filter
              await new Promise(resolve => setTimeout(resolve, 200));
              
              // Press Enter to select first filtered option
              element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              await new Promise(resolve => setTimeout(resolve, 150));
              console.log('[Offlyn] Sent keyboard Enter to accept filtered value');
            }
          }
        } else {
          // No dropdown appeared OR too many options (wrong dropdown) - try Enter key to accept value
          if (visibleOptions.length >= 50) {
            console.warn('[Offlyn] Too many options detected (', visibleOptions.length, ') - likely wrong dropdown, using Enter key instead');
          }
          console.log('[Offlyn] Using Enter key fallback for:', finalValue);
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        
        element.blur();
        console.log('[Offlyn] ✓ Value set for autocomplete field');
      }
      // Fill based on element type
      else if (element instanceof HTMLInputElement) {
        if (element.type === 'checkbox' || element.type === 'radio') {
          const boolValue = typeof finalValue === 'boolean' 
            ? finalValue 
            : String(finalValue).toLowerCase() === 'true' || finalValue === 'checked';
          element.checked = boolValue;
        } else {
          element.value = String(finalValue);
        }
      } else if (element instanceof HTMLSelectElement) {
        // Try to match by value first
        const optionByValue = Array.from(element.options).find(
          opt => opt.value === String(finalValue)
        );
        if (optionByValue) {
          element.value = optionByValue.value;
        } else {
          // Try to match by label text
          const optionByText = Array.from(element.options).find(
            opt => opt.textContent?.trim() === String(finalValue)
          );
          if (optionByText) {
            element.value = optionByText.value;
          } else {
            result.failedSelectors.push(mapping.selector);
            warn(`Could not match value "${finalValue}" for select ${mapping.selector}`);
            continue;
          }
        }
      } else if (element instanceof HTMLTextAreaElement) {
        element.value = String(finalValue);
      } else {
        result.failedSelectors.push(mapping.selector);
        warn(`Unsupported element type for ${mapping.selector}`);
        continue;
      }
      
      // Dispatch events to trigger any listeners
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Track filled selectors
      filledSelectors.add(mapping.selector);
      
      // Track auto-filled value for learning
      if (fieldSchema) {
        autoFilledValues.set(mapping.selector, {
          field: fieldSchema,
          value: finalValue,
        });
      }
      
      result.filledCount++;
      
      // Highlight as success
      highlightFieldAsSuccess(mapping.selector);
      
      // Show label with field name
      const fieldName = fieldSchema?.label || fieldSchema?.name || 'Field';
      showFieldLabel(mapping.selector, `✓ ${fieldName}`);
      
      // Update progress
      updateProgress(processedCount, plan.mappings.length, fieldName);
      
      log(`Filled ${mapping.selector}`);
      
      // IMPORTANT: Longer delay between fills to let dropdowns close properly
      await new Promise(resolve => setTimeout(resolve, 600));
    } catch (err) {
      result.failedSelectors.push(mapping.selector);
      
      // Highlight as error
      highlightFieldAsError(mapping.selector);
      showFieldLabel(mapping.selector, '✗ Failed');
      
      error(`Error filling ${mapping.selector}:`, err);
    }
  }
  
  // Show completion message
  info(`✅ Autofill complete! Filled ${result.filledCount} fields, ${result.failedSelectors.length} failed.`);
  
  // Show progress completion
  const allSuccess = result.failedSelectors.length === 0 && result.filledCount > 0;
  showProgressComplete(allSuccess, result.filledCount, plan.mappings.length);
  
  // Show notification based on results
  if (result.filledCount > 0) {
    if (result.failedSelectors.length === 0) {
      showSuccess(
        'Auto-fill Complete!',
        `Successfully filled all ${result.filledCount} fields.`,
        5000
      );
    } else {
      showWarning(
        'Auto-fill Partially Complete',
        `Filled ${result.filledCount} fields, ${result.failedSelectors.length} failed.`,
        6000
      );
    }
  } else {
    showError(
      'Auto-fill Failed',
      'No fields could be filled. Please check your profile data.',
      6000
    );
    hideProgress(0); // Hide immediately on total failure
  }
  
  // Send result back to background
  try {
    await browser.runtime.sendMessage(result);
  } catch (err) {
    error('Failed to send fill result:', err);
  }
  
  autofillInProgress = false; // Reset flag
}

/**
 * Resolve element by selector (supports ::shadow:: for Shadow DOM).
 * Falls back to getElementById for #id selectors when querySelector fails (IDs with spaces/special chars).
 */
function resolveElement(selector: string): Element | null {
  if (selector.includes('::shadow::')) {
    const [hostSelector, fieldSelector] = selector.split('::shadow::');
    const host = document.querySelector(hostSelector);
    if (host?.shadowRoot) {
      return host.shadowRoot.querySelector(fieldSelector);
    }
    return null;
  }
  let el = document.querySelector(selector);
  if (!el && selector.startsWith('#') && !selector.includes(' ')) {
    const id = selector.slice(1).replace(/\\ /g, ' ');
    el = document.getElementById(id);
  }
  return el;
}

/** Selectors used to find dropdown options (ATS / custom combobox). */
const DROPDOWN_OPTION_SELECTORS = [
  '[role="option"]',
  '[role="menuitem"]',
  'li[data-value]',
  '[role="listbox"] [role="option"]',
  '[role="listbox"] li',
  '.dropdown-option',
  '.dropdown-item',
  '.select-option',
  '.menu-item',
  '[class*="option"]',
  '[class*="dropdown"][class*="item"]',
  '[class*="select"][class*="item"]',
  '[class*="menu"] li',
  'ul li[role="option"]',
  'ul[role="listbox"] li',
  'div[role="option"]',
];

/**
 * Find visible dropdown options in the document and click the one matching value.
 * Returns true if an option was clicked, false otherwise.
 */
// NOTE: Old dropdown interaction functions removed.
// Now using simple approach: focus → set value → dispatch events → blur
// This matches ApplyEase & AutoFillAI proven patterns.

/**
 * Execute browser-use style actions (Ollama-generated fill/click/select)
 * Compatible with https://github.com/browser-use/browser-use
 */
async function executeBrowserUseActions(actions: BrowserUseAction[]): Promise<void> {
  autofillInProgress = true;

  for (const a of actions) {
    try {
      if (a.action === 'wait') {
        const ms = (a as { action: 'wait'; milliseconds?: number }).milliseconds ?? 300;
        await new Promise((r) => setTimeout(r, ms));
        continue;
      }

      if (a.action === 'scroll') {
        const sel = (a as { action: 'scroll'; selector?: string }).selector;
        const el = sel ? resolveElement(sel) : document.body;
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      const selector = (a as { selector: string }).selector;
      if (!selector) continue;

      const element = resolveElement(selector);
      if (!element) {
        warn(`[Browser-Use] Selector not found: ${selector}`);
        continue;
      }

      if (a.action === 'fill') {
        const value = (a as { action: 'fill'; value: string }).value ?? '';
        if (element instanceof HTMLInputElement) {
          if (element.type === 'checkbox' || element.type === 'radio') {
            element.checked = /^(true|yes|1|checked)$/i.test(value);
          } else {
            element.value = value;
          }
        } else if (element instanceof HTMLTextAreaElement) {
          element.value = value;
        } else {
          warn(`[Browser-Use] Element is not fillable: ${selector}`);
          continue;
        }
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        filledSelectors.add(selector);
        log(`[Browser-Use] Filled ${selector}`);
      } else if (a.action === 'select_option') {
        const value = (a as { action: 'select_option'; value: string }).value ?? '';
        if (element instanceof HTMLSelectElement) {
          const opt = Array.from(element.options).find(
            (o) => o.value === value || o.textContent?.trim() === value
          );
          if (opt) {
            element.value = opt.value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
            filledSelectors.add(selector);
            log(`[Browser-Use] Selected ${selector} = ${value}`);
          } else {
            warn(`[Browser-Use] Option not found for ${selector}: ${value}`);
          }
        } else if (element instanceof HTMLInputElement) {
          // Autocomplete/custom dropdown: Use simple approach (ApplyEase/AutoFillAI pattern)
          element.focus();
          await new Promise((r) => setTimeout(r, 100));
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
          await new Promise((r) => setTimeout(r, 100));
          element.blur();
          filledSelectors.add(selector);
          log(`[Browser-Use] Set value ${selector} = ${value}`);
        }
      } else if (a.action === 'click') {
        (element as HTMLElement).click();
        log(`[Browser-Use] Clicked ${selector}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      error(`[Browser-Use] Error executing action:`, a, err);
    }
  }

  autofillInProgress = false;
}

/**
 * Try Browser-Use style fill: detect fields → embeddings + profile → actions → execute.
 * Uses exact selectors from the form (no LLM-generated selectors).
 */
async function tryBrowserUseFill(schema: ReturnType<typeof extractFormSchema>): Promise<void> {
  try {
    const profile = await getUserProfile();
    if (!profile) {
      log('[Browser-Use] No user profile');
      return;
    }

    const ok = await checkOllamaConnection();
    if (!ok) {
      warn('[Browser-Use] Ollama not available (needed for embeddings). Start with: ollama serve');
      return;
    }

    info('[Browser-Use] Resolving values with embeddings + profile...');
    const actions = await buildBrowserUseActionsFromEmbeddings(schema, profile);

    if (actions.length === 0) {
      log('[Browser-Use] No actions to execute');
      return;
    }

    info(`[Browser-Use] Executing ${actions.length} actions`);
    await executeBrowserUseActions(actions);
    info('[Browser-Use] Done.');
  } catch (err) {
    error('[Browser-Use] Error:', err);
  }
}

/**
 * Get current value of a field
 */
function getFieldValue(element: Element): string {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? 'checked' : '';
    }
    return element.value;
  } else if (element instanceof HTMLSelectElement) {
    return element.value;
  } else if (element instanceof HTMLTextAreaElement) {
    return element.value;
  } else if (element.getAttribute('contenteditable') === 'true') {
    return element.textContent || '';
  }
  return '';
}

/**
 * Fill a field with a value (with proper event handling)
 */
async function fillFieldWithValue(selector: string, value: string, fieldLabel: string): Promise<void> {
  autofillInProgress = true;
  
  // Highlight field as being filled
  highlightFieldAsFilling(selector);
  
  try {
    // Get field schema to check type
    const fieldSchema = allDetectedFields.find(f => f.selector === selector);
    const fieldType = fieldSchema?.type;
    
    // Handle Shadow DOM selectors
    let element: Element | null = null;
    let host: Element | null = null;
    
    if (selector.includes('::shadow::')) {
      const [hostSelector, fieldSelector] = selector.split('::shadow::');
      host = document.querySelector(hostSelector);
      
      if (host && host.shadowRoot) {
        element = host.shadowRoot.querySelector(fieldSelector);
      }
    } else {
      element = document.querySelector(selector);
    }
    
    // Special handling for Shadow DOM autocomplete/dropdown components
    if (selector.includes('::shadow::') && 
        (fieldType === 'autocomplete' || fieldType === 'select' || 
         fieldSchema?.shadowHost?.toLowerCase().includes('autocomplete'))) {
      console.log('[Offlyn Smart] Filling Shadow DOM autocomplete/dropdown:', fieldLabel, 'with:', value);
      
      if (element instanceof HTMLInputElement && host) {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        
        // Wait for options to appear
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Try to click matching option
        if (host.shadowRoot) {
          const options = host.shadowRoot.querySelectorAll('[role="option"], li[data-value], .option, [class*="option"]');
          console.log('[Offlyn Smart] Found', options.length, 'options');
          
          for (const option of options) {
            const optionText = option.textContent?.trim().toLowerCase();
            const valueText = value.toLowerCase();
            
            if (optionText?.includes(valueText) || valueText.includes(optionText || '')) {
              console.log('[Offlyn Smart] ✓ Clicking option:', optionText);
              (option as HTMLElement).click();
              await new Promise(resolve => setTimeout(resolve, 100));
              break;
            }
          }
        }
        
        filledSelectors.add(selector);
        info(`✓ AI-selected "${value}" for dropdown: ${fieldLabel}`);
      }
    }
    // Handle regular autocomplete/dropdown fields (Lever, Greenhouse, Discord, etc.)
    else if (fieldType === 'autocomplete' && element instanceof HTMLInputElement) {
      console.log('[Offlyn Smart] Setting dropdown value (simple approach):', fieldLabel, 'with:', value);
      // Use simple approach: focus → value → events → blur
      element.focus();
      await new Promise(resolve => setTimeout(resolve, 100));
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
      element.blur();
      filledSelectors.add(selector);
      info(`✓ AI-filled "${value}" for dropdown: ${fieldLabel}`);
    }
    // Standard field types
    else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      filledSelectors.add(selector);
      info(`✓ AI-filled field "${fieldLabel}" with: ${value}`);
    } else if (element instanceof HTMLSelectElement) {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      filledSelectors.add(selector);
      info(`✓ AI-selected option "${value}" for: ${fieldLabel}`);
    }
    
    // Small delay to let the form react
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Highlight as success
    highlightFieldAsSuccess(selector);
    showFieldLabel(selector, `✓ ${fieldLabel}`);
  } catch (err) {
    // Highlight as error
    highlightFieldAsError(selector);
    showFieldLabel(selector, `✗ ${fieldLabel}`);
    throw err;
  } finally {
    autofillInProgress = false;
  }
}

/**
 * Listen for messages from background script
 */
browser.runtime.onMessage.addListener((message: unknown) => {
  try {
    if (typeof message === 'object' && message !== null && 'kind' in message) {
      if (message.kind === 'FILL_PLAN') {
        executeFillPlan(message as FillPlan);
        return Promise.resolve(); // Async handler
      }
    }
  } catch (err) {
    error('Error handling message:', err);
  }
  return Promise.resolve();
});

/**
 * Initialize content script
 */
async function init(): Promise<void> {
  // Initialize learning system
  try {
    await learningSystem.initialize();
    const stats = learningSystem.getStats();
    info(`[Learning] System initialized: ${stats.totalCorrections} corrections, ${stats.learnedPatterns} patterns`);
  } catch (err) {
    warn('[Learning] Failed to initialize:', err);
  }
  
  // Setup user edit tracking first
  setupUserEditTracking();
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[Offlyn] DOM loaded, starting detection...');
      // Initial detection
      setTimeout(detectPage, 100);
      
      // Retry detection for slow-loading SPAs (like SmartRecruiters)
      setTimeout(detectPage, 1000);
      setTimeout(detectPage, 2000);
      setTimeout(detectPage, 3000);
      setTimeout(detectPage, 5000);  // Extra retry for very slow sites
    });
  } else {
    console.log('[Offlyn] DOM already ready, starting detection...');
    // Initial detection
    setTimeout(detectPage, 100);
    
    // Retry detection for slow-loading SPAs
    setTimeout(detectPage, 1000);
    setTimeout(detectPage, 2000);
    setTimeout(detectPage, 3000);
    setTimeout(detectPage, 5000);  // Extra retry for very slow sites
  }
  
  // Add global function for manual triggering
  (window as any).offlyn_detectPage = detectPage;
  console.log('[Offlyn] Manual trigger available: window.offlyn_detectPage()');
  
  // Listen for form submissions
  document.addEventListener('submit', (e) => {
    handleSubmitAttempt(e);
  }, true); // Use capture phase
  
  // Listen for button/link clicks (for multi-page forms and Apply buttons)
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || 
        target.tagName === 'INPUT' || 
        target.tagName === 'A') {
      handleSubmitAttempt(e);
      
      // Check if this might navigate to next page or load form
      const text = target.textContent?.toLowerCase() || '';
      
      // Skip if this is our own suggestion panel (don't interfere with our UI)
      if (target.closest('#offlyn-suggestion-panel')) {
        return;
      }
      
      if (text.includes('next') || text.includes('continue')) {
        // Wait for navigation and re-detect
        setTimeout(() => {
          info('Detected "Next" button, re-scanning for new fields...');
          detectPage();
        }, 1500);
      } else if (text.includes('apply') || text.includes('start application')) {
        // "Apply" button clicked - form might load
        info('Detected "Apply" button click, waiting for form to load...');
        setTimeout(detectPage, 1000);
        setTimeout(detectPage, 2000);
        setTimeout(detectPage, 3000);
      }
    }
  }, true);
  
  // Monitor URL changes for multi-page forms (SPA navigation)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      info('URL changed, re-scanning for new fields...');
      
      // Clear tracking for new page
      userEditedFields.clear();
      filledSelectors.clear();
      
      // Re-detect after navigation
      setTimeout(detectPage, 500);
    }
  });
  
  urlObserver.observe(document.querySelector('head > title') || document.head, {
    childList: true,
    subtree: true
  });
  
  // Also listen for history API changes
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    originalPushState.apply(history, args);
    info('History push detected, re-scanning...');
    setTimeout(detectPage, 500);
  };
  
  history.replaceState = function(...args) {
    originalReplaceState.apply(history, args);
    info('History replace detected, re-scanning...');
    setTimeout(detectPage, 500);
  };
  
  // Listen for popstate (back/forward navigation)
  window.addEventListener('popstate', () => {
    info('Navigation detected (back/forward), re-scanning...');
    userEditedFields.clear();
    filledSelectors.clear();
    setTimeout(detectPage, 500);
  });
  
  // Re-detect on dynamic content changes (with smarter debouncing)
  let detectTimeout: number | null = null;
  let mutationCount = 0;
  const observer = new MutationObserver((mutations) => {
    // Ignore mutations during autofill
    if (autofillInProgress) return;
    
    // Only re-detect if meaningful changes (new form fields added)
    const hasFormChanges = mutations.some(mutation => {
      return Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        const element = node as Element;
        return element.matches('input, select, textarea, form') ||
               element.querySelector('input, select, textarea, form') !== null;
      });
    });
    
    if (!hasFormChanges) return;
    
    mutationCount++;
    
    if (detectTimeout !== null) {
      clearTimeout(detectTimeout);
    }
    
    // Longer delay if many mutations (page still loading)
    const delay = mutationCount > 5 ? 2000 : 1000;
    
    detectTimeout = window.setTimeout(() => {
      info(`Detecting new fields after ${mutationCount} mutations`);
      mutationCount = 0;
      detectPage();
    }, delay);
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  
  log('Content script initialized with multi-page support');
}

init();
