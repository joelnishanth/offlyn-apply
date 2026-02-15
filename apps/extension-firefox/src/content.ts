/**
 * Content script for detecting job application pages and filling forms
 */

import type { ApplyEvent, FillPlan, FillResult, JobMeta, FieldSchema } from './shared/types';
import { extractJobMetadata, extractFormSchema, isJobApplicationPage } from './shared/dom';
import { log, info, warn, error } from './shared/log';
import { showFieldSummary, hideFieldSummary } from './ui/field-summary';
import { getUserProfile, type UserProfile } from './shared/profile';
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
import { scrapeJobDescription } from './shared/job-description-scraper';
import { generateCoverLetter, refineCoverLetter } from './shared/cover-letter-service';
import {
  openCoverLetterPanel,
  updateCoverLetterPreview,
  showCoverLetterResult,
  showCoverLetterError,
  hideCoverLetterPanel,
  isCoverLetterPanelVisible,
} from './ui/cover-letter-panel';
import { getContextualStorage, migrateProfileToContextual } from './shared/context-aware-storage';
import {
  highlightFieldAsFilling,
  highlightFieldAsSuccess,
  highlightFieldAsError,
  showFieldLabel,
  clearAllHighlights
} from './ui/field-highlighter';
import { showNotification, showSuccess, showError, showWarning, showInfo } from './ui/notification';
import {
  showInlineSuggestionTiles,
  removeAllTiles
} from './ui/inline-suggestion-tile';
import { showProgress, updateProgress, hideProgress, showProgressComplete } from './ui/progress-indicator';
import { 
  smartFillField, 
  fillReactSelectField, 
  fillNativeSelect,
  setReactCheckboxValue
} from './shared/react-input';

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
      info('ℹ️ No fields matched profile data.');
      showNotification('No matches found', 'No fields could be auto-filled from your profile.', 'info');
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
    
    // Also try to fill resume file inputs (await to catch errors)
    await fillResumeFileInputs();
    
    // Post-fill re-scan: Some fields appear dynamically after other fields are filled
    // (e.g., "Please identify your race" appears after Hispanic/Latino = "No")
    // Wait for React to re-render, then re-scan for newly appeared fields
    await postFillRescan(profile);
    
    // Retry resume upload after post-fill rescan (file inputs may appear after form renders)
    await fillResumeFileInputs();
    
    // After basic autofill, show inline AI tiles on remaining empty text fields
    const unfilledCount = allDetectedFields.length - filledSelectors.size;
    if (unfilledCount > 0) {
      info(`ℹ️ ${unfilledCount} fields remain unfilled. Showing AI suggestion tiles.`);
      showInlineSuggestionTiles(allDetectedFields, filledSelectors, handleInlineTileClick);
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

    // Show notification and inline tiles for remaining unfilled fields
    const finalUnfilled = analyzeUnfilledFields(allDetectedFields, filledSelectors);
    if (finalUnfilled.length > 0) {
      info(`Smart autofill complete. ${finalUnfilled.length} fields still require manual attention.`);
      showUnfilledFieldsNotification(finalUnfilled.length);
      showInlineSuggestionTiles(allDetectedFields, filledSelectors, handleInlineTileClick);
    } else {
      info('✅ All fields successfully filled!');
      removeAllTiles();
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
 * Handle click on an inline AI suggestion tile.
 * Generates a suggestion for the specific field and fills it.
 * The tile auto-hides when the field gets a value, and auto-reappears
 * when the user clears the field, enabling regeneration.
 */
async function handleInlineTileClick(field: FieldSchema, selector: string): Promise<void> {
  try {
    const profile = await getUserProfile();
    if (!profile) {
      warn('[InlineTile] No profile available');
      return;
    }

    info(`[InlineTile] Generating AI suggestion for "${field.label || field.name}"...`);

    // Generate suggestion using the existing suggestion service
    const { generateFieldSuggestions } = await import('./shared/suggestion-service');
    const suggestion = await generateFieldSuggestions(
      field,
      profile,
      {
        company: lastJobMeta?.company,
        jobTitle: lastJobMeta?.jobTitle,
        url: window.location.href
      },
      true // use AI
    );

    if (!suggestion || suggestion.suggestions.length === 0) {
      warn(`[InlineTile] No suggestion found for "${field.label || field.name}"`);
      showInfo('No Suggestion', `Could not generate a suggestion for "${field.label || field.name}".`);
      return;
    }

    // Use the primary (best) suggestion
    const primary = suggestion.suggestions.find(s => s.isPrimary) || suggestion.suggestions[0];
    info(`[InlineTile] Applying suggestion: "${primary.value}" (source: ${primary.source}, confidence: ${primary.confidence})`);

    // Fill the field — the tile will auto-hide via its visibility watcher
    await fillFieldWithValue(selector, primary.value, field.label || field.name || 'field');

    // Track as filled
    filledSelectors.add(selector);
    autoFilledValues.set(selector, { field, value: primary.value });

    // Brief success highlight
    highlightFieldAsSuccess(selector);
  } catch (err) {
    error('[InlineTile] Error generating suggestion:', err);
  }
}

/**
 * Listen for refresh scan events from the UI
 */
window.addEventListener('offlyn-refresh-scan', () => {
  // Clean up stale inline tiles before re-scanning
  removeAllTiles();
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
 * Listen for cover letter generation trigger
 */
window.addEventListener('offlyn-generate-cover-letter', () => {
  triggerCoverLetterGeneration();
});

/**
 * Listen for cover letter regeneration (from the panel's "Regenerate" button)
 */
window.addEventListener('offlyn-regenerate-cover-letter', () => {
  triggerCoverLetterGeneration();
});

/**
 * Listen for cover letter refinement (shorten / lengthen / more impactful)
 */
window.addEventListener('offlyn-refine-cover-letter', async (e: Event) => {
  const detail = (e as CustomEvent).detail as { action: string; currentText: string } | undefined;
  if (!detail) return;

  const { action, currentText } = detail;
  info(`Refining cover letter: ${action}…`);

  try {
    const refined = await refineCoverLetter(
      currentText,
      action as 'shorten' | 'lengthen' | 'impactful',
      (partial) => updateCoverLetterPreview(partial),
    );

    showCoverLetterResult({
      text: refined,
      jobTitle: lastJobMeta?.jobTitle || '',
      company: lastJobMeta?.company || '',
      generatedAt: Date.now(),
    });

    showSuccess('Refined!', `Cover letter has been ${action === 'impactful' ? 'made more impactful' : action + 'ed'}.`);
  } catch (err: any) {
    error('Cover letter refinement failed:', err);
    showCoverLetterError(err?.message || 'Refinement failed. Is Ollama running?');
  }
});

/**
 * Generate a cover letter using the user's profile and the scraped job description
 */
async function triggerCoverLetterGeneration(): Promise<void> {
  try {
    // 1. Check Ollama
    const ollamaOk = await checkOllamaConnection();
    if (!ollamaOk) {
      showError('Ollama Offline', 'Ollama is not running. Start it to generate a cover letter.');
      return;
    }

    // 2. Get profile
    const profile = await getUserProfile();
    if (!profile) {
      showError('No Profile', 'Set up your profile first so we can personalise the letter.');
      return;
    }

    // 3. Scrape job description from current page
    const jobDesc = scrapeJobDescription(lastJobMeta?.jobTitle, lastJobMeta?.company);
    if (!jobDesc.description || jobDesc.description.length < 30) {
      showWarning('Limited Job Info', 'Could not find a detailed job description on this page. The cover letter may be generic.');
    }

    info(`Generating cover letter for "${jobDesc.title}" at ${jobDesc.company}…`);

    // 4. Detect a cover letter textarea / file input on the page for auto-apply
    const coverLetterField = detectCoverLetterField();

    // 5. Open the preview panel
    openCoverLetterPanel(
      jobDesc.title || 'Position',
      jobDesc.company || 'Company',
      coverLetterField ? (text: string) => applyCoverLetterToField(coverLetterField, text) : undefined,
    );

    // 6. Stream the cover letter
    const result = await generateCoverLetter(profile, jobDesc, (partial) => {
      updateCoverLetterPreview(partial);
    });

    showCoverLetterResult(result);
    showSuccess('Cover Letter Ready', 'Your tailored cover letter has been generated.');
  } catch (err: any) {
    error('Cover letter generation failed:', err);
    showCoverLetterError(err?.message || 'Generation failed. Is Ollama running?');
  }
}

/**
 * Detect a cover letter textarea or text input on the current page.
 * Returns the CSS selector if found.
 */
function detectCoverLetterField(): string | null {
  // Common patterns for cover letter fields
  const keywords = ['cover.?letter', 'coverletter', 'cover_letter', 'additional.?info', 'message.?to.?hiring'];
  const allTextareas = document.querySelectorAll('textarea');
  for (const ta of allTextareas) {
    const label = (ta.getAttribute('aria-label') || '').toLowerCase();
    const name = (ta.name || '').toLowerCase();
    const id = (ta.id || '').toLowerCase();
    const placeholder = (ta.placeholder || '').toLowerCase();

    // Check the associated <label> element
    let labelText = '';
    if (ta.id) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(ta.id)}"]`);
      if (labelEl) labelText = (labelEl.textContent || '').toLowerCase();
    }

    const haystack = `${label} ${name} ${id} ${placeholder} ${labelText}`;
    if (keywords.some(kw => new RegExp(kw, 'i').test(haystack))) {
      // Build a selector
      if (ta.id) return `#${CSS.escape(ta.id)}`;
      if (ta.name) return `textarea[name="${CSS.escape(ta.name)}"]`;
      return null;
    }
  }

  // Also check large text inputs
  const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
  for (const inp of inputs) {
    const el = inp as HTMLInputElement;
    const haystack = `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
    if (keywords.some(kw => new RegExp(kw, 'i').test(haystack))) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.name) return `input[name="${CSS.escape(el.name)}"]`;
    }
  }

  return null;
}

/**
 * Apply the generated cover letter text into a form field.
 */
function applyCoverLetterToField(selector: string, text: string): void {
  const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) {
    showWarning('Field Not Found', 'The cover letter field could not be located.');
    return;
  }

  // Use native value setter for React compatibility
  const nativeSetter = Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set;

  if (nativeSetter) nativeSetter.call(el, text);
  else el.value = text;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // Visual feedback
  el.style.transition = 'outline .2s, box-shadow .2s';
  el.style.outline = '3px solid #10b981';
  el.style.boxShadow = '0 0 0 6px rgba(16,185,129,.25)';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => {
    el.style.outline = '';
    el.style.boxShadow = '';
    el.style.transition = '';
  }, 2000);

  showSuccess('Applied!', 'Cover letter has been pasted into the form field.');
}

/**
 * Listen for manual autofill trigger
 */
window.addEventListener('offlyn-manual-autofill', async () => {
  if (allDetectedFields.length > 0) {
    info('Manual trigger: starting autofill with highlighting');
    await tryAutoFill(allDetectedFields);
  } else {
    // If no fields in current frame, check if we're in the top frame
    if (window.self === window.top) {
      // We're in the parent page with no fields - try triggering autofill in iframes
      warn('[Autofill] No fields in parent page, checking iframes...');
      const iframes = Array.from(document.querySelectorAll('iframe'));
      let foundIframeWithFields = false;
      
      for (const iframe of iframes) {
        try {
          // Post message to iframe to trigger autofill
          iframe.contentWindow?.postMessage({ type: 'OFFLYN_TRIGGER_AUTOFILL' }, '*');
          foundIframeWithFields = true;
          info(`[Autofill] Sent autofill trigger to iframe: ${iframe.src}`);
        } catch (err) {
          // Cross-origin iframe, can't access
          warn('[Autofill] Cannot access iframe (cross-origin):', iframe.src);
        }
      }
      
      if (!foundIframeWithFields) {
        warn('[Autofill] No detected fields. Refresh the scan first.');
      }
    } else {
      // We're in an iframe with no fields
      warn('[Autofill] No detected fields. Refresh the scan first.');
    }
  }
});

/**
 * Listen for autofill/suggestions trigger messages from parent frame
 */
window.addEventListener('message', async (event) => {
  if (!event.data || !event.data.type) return;
  
  if (event.data.type === 'OFFLYN_TRIGGER_AUTOFILL') {
    info('[Autofill] Received autofill trigger from parent frame');
    if (allDetectedFields.length > 0) {
      info(`[Autofill] Iframe has ${allDetectedFields.length} fields, starting autofill...`);
      await tryAutoFill(allDetectedFields);
    } else {
      warn('[Autofill] Iframe has no detected fields');
    }
  } else if (event.data.type === 'OFFLYN_TRIGGER_SUGGESTIONS') {
    info('[Suggestions] Received suggestions trigger from parent frame');
    if (allDetectedFields.length > 0) {
      info(`[Suggestions] Iframe has ${allDetectedFields.length} fields, showing suggestions...`);
      trySmartSuggestions();
    } else {
      warn('[Suggestions] Iframe has no detected fields');
    }
  }
});

/**
 * Wait for state transition after clicking Next/Continue button
 * Checks for URL change, step title change, or old fields being detached
 */
async function waitForStateTransition(): Promise<void> {
  return new Promise((resolve) => {
    const startUrl = location.href;
    const startStepTitle = document.querySelector('[class*="step"], [class*="page"], h1, h2')?.textContent || '';
    const oldRequiredFields = new Set(
      Array.from(document.querySelectorAll('input[required], select[required], textarea[required]'))
        .map(el => el.getAttribute('name') || el.getAttribute('id') || '')
        .filter(Boolean)
    );
    
    let resolved = false;
    let mutationTimeout: number | null = null;
    let checkCount = 0;
    const maxChecks = 30; // Max 6 seconds (30 * 200ms)
    
    const checkTransition = () => {
      if (resolved) return;
      checkCount++;
      
      // Check 1: URL changed
      if (location.href !== startUrl) {
        console.log('[Offlyn] State transition: URL changed');
        resolved = true;
        resolve();
        return;
      }
      
      // Check 2: Step title changed
      const currentStepTitle = document.querySelector('[class*="step"], [class*="page"], h1, h2')?.textContent || '';
      if (currentStepTitle && currentStepTitle !== startStepTitle) {
        console.log('[Offlyn] State transition: Step title changed');
        resolved = true;
        resolve();
        return;
      }
      
      // Check 3: Old required fields are detached
      const currentRequiredFields = new Set(
        Array.from(document.querySelectorAll('input[required], select[required], textarea[required]'))
          .map(el => el.getAttribute('name') || el.getAttribute('id') || '')
          .filter(Boolean)
      );
      
      // If >50% of old required fields are no longer present, transition happened
      let detachedCount = 0;
      for (const fieldName of oldRequiredFields) {
        if (!currentRequiredFields.has(fieldName)) {
          detachedCount++;
        }
      }
      
      if (oldRequiredFields.size > 0 && detachedCount > oldRequiredFields.size * 0.5) {
        console.log('[Offlyn] State transition: >50% of old fields detached');
        resolved = true;
        resolve();
        return;
      }
      
      // Check 4: Timeout - give up after max checks
      if (checkCount >= maxChecks) {
        console.log('[Offlyn] State transition: timeout, proceeding anyway');
        resolved = true;
        resolve();
        return;
      }
      
      // Schedule next check
      setTimeout(checkTransition, 200);
    };
    
    // Use MutationObserver to detect DOM changes and wait for stability
    const observer = new MutationObserver(() => {
      if (resolved) return;
      
      // Clear previous timeout (DOM is still changing)
      if (mutationTimeout !== null) {
        clearTimeout(mutationTimeout);
      }
      
      // Wait for 300ms of stability before checking transition
      mutationTimeout = window.setTimeout(() => {
        checkTransition();
      }, 300);
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });
    
    // Start checking immediately
    setTimeout(checkTransition, 300);
    
    // Cleanup after resolution
    setTimeout(() => {
      observer.disconnect();
    }, 10000);
  });
}

/**
 * Handle submit/apply button clicks.
 * On submit, we also snapshot all current field values for the learning system.
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

    // ── Learn from submission ──────────────────────────────────────────
    // Snapshot all current field values and save them for future autofill.
    // Use the detected fields (which include all fields we know about).
    const fieldsToLearn = allDetectedFields.length > 0 ? allDetectedFields : allFields;
    learnFromCurrentFormValues(fieldsToLearn, jobMeta);
  } catch (err) {
    error('Error handling submit attempt:', err);
  }
}

/**
 * Snapshot all current field values and pass them to the learning system.
 * Called on form submit / "Apply" / "Next" clicks.
 */
async function learnFromCurrentFormValues(
  fields: FieldSchema[],
  jobMeta: JobMeta | null
): Promise<void> {
  try {
    const fieldValues = new Map<string, string>();

    for (const field of fields) {
      const el = document.querySelector(field.selector);
      if (!el) continue;

      const value = getFieldValue(el);
      if (value && value.trim()) {
        fieldValues.set(field.selector, value.trim());
      }
    }

    if (fieldValues.size === 0) {
      info('[Learning] No field values to learn from submission');
      return;
    }

    const count = await learningSystem.learnFromSubmission(
      fields,
      fieldValues,
      {
        url: window.location.href,
        company: jobMeta?.company,
        jobTitle: jobMeta?.jobTitle,
      }
    );

    if (count > 0) {
      info(`[Learning] ✓ Learned ${count} field values from form submission`);
      showNotification('Learning', `Saved ${count} field values for future applications`, 'info', 2000);
    }
  } catch (err) {
    error('[Learning] Error learning from submission:', err);
  }
}

/**
 * Auto-fill resume file inputs
 * 
 * Supports multiple approaches for attaching resumes:
 * 1. Standard input[type="file"] (most ATS platforms)
 * 2. Greenhouse-style hidden file inputs triggered by drop zones
 * 3. React-controlled file upload components
 * 4. Drag-and-drop upload zones
 */
async function fillResumeFileInputs(): Promise<void> {
  try {
    // Step 1: Retrieve stored resume file from extension storage
    log('Attempting to load resume file from storage...');
    let resumeFile: { name: string; type: string; size: number; data?: number[] | null; dataBase64?: string; lastUpdated?: number } | null = null;
    
    try {
      const storageResult = await browser.storage.local.get('resumeFile');
      resumeFile = storageResult.resumeFile;
    } catch (storageErr) {
      error('Failed to read resume from storage (file may be too large):', storageErr);
      // Try reading just the metadata to see if the file exists
      try {
        const metaResult = await browser.storage.local.get('resumeFileMeta');
        if (metaResult.resumeFileMeta) {
          warn(`Resume file metadata exists (${metaResult.resumeFileMeta.name}, ${metaResult.resumeFileMeta.size} bytes) but data retrieval failed. Try re-uploading a smaller resume.`);
        }
      } catch (_) { /* ignore */ }
      return;
    }
    
    // Check if we have data in either format (base64 or legacy number array)
    const hasBase64 = resumeFile?.dataBase64 && resumeFile.dataBase64.length > 0;
    const hasLegacyArray = resumeFile?.data && Array.isArray(resumeFile.data) && resumeFile.data.length > 0;
    
    if (!resumeFile || (!hasBase64 && !hasLegacyArray)) {
      log('No resume file stored for auto-upload');
      return;
    }
    
    log(`Resume file loaded: ${resumeFile.name} (${resumeFile.size} bytes, type: ${resumeFile.type}, format: ${hasBase64 ? 'base64' : 'legacy-array'})`);
    
    // Step 2: Create the File object from stored data
    let file: File;
    try {
      let uint8Array: Uint8Array;
      
      if (hasBase64 && resumeFile.dataBase64) {
        // New base64 format (more efficient)
        const binaryString = atob(resumeFile.dataBase64);
        uint8Array = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          uint8Array[i] = binaryString.charCodeAt(i);
        }
      } else if (hasLegacyArray && resumeFile.data) {
        // Legacy number array format
        uint8Array = new Uint8Array(resumeFile.data);
      } else {
        log('No valid resume data found');
        return;
      }
      
      const blob = new Blob([uint8Array], { type: resumeFile.type });
      file = new File([blob], resumeFile.name, { 
        type: resumeFile.type,
        lastModified: resumeFile.lastUpdated || Date.now()
      });
      log(`Created File object: ${file.name} (${file.size} bytes)`);
    } catch (fileErr) {
      error('Failed to create File object from stored data:', fileErr);
      return;
    }
    
    // Step 3: Find all file input fields (including hidden ones)
    const fileInputs = findAllFileInputs();
    
    if (fileInputs.length === 0) {
      log('No file inputs found on page, checking for upload buttons/drop zones...');
      // Try to trigger file upload by clicking upload buttons
      const triggered = await triggerFileInputViaButton();
      if (triggered) {
        // Wait for the file input to appear
        await new Promise(resolve => setTimeout(resolve, 500));
        const newFileInputs = findAllFileInputs();
        if (newFileInputs.length > 0) {
          info(`Found ${newFileInputs.length} file input(s) after triggering upload button`);
          await attachFileToInputs(newFileInputs, file);
        } else {
          log('Still no file inputs after triggering upload button');
        }
      }
      return;
    }
    
    info(`Found ${fileInputs.length} file input(s), attempting resume upload`);
    await attachFileToInputs(fileInputs, file);
    
  } catch (err) {
    error('Error in fillResumeFileInputs:', err);
  }
}

/**
 * Find all file input elements on the page, including hidden ones
 */
function findAllFileInputs(): HTMLInputElement[] {
  const inputs: HTMLInputElement[] = [];
  
  // Standard visible file inputs
  const standardInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  inputs.push(...Array.from(standardInputs));
  
  // Greenhouse-specific: look for file inputs inside upload containers
  const greenhouseSelectors = [
    '[data-testid*="resume"] input[type="file"]',
    '[data-testid*="file"] input[type="file"]',
    '.upload-resume input[type="file"]',
    '.drop-zone input[type="file"]',
    '[class*="upload"] input[type="file"]',
    '[class*="dropzone"] input[type="file"]',
    '[class*="file-upload"] input[type="file"]',
    '[id*="resume"] input[type="file"]',
    'label[for*="resume"] + input[type="file"]',
    // Greenhouse's specific structure
    '[class*="attach"] input[type="file"]',
  ];
  
  for (const sel of greenhouseSelectors) {
    try {
      const found = document.querySelectorAll<HTMLInputElement>(sel);
      for (const el of found) {
        if (!inputs.includes(el)) {
          inputs.push(el);
        }
      }
    } catch (_) { /* selector might be invalid */ }
  }
  
  // Also check inside Shadow DOM
  const shadowHosts = document.querySelectorAll('*');
  for (const host of shadowHosts) {
    if (host.shadowRoot) {
      const shadowInputs = host.shadowRoot.querySelectorAll<HTMLInputElement>('input[type="file"]');
      inputs.push(...Array.from(shadowInputs));
    }
  }
  
  return inputs;
}

/**
 * Try to trigger a file input by clicking upload buttons or drop zones
 */
async function triggerFileInputViaButton(): Promise<boolean> {
  // Look for upload/attach buttons
  const buttonSelectors = [
    'button[class*="upload"]',
    'button[class*="attach"]',
    'button[class*="resume"]',
    '[role="button"][class*="upload"]',
    '[role="button"][class*="attach"]',
    'a[class*="upload"]',
    // Greenhouse-specific
    '[data-testid*="attach"]',
    '[data-testid*="upload"]',
    // Drop zones that act as buttons
    '[class*="dropzone"]',
    '[class*="drop-zone"]',
    '[class*="file-drop"]',
  ];
  
  for (const sel of buttonSelectors) {
    try {
      const buttons = document.querySelectorAll(sel);
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes('resume') || text.includes('attach') || text.includes('upload') || text.includes('choose file')) {
          log(`Found upload trigger button: "${btn.textContent?.trim()}"`);
          // Don't actually click - just report we found it
          // Clicking could cause unwanted navigation
          return true;
        }
      }
    } catch (_) { /* ignore */ }
  }
  
  return false;
}

/**
 * Attach a File object to file input elements
 */
async function attachFileToInputs(fileInputs: HTMLInputElement[], file: File): Promise<void> {
  for (const fileInput of fileInputs) {
    try {
      // Generate unique identifier for this input
      const inputId = fileInput.id || fileInput.name || generateInputSelector(fileInput);
      
      // Check if we've already uploaded to this input
      if (resumeFilesUploaded.has(inputId)) {
        log(`Already uploaded resume to this input: ${inputId}`);
        continue;
      }
      
      // Check if this is likely a resume upload field
      const isResume = isResumeFileInput(fileInput);
      
      if (!isResume) {
        log(`Skipping file input (doesn't appear to be for resume): ${inputId}`);
        continue;
      }
      
      // Check if already has a file
      if (fileInput.files && fileInput.files.length > 0) {
        log(`File input already has a file: ${inputId}`);
        continue;
      }
      
      // Attempt to set files using DataTransfer
      let success = false;
      
      // Method 1: DataTransfer API (works in most browsers)
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        
        // Use Object.defineProperty as fallback if direct assignment is blocked
        try {
          fileInput.files = dataTransfer.files;
          success = fileInput.files.length > 0;
        } catch (assignErr) {
          log('Direct files assignment failed, trying defineProperty approach');
          Object.defineProperty(fileInput, 'files', {
            value: dataTransfer.files,
            writable: true,
            configurable: true,
          });
          success = fileInput.files.length > 0;
        }
      } catch (dtErr) {
        warn('DataTransfer approach failed:', dtErr);
      }
      
      // Method 2: ClipboardEvent with items (Firefox fallback)
      if (!success) {
        try {
          log('Trying ClipboardEvent fallback for file upload');
          const dt = new DataTransfer();
          dt.items.add(file);
          const event = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
          });
          fileInput.dispatchEvent(event);
          // Check if it worked
          success = fileInput.files !== null && fileInput.files.length > 0;
        } catch (clipErr) {
          warn('ClipboardEvent fallback failed:', clipErr);
        }
      }
      
      // Method 3: Drag and drop simulation
      if (!success) {
        try {
          log('Trying drag-and-drop simulation for file upload');
          const dt = new DataTransfer();
          dt.items.add(file);
          
          // Find the drop zone container
          const dropZone = fileInput.closest('[class*="drop"], [class*="upload"]') || fileInput.parentElement;
          const target = dropZone || fileInput;
          
          // Simulate drag enter, over, and drop
          target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
          target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
          target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
          
          await new Promise(resolve => setTimeout(resolve, 200));
          success = fileInput.files !== null && fileInput.files.length > 0;
        } catch (dragErr) {
          warn('Drag-and-drop simulation failed:', dragErr);
        }
      }
      
      if (success) {
        // Dispatch standard events that React and other frameworks listen to
        fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        
        // Also dispatch a custom React-compatible event
        const nativeInputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          composed: true,
        });
        fileInput.dispatchEvent(nativeInputEvent);
        
        // Mark this input as filled
        resumeFilesUploaded.add(inputId);
        info(`✓ Auto-uploaded resume "${file.name}" to: ${inputId}`);
      } else {
        warn(`✗ All file upload methods failed for: ${inputId}. The file input may need manual interaction.`);
      }
      
    } catch (err) {
      error('Failed to fill file input:', err);
    }
  }
}

/**
 * Generate a CSS selector for a file input element
 */
function generateInputSelector(el: HTMLInputElement): string {
  if (el.id) return `#${el.id}`;
  if (el.name) return `input[name="${el.name}"]`;
  // Fallback: use position relative to parent
  const parent = el.parentElement;
  if (parent) {
    const siblings = parent.querySelectorAll('input[type="file"]');
    const idx = Array.from(siblings).indexOf(el);
    return `${parent.tagName.toLowerCase()} input[type="file"]:nth-of-type(${idx + 1})`;
  }
  return 'input[type="file"]';
}

/**
 * Check if a file input is likely a resume upload field
 */
function isResumeFileInput(fileInput: HTMLInputElement): boolean {
  // Gather text context from labels, nearby elements, and attributes
  const label = fileInput.labels?.[0]?.textContent?.toLowerCase() || '';
  const placeholder = fileInput.placeholder?.toLowerCase() || '';
  const name = fileInput.name?.toLowerCase() || '';
  const id = fileInput.id?.toLowerCase() || '';
  const accept = fileInput.accept?.toLowerCase() || '';
  const ariaLabel = fileInput.getAttribute('aria-label')?.toLowerCase() || '';
  const dataTestId = fileInput.getAttribute('data-testid')?.toLowerCase() || '';
  
  // Check parent/container text
  const parentText = fileInput.closest('div, fieldset, section')?.textContent?.toLowerCase() || '';
  
  // Check for resume-related keywords
  const resumeKeywords = ['resume', 'cv', 'curriculum vitae'];
  const fileKeywords = ['pdf', 'doc', 'docx', 'rtf'];
  
  const allText = [label, placeholder, name, id, ariaLabel, dataTestId].join(' ');
  
  // Direct match on field attributes
  const hasResumeKeyword = resumeKeywords.some(kw => allText.includes(kw));
  const hasFileType = fileKeywords.some(kw => accept.includes(kw));
  
  // Container text match (less specific, so also check it's in a form context)
  const parentHasResumeKeyword = resumeKeywords.some(kw => parentText.includes(kw));
  
  // On job application pages, any file input accepting PDFs/DOCs is likely for resume
  const isOnJobPage = document.querySelector('[class*="application"], [id*="application"], form') !== null;
  
  return hasResumeKeyword || (hasFileType && (parentHasResumeKeyword || isOnJobPage)) || (isOnJobPage && hasFileType);
}

/**
 * Post-fill re-scan: after autofill completes, wait for React/dynamic content to re-render,
 * then re-scan for newly appeared fields (e.g., "Please identify your race" appears after
 * Hispanic/Latino = "No" is selected). Fill any new fields that weren't in the original scan.
 */
async function postFillRescan(profile: UserProfile): Promise<void> {
  // Wait for dynamic content to render (React re-renders after dropdown selections)
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Re-extract form fields (wrapped in try-catch for pages where DOM may have changed)
  let newSchema: ReturnType<typeof extractFormSchema>;
  try {
    // Scan entire document for fields (same as initial detection for single-page apps)
    const forms = document.querySelectorAll('form');
    if (forms.length > 0) {
      newSchema = [];
      for (const form of forms) {
        newSchema.push(...extractFormSchema(form));
      }
    } else {
      newSchema = extractFormSchema(document);
    }
  } catch (err) {
    warn('Post-fill re-scan: failed to extract form schema', err);
    return;
  }
  if (newSchema.length <= allDetectedFields.length) {
    return; // No new fields appeared
  }
  
  // Find fields that are new (not in the original scan)
  const oldSelectors = new Set(allDetectedFields.map(f => f.selector));
  const newFields = newSchema.filter(f => !oldSelectors.has(f.selector));
  
  if (newFields.length === 0) {
    return;
  }
  
  info(`🔄 Post-fill re-scan: found ${newFields.length} new dynamic fields`);
  
  // Update the stored fields
  allDetectedFields = newSchema;
  
  // Generate mappings only for new fields
  const newMappings = generateFillMappings(newFields, profile);
  if (newMappings.length === 0) {
    info('ℹ️ New fields found but no profile matches');
    return;
  }
  
  info(`🔄 Filling ${newMappings.length} newly appeared fields`);
  
  const fillPlan: FillPlan = {
    kind: 'FILL_PLAN',
    requestId: `rescan_${Date.now()}`,
    mappings: newMappings,
    dryRun: false,
  };
  
  await executeFillPlan(fillPlan);
}

/**
 * Check for inline validation error after filling a field (Workday-specific)
 */
async function checkForValidationError(selector: string, fieldLabel: string): Promise<void> {
  // Wait briefly for validation to trigger
  await new Promise(resolve => setTimeout(resolve, 200));
  
  const element = document.querySelector(selector);
  if (!element) return;
  
  // Common error message selectors (Workday, Greenhouse, etc.)
  const errorSelectors = [
    '.error-message',
    '.field-error',
    '.validation-error',
    '[class*="error"]',
    '[class*="invalid"]',
    '[role="alert"]',
    '.text-danger',
    '[data-error]',
    '[aria-invalid="true"] + *', // Error next to invalid field
  ];
  
  // Check for error messages near the field
  const container = element.closest('div, fieldset, .form-group, .field-wrapper, [class*="field"]');
  
  if (container) {
    for (const errorSelector of errorSelectors) {
      const errorElement = container.querySelector(errorSelector);
      if (errorElement) {
        const errorText = errorElement.textContent?.trim();
        if (errorText && errorText.length > 0 && errorText.length < 200) {
          console.warn(`[Offlyn] ⚠️ Validation error for "${fieldLabel}": ${errorText}`);
          highlightFieldAsError(selector);
          return;
        }
      }
    }
  }
  
  // Check if field itself is marked as invalid
  if (element.getAttribute('aria-invalid') === 'true') {
    console.warn(`[Offlyn] ⚠️ Field "${fieldLabel}" marked as invalid`);
    highlightFieldAsError(selector);
  }
}

/**
 * Handle exclusive checkbox selection - uncheck others if this is an exclusive option
 */
function handleExclusiveCheckbox(checkbox: HTMLInputElement): void {
  if (!checkbox.checked) return; // Only handle when checking
  
  const label = (checkbox.labels?.[0]?.textContent || checkbox.getAttribute('aria-label') || '').toLowerCase();
  
  // Check if this is an exclusive option
  const exclusivePatterns = [
    'none of the above',
    'none of these apply',
    'not applicable',
    'none apply',
    'n/a',
    'prefer not to answer',
    'decline to self-identify'
  ];
  
  const isExclusive = exclusivePatterns.some(pattern => label.includes(pattern));
  
  if (!isExclusive) return;
  
  console.log('[Offlyn] Exclusive checkbox detected:', label);
  
  // Find other checkboxes in the same group
  let groupCheckboxes: HTMLInputElement[] = [];
  
  // Strategy 1: Same name attribute (most reliable)
  if (checkbox.name) {
    groupCheckboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${checkbox.name}"]`)
    ).filter(cb => cb !== checkbox);
  }
  
  // Strategy 2: Same fieldset
  if (groupCheckboxes.length === 0) {
    const fieldset = checkbox.closest('fieldset');
    if (fieldset) {
      groupCheckboxes = Array.from(
        fieldset.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      ).filter(cb => cb !== checkbox);
    }
  }
  
  // Strategy 3: Same closest container with multiple checkboxes
  if (groupCheckboxes.length === 0) {
    const container = checkbox.closest('[role="group"], .checkbox-group, .form-group, div, section');
    if (container) {
      const allCheckboxes = Array.from(
        container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      );
      
      // Only consider it a group if there are 2+ checkboxes
      if (allCheckboxes.length >= 2) {
        groupCheckboxes = allCheckboxes.filter(cb => cb !== checkbox);
      }
    }
  }
  
  // Uncheck all other checkboxes in the group
  if (groupCheckboxes.length > 0) {
    console.log(`[Offlyn] Unchecking ${groupCheckboxes.length} other checkboxes in exclusive group`);
    for (const cb of groupCheckboxes) {
      if (cb.checked) {
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
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
        await new Promise(resolve => setTimeout(resolve, 100));
        
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
            result.failedSelectors.push(mapping.selector);
            highlightFieldAsError(mapping.selector);
            showFieldLabel(mapping.selector, '✗ Invalid value');
            continue;
          }
        }
        
        const valueStr = String(finalValue);
        let optionClicked = false;
        
        // ── ESCALATION LADDER for Virtualized/Async Listboxes ───────────
        // Workday and similar ATS systems render options lazily or require typing to fetch/expand
        
        // STEP 1: Open the dropdown and wait for listbox to appear
        console.log('[Offlyn] Step 1: Opening combobox and waiting for listbox...');
        element.focus();
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.click();
        // Wait longer for dropdown options to render (some ATS platforms like Eightfold need time)
        await new Promise(resolve => setTimeout(resolve, 700));
        
        // Helper function to find and filter real options
        const getRealOptions = (listbox: Element | null): Element[] => {
          let candidateOptions: Element[] = [];
          
          if (listbox) {
            candidateOptions = Array.from(
              listbox.querySelectorAll('[role="option"], li, div[data-value]')
            );
          } else {
            // Fallback: query document with precise selectors
            const allOptions = document.querySelectorAll(DROPDOWN_OPTION_SELECTORS.join(','));
            const elementRect = element.getBoundingClientRect();
            
            candidateOptions = Array.from(allOptions).filter(opt => {
              const rect = opt.getBoundingClientRect();
              const style = window.getComputedStyle(opt);
              
              if (rect.height === 0 || rect.width === 0) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              if (Math.abs(rect.top - elementRect.bottom) > 400 &&
                  Math.abs(elementRect.top - rect.bottom) > 400) return false;
              
              return true;
            });
          }
          
          // Filter out summary/container elements and phone country code items
          return candidateOptions.filter(opt => {
            const text = (opt.textContent || '').trim();
            if (text.length < 1 || text.length > 100) return false;
            if (/^options?\s*:/i.test(text)) return false;
            if (text.includes(',') && text.split(',').length > 2) return false;
            // Exclude phone country code picker items
            const optClass = opt.className || '';
            if (optClass.includes('iti__country') || optClass.includes('iti__')) return false;
            const parentClass = (opt.parentElement?.className || '');
            if (parentClass.includes('iti__country-list')) return false;
            return true;
          });
        };
        
        // Gender synonym map for matching "Male"↔"Man", "Female"↔"Woman" in dropdowns
        const GENDER_SYNONYMS: Record<string, string[]> = {
          'male': ['male', 'man'],
          'man': ['male', 'man'],
          'female': ['female', 'woman'],
          'woman': ['female', 'woman'],
        };
        
        // Get gender synonyms for a value (returns empty array if not a gender term)
        const getGenderSynonyms = (val: string): string[] => GENDER_SYNONYMS[val] || [];
        
        // Check if an option text matches any of the gender synonyms
        const isGenderSynonymMatch = (optText: string, val: string): boolean => {
          const synonyms = getGenderSynonyms(val);
          if (synonyms.length === 0) return false;
          // "female"/"woman" exclusion check for male terms
          const femalTerms = ['female', 'woman'];
          const maleTerms = ['male', 'man'];
          for (const syn of synonyms) {
            if (optText === syn) return true;
            if (optText.startsWith(syn + ' ') || optText.startsWith(syn + '(')) {
              // For male synonyms, exclude if option also contains female terms
              if (maleTerms.includes(syn) && femalTerms.some(f => optText.includes(f))) continue;
              return true;
            }
          }
          return false;
        };
        
        // Helper function to try matching options
        const tryMatchOption = async (options: Element[], valueToMatch: string): Promise<boolean> => {
          // Score ALL options first, then pick the best
          let bestMatch: { option: Element; score: number; text: string } | null = null;
          
          for (const option of options) {
            const optionText = (option.textContent || '').toLowerCase().trim();
            let score = 0;
            
            // Exact match (highest priority)
            if (optionText === valueToMatch) {
              score = 10000; // Very high score for exact match
            }
            // Gender synonym match (e.g., value="male" matches option="man")
            else if (isGenderSynonymMatch(optionText, valueToMatch)) {
              score = 9000; // Very high, just below exact
            }
            // Option starts with value (high priority, but prefer shorter)
            else if (optionText.startsWith(valueToMatch)) {
              // Base score 900, but penalize length
              // "United States" → 900 - 0 = 900
              // "United States Minor Outlying Islands" → 900 - 28 = 872
              const lengthPenalty = optionText.length - valueToMatch.length;
              score = 900 - lengthPenalty;
            }
            // Value is contained in option (medium priority)
            else if (optionText.includes(valueToMatch)) {
              // Lower base score, also penalize length
              const lengthPenalty = optionText.length - valueToMatch.length;
              score = 500 - lengthPenalty;
            }
            // Option is contained in value (low priority)
            else if (valueToMatch.includes(optionText) && optionText.length > 3) {
              score = 400;
            }
            
            // Track best match (highest score wins)
            if (score > 0 && (bestMatch === null || score > bestMatch.score)) {
              bestMatch = { option, score, text: optionText };
            }
          }
          
          // Click the best match if found
          if (bestMatch) {
            console.log('[Offlyn] ✓ Best match:', bestMatch.text, `(score: ${bestMatch.score})`);
            console.log('[Offlyn] Option element:', bestMatch.option.tagName, 'role:', bestMatch.option.getAttribute('role'), 'class:', bestMatch.option.className);
            
            // Scroll option into view
            (bestMatch.option as HTMLElement).scrollIntoView({ block: 'nearest' });
            
            // Record input value before click
            const valueBefore = element.value;
            
            // Find the actual clickable element (might be a child button/div)
            const optionEl = bestMatch.option as HTMLElement;
            let clickTarget = optionEl;
            
            // Check for clickable children (button, div with onClick, etc.)
            const clickableChild = optionEl.querySelector('button, [role="button"], div[class*="item"]');
            if (clickableChild) {
              console.log('[Offlyn] Found clickable child:', clickableChild.tagName, clickableChild.className);
              clickTarget = clickableChild as HTMLElement;
            }
            
            // Dispatch full mouse event sequence (React dropdowns need this)
            clickTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
            clickTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
            clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            clickTarget.click(); // Use native click() instead of dispatchEvent for better compatibility
            clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            
            // Wait longer for React to process and verify the value was set
            await new Promise(resolve => setTimeout(resolve, 400));
            const valueAfter = element.value;
            console.log('[Offlyn] Input value before click:', valueBefore || '<empty string>', '| after click:', valueAfter || '<empty string>');
            
            // Check if this is a React-Select component (clicking an option clears the input - that's expected behavior)
            const isReactSelect = !!element.closest('[class*="select__"]') || 
                                  !!bestMatch.option.closest('[class*="select__"]') ||
                                  (bestMatch.option.className || '').includes('select__option');
            
            // For React-Select: input clearing after click means selection succeeded
            // Check for a value container or single-value element to confirm
            if (isReactSelect) {
              const selectContainer = element.closest('[class*="select__"]') || element.parentElement?.closest('[class*="select__"]');
              const singleValue = selectContainer?.querySelector('[class*="single-value"], [class*="singleValue"]');
              if (singleValue || (valueBefore && !valueAfter)) {
                console.log('[Offlyn] React-Select: option click accepted (input cleared = selection made)');
                // Don't force value - React-Select manages it internally
              } else if (valueAfter === valueBefore || !valueAfter) {
                console.log('[Offlyn] React-Select: click may not have worked, forcing value...');
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (nativeInputValueSetter) { nativeInputValueSetter.call(element, bestMatch.text); } else { element.value = bestMatch.text; }
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new Event('blur', { bubbles: true }));
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            }
            // For non-React-Select: if click didn't update input, force it
            else if (valueAfter === valueBefore || !valueAfter) {
              console.log('[Offlyn] Click did not update input, forcing value via React...');
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (nativeInputValueSetter) { nativeInputValueSetter.call(element, bestMatch.text); } else { element.value = bestMatch.text; }
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.dispatchEvent(new Event('blur', { bubbles: true }));
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            return true;
          }
          
          return false;
        };
        
        const valueToMatch = valueStr.toLowerCase().trim();
        let listbox = findAssociatedListbox(element);
        let realOptions = getRealOptions(listbox);
        
        console.log('[Offlyn] Found', realOptions.length, 'options after initial open');
        
        if (realOptions.length > 0) {
          optionClicked = await tryMatchOption(realOptions, valueToMatch);
        }
        
        // STEP 2: Type-to-search — for dropdowns that only show options after typing (Greenhouse/React-Select)
        if (!optionClicked && realOptions.length === 0) {
          console.log('[Offlyn] Step 2: No options after initial open, typing prefix to trigger search...');
          
          // Type the first few characters to trigger the dropdown's search/filter
          const prefix = valueStr.substring(0, Math.min(4, valueStr.length));
          console.log('[Offlyn] Step 2: Typing prefix:', JSON.stringify(prefix));
          
          // Clear any existing value first
          element.value = '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Simulate real character-by-character typing (React-Select needs InputEvent with insertText)
          for (let i = 0; i < prefix.length; i++) {
            const char = prefix[i];
            
            // Dispatch keydown
            element.dispatchEvent(new KeyboardEvent('keydown', { 
              key: char, bubbles: true, cancelable: true 
            }));
            
            // Update the value incrementally
            element.value = prefix.substring(0, i + 1);
            
            // Dispatch InputEvent with insertText type (this is what React-Select listens for)
            element.dispatchEvent(new InputEvent('input', { 
              bubbles: true, 
              cancelable: false,
              inputType: 'insertText', 
              data: char 
            }));
            
            // Dispatch keyup
            element.dispatchEvent(new KeyboardEvent('keyup', { 
              key: char, bubbles: true, cancelable: true 
            }));
            
            // Small delay between characters to let React process
            await new Promise(resolve => setTimeout(resolve, 60));
          }
          
          // Poll for options to appear (search-as-you-type dropdowns need time to fetch/render)
          let pollAttempts = 0;
          const maxPolls = 10; // 10 x 300ms = 3 seconds max wait
          while (pollAttempts < maxPolls && !optionClicked) {
            await new Promise(resolve => setTimeout(resolve, 300));
            pollAttempts++;
            
            // Re-check for listbox and options
            listbox = findAssociatedListbox(element);
            realOptions = getRealOptions(listbox);
            
            // Also check for portaled dropdown menus (React-Select renders outside the input's DOM tree)
            if (realOptions.length === 0) {
              // Look specifically for React-Select menus (class contains "select__menu" or "menu-list")
              // Exclude phone country code pickers (class contains "iti__" or "country-list")
              const portalMenus = document.querySelectorAll(
                '[class*="select__menu"], [class*="menu-list"], [class*="listbox"]:not([class*="iti__"]), [id*="listbox"], [role="listbox"]:not([class*="iti__"])'
              );
              for (const menu of portalMenus) {
                const menuRect = menu.getBoundingClientRect();
                const menuClass = menu.className || '';
                // Skip phone country code dropdowns
                if (menuClass.includes('iti__') || menuClass.includes('country-list')) continue;
                if (menuRect.height > 0 && menuRect.width > 0) {
                  const menuOptions = Array.from(
                    menu.querySelectorAll('[role="option"]:not([class*="iti__"]), [class*="option"]:not([class*="iti__"])')
                  ).filter(opt => {
                    const text = (opt.textContent || '').trim();
                    const optClass = opt.className || '';
                    // Exclude phone country items
                    if (optClass.includes('iti__country')) return false;
                    return text.length > 0 && text.length < 100;
                  });
                  if (menuOptions.length > 0) {
                    realOptions = menuOptions;
                    break;
                  }
                }
              }
            }
            
            if (realOptions.length > 0) {
              console.log('[Offlyn] Step 2: Found', realOptions.length, 'options after', pollAttempts * 300, 'ms');
              optionClicked = await tryMatchOption(realOptions, valueToMatch);
              if (optionClicked) {
                console.log('[Offlyn] Step 2: Successfully selected from dropdown');
              }
              break;
            }
          }
          
          if (!optionClicked && realOptions.length === 0) {
            console.log('[Offlyn] Step 2: No options appeared after', maxPolls * 300, 'ms of polling');
          }
        }
        
        // STEP 2b: Retry with gender synonyms if Step 2 didn't find a match
        // e.g., if we typed "Male" but dropdown has "Man", clear and try "Man" instead
        if (!optionClicked && getGenderSynonyms(valueToMatch).length > 0) {
          const synonyms = getGenderSynonyms(valueToMatch).filter(s => s !== valueToMatch);
          for (const synonym of synonyms) {
            if (optionClicked) break;
            console.log('[Offlyn] Step 2b: Retrying with gender synonym:', JSON.stringify(synonym));
            
            // Clear the input first
            element.value = '';
            element.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Type the synonym prefix character-by-character
            const synPrefix = synonym.substring(0, Math.min(4, synonym.length));
            for (let i = 0; i < synPrefix.length; i++) {
              const char = synPrefix[i];
              element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));
              element.value = synPrefix.substring(0, i + 1);
              element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: char }));
              element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true, cancelable: true }));
              await new Promise(resolve => setTimeout(resolve, 60));
            }
            
            // Poll for options
            let synPollAttempts = 0;
            while (synPollAttempts < 8 && !optionClicked) {
              await new Promise(resolve => setTimeout(resolve, 300));
              synPollAttempts++;
              
              listbox = findAssociatedListbox(element);
              realOptions = getRealOptions(listbox);
              
              if (realOptions.length === 0) {
                const portalMenus = document.querySelectorAll(
                  '[class*="select__menu"], [class*="menu-list"], [class*="listbox"]:not([class*="iti__"]), [id*="listbox"], [role="listbox"]:not([class*="iti__"])'
                );
                for (const menu of portalMenus) {
                  const menuRect = menu.getBoundingClientRect();
                  const menuClass = menu.className || '';
                  if (menuClass.includes('iti__') || menuClass.includes('country-list')) continue;
                  if (menuRect.height > 0 && menuRect.width > 0) {
                    const menuOptions = Array.from(
                      menu.querySelectorAll('[role="option"]:not([class*="iti__"]), [class*="option"]:not([class*="iti__"])')
                    ).filter(opt => {
                      const text = (opt.textContent || '').trim();
                      const optClass = opt.className || '';
                      if (optClass.includes('iti__country')) return false;
                      return text.length > 0 && text.length < 100;
                    });
                    if (menuOptions.length > 0) {
                      realOptions = menuOptions;
                      break;
                    }
                  }
                }
              }
              
              if (realOptions.length > 0) {
                console.log('[Offlyn] Step 2b: Found', realOptions.length, 'options for synonym', JSON.stringify(synonym));
                // Match against the synonym value, not the original
                optionClicked = await tryMatchOption(realOptions, synonym);
                if (optionClicked) {
                  console.log('[Offlyn] Step 2b: Successfully selected synonym option');
                }
                break;
              }
            }
          }
        }
        
        // STEP 3: If still no match, try scrolling listbox to load virtualized options
        if (!optionClicked && listbox) {
          console.log('[Offlyn] Step 3: Scrolling listbox to load virtualized options...');
          
          for (let scrollAttempt = 0; scrollAttempt < 3; scrollAttempt++) {
            listbox.scrollTop = listbox.scrollTop + 200; // Scroll down
            await new Promise(resolve => setTimeout(resolve, 200));
            
            realOptions = getRealOptions(listbox);
            if (realOptions.length > 0) {
              optionClicked = await tryMatchOption(realOptions, valueToMatch);
              if (optionClicked) break;
            }
          }
          
          console.log('[Offlyn] After scrolling:', realOptions.length, 'options');
        }
        
        // STEP 4: Fallback to tokenized partial matching
        if (!optionClicked && realOptions.length > 0) {
          console.log('[Offlyn] Step 4: Trying tokenized partial matching...');
          
          // Tokenize the desired value (e.g., "United States" → ["united", "states"])
          // For very short values like "+1", split by any non-alphanumeric character
          let tokens: string[];
          if (valueToMatch.length <= 3) {
            // Don't tokenize very short values - they need exact or prefix match
            tokens = [valueToMatch];
          } else {
            // Split by whitespace for normal values
            tokens = valueToMatch.split(/\s+/).filter(t => t.length > 2);
          }
          
          // Skip tokenized matching if no valid tokens (empty array would match everything)
          if (tokens.length === 0) {
            console.log('[Offlyn] No valid tokens for matching, skipping tokenized step');
          } else {
            for (const option of realOptions) {
              const optionText = (option.textContent || '').toLowerCase().trim();
              
              // Check if option contains all tokens
              const matchesAllTokens = tokens.every(token => optionText.includes(token));
              if (matchesAllTokens) {
                console.log('[Offlyn] ✓ Tokenized match:', optionText);
                (option as HTMLElement).click();
                optionClicked = true;
                break;
              }
            }
          }
        }
        
        // STEP 5: Keyboard fallback (last resort) — type full value char-by-char, then ArrowDown+Enter
        if (!optionClicked) {
          console.log('[Offlyn] Step 5: Keyboard fallback (type full value + ArrowDown + Enter)...');
          
          // Clear any existing value
          element.value = '';
          element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Type full value character by character (triggers React-Select search)
          for (let i = 0; i < valueStr.length; i++) {
            const char = valueStr[i];
            element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
            element.value = valueStr.substring(0, i + 1);
            element.dispatchEvent(new InputEvent('input', { 
              bubbles: true, inputType: 'insertText', data: char 
            }));
            element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
            // Faster typing for full value
            if (i < 3) await new Promise(resolve => setTimeout(resolve, 50));
          }
          
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Check if options appeared after typing full value
          listbox = findAssociatedListbox(element);
          realOptions = getRealOptions(listbox);
          
          // Also check portaled menus (exclude phone country code pickers)
          if (realOptions.length === 0) {
            const portalMenus = document.querySelectorAll(
              '[class*="select__menu"], [class*="menu-list"], [class*="listbox"]:not([class*="iti__"]), [id*="listbox"], [role="listbox"]:not([class*="iti__"])'
            );
            for (const menu of portalMenus) {
              const menuRect = menu.getBoundingClientRect();
              const menuClass = menu.className || '';
              if (menuClass.includes('iti__') || menuClass.includes('country-list')) continue;
              if (menuRect.height > 0 && menuRect.width > 0) {
                const menuOptions = Array.from(
                  menu.querySelectorAll('[role="option"]:not([class*="iti__"]), [class*="option"]:not([class*="iti__"])')
                ).filter(opt => {
                  const text = (opt.textContent || '').trim();
                  const optClass = opt.className || '';
                  if (optClass.includes('iti__country')) return false;
                  return text.length > 0 && text.length < 100;
                });
                if (menuOptions.length > 0) {
                  realOptions = menuOptions;
                  break;
                }
              }
            }
          }
          
          if (realOptions.length > 0) {
            console.log('[Offlyn] Step 5: Found', realOptions.length, 'options after full value, trying to select...');
            optionClicked = await tryMatchOption(realOptions, valueToMatch);
          }
          
          // If still no match from clicking, use ArrowDown + Enter to select first option
          if (!optionClicked) {
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 150));
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Check if value was accepted
            const currentVal = element.value.trim();
            if (!currentVal || currentVal === valueStr) {
              // Try Tab to confirm
              element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          
          console.log('[Offlyn] Keyboard fallback completed, current value:', element.value || '<empty>');
        }
        
        element.blur();
        console.log('[Offlyn] ✓ Autocomplete field done:', fieldSchema?.label);
        
        // Check for validation errors after blur
        await checkForValidationError(mapping.selector, fieldSchema?.label || '');
      }
      // Fill based on element type — using superfill.ai-inspired smart fill strategy:
      // 1. Human-like typing for short values (best React compatibility)
      // 2. Native setter fallback for longer values or if typing fails
      // 3. Dedicated handlers for checkboxes, selects, and React Select components
      else if (element instanceof HTMLInputElement) {
        if (element.type === 'checkbox' || element.type === 'radio') {
          const boolValue = typeof finalValue === 'boolean' 
            ? finalValue 
            : String(finalValue).toLowerCase() === 'true' || finalValue === 'checked';
          
          // Use React-compatible checkbox setter
          setReactCheckboxValue(element, boolValue);
          
          // If this is an exclusive checkbox, uncheck others in the same group
          if (boolValue && element.type === 'checkbox') {
            handleExclusiveCheckbox(element);
          }
          
          // Check for validation errors
          await checkForValidationError(mapping.selector, fieldSchema?.label || '');
        } else if (element.getAttribute('role') === 'combobox') {
          // React Select / combobox - use dedicated handler
          const success = await fillReactSelectField(element, String(finalValue));
          if (!success) {
            // Fallback to native setter
            setNativeInputValue(element, String(finalValue));
          }
          
          // Check for validation errors
          await checkForValidationError(mapping.selector, fieldSchema?.label || '');
        } else {
          // Regular text input - use smart fill (human-like typing → native setter fallback)
          const success = await smartFillField(element, String(finalValue));
          if (!success) {
            warn(`Smart fill failed for ${mapping.selector}, value may not have stuck`);
          }
          
          // Check for validation errors
          await checkForValidationError(mapping.selector, fieldSchema?.label || '');
        }
      } else if (element instanceof HTMLTextAreaElement) {
        // Textarea - use smart fill (human typing for short, native setter for long)
        const success = await smartFillField(element, String(finalValue));
        if (!success) {
          warn(`Smart fill failed for textarea ${mapping.selector}`);
        }
        
        // Check for validation errors
        await checkForValidationError(mapping.selector, fieldSchema?.label || '');
      } else if (element instanceof HTMLSelectElement) {
        // Native select - use dedicated handler with value/text/partial matching
        const matched = fillNativeSelect(element, String(finalValue));
        if (!matched) {
          result.failedSelectors.push(mapping.selector);
          warn(`Could not match value "${finalValue}" for select ${mapping.selector}`);
          continue;
        }
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

/** Selectors used to find dropdown options (ATS / custom combobox).
 * IMPORTANT: Keep these precise — overly broad selectors like [class*="option"]
 * match summary/label elements (e.g. "Options: Yes, No") that aren't clickable.
 */
const DROPDOWN_OPTION_SELECTORS = [
  // ARIA roles (highest priority, most reliable)
  '[role="option"]',
  '[role="menuitem"]',
  
  // Data-attribute options
  'li[data-value]',
  'div[data-value]',
  
  // Listbox children
  '[role="listbox"] > *',
  
  // Specific class names (exact, not wildcard)
  '.dropdown-option',
  '.dropdown-item',
  '.select-option',
  '.autocomplete-option',
  '.combobox-option',
];

/**
 * Set an input's value in a way that React/Preact/Vue sees the change.
 * React overrides the `value` property setter, so assigning `el.value = x`
 * bypasses React's state. Using the native HTMLInputElement setter triggers
 * the internal change tracking, and the subsequent `input` event notifies
 * the React onChange handler.
 */
function setNativeInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  
  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }
  
  // Dispatch the input event — React listens to this via its synthetic event system
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Simulate typing a string character-by-character into a React-controlled input.
 * Dispatches proper keyboard events so React comboboxes filter their dropdown.
 */
async function simulateTyping(element: HTMLInputElement, value: string, charDelayMs: number = 40): Promise<void> {
  // Clear existing value first
  setNativeInputValue(element, '');
  await new Promise(r => setTimeout(r, 50));
  
  for (const char of value) {
    // Dispatch keydown
    element.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
    
    // Append character and notify React
    const current = element.value + char;
    setNativeInputValue(element, current);
    
    // Dispatch keyup
    element.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
    
    await new Promise(r => setTimeout(r, charDelayMs));
  }
}

/**
 * Find the associated listbox for an ARIA combobox input.
 * Checks aria-controls, aria-owns, and then falls back to nearby listboxes.
 */
function findAssociatedListbox(input: HTMLInputElement): Element | null {
  // 1. Try aria-controls / aria-owns (the standard way)
  const controlsId = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
  if (controlsId) {
    const listbox = document.getElementById(controlsId);
    if (listbox) return listbox;
  }
  
  // 2. Look for a sibling/nearby listbox in the same container
  const container = input.closest('[role="combobox"], [class*="field"], [class*="form-group"], fieldset') || input.parentElement;
  if (container) {
    const listbox = container.querySelector('[role="listbox"]');
    if (listbox) return listbox;
  }
  
  // 3. Look for any visible listbox near this input (portal rendered at body level)
  const allListboxes = document.querySelectorAll('[role="listbox"]');
  const inputRect = input.getBoundingClientRect();
  
  for (const lb of allListboxes) {
    const lbRect = lb.getBoundingClientRect();
    // Skip phone country code listboxes
    const lbClass = lb.className || '';
    if (lbClass.includes('iti__') || lbClass.includes('country-list')) continue;
    // Must be visible and reasonably close vertically
    if (lbRect.height > 0 && lbRect.width > 0 &&
        Math.abs(lbRect.top - inputRect.bottom) < 400) {
      return lb;
    }
  }
  
  return null;
}

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
      console.log('[Offlyn Smart] Setting dropdown value (React-compat):', fieldLabel, 'with:', value);
      
      // Focus + click to open dropdown (React needs both)
      element.focus();
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      element.click();
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Type value using React-compatible setter
      await simulateTyping(element, value, 30);
      await new Promise(resolve => setTimeout(resolve, 400));
      
      // Try to find and click the matching option in the listbox
      const listbox = findAssociatedListbox(element);
      let clicked = false;
      
      if (listbox) {
        const options = Array.from(listbox.querySelectorAll('[role="option"], li, div[data-value]'));
        const valLower = value.toLowerCase().trim();
        
        for (const opt of options) {
          const optText = (opt.textContent || '').trim();
          if (optText.length < 1 || optText.length > 100) continue;
          if (/^options?\s*:/i.test(optText)) continue;
          
          const optLower = optText.toLowerCase();
          if (optLower === valLower || optLower.includes(valLower) || valLower.includes(optLower)) {
            console.log('[Offlyn Smart] ✓ Clicking option:', optText);
            (opt as HTMLElement).click();
            clicked = true;
            await new Promise(resolve => setTimeout(resolve, 100));
            break;
          }
        }
      }
      
      if (!clicked) {
        // Keyboard fallback: ArrowDown + Enter
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 80));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      element.blur();
      filledSelectors.add(selector);
      info(`✓ AI-filled "${value}" for dropdown: ${fieldLabel}`);
    }
    // Standard field types
    else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setNativeInputValue(element, value);
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
 * Handle right-click text transform actions (Professional Fix / Expand / Shorten).
 * Gets the selected text from the active editable element, sends it to Ollama,
 * and replaces the selection (or the full value) with the transformed text.
 */
async function handleTextTransform(action: string): Promise<void> {
  const activeEl = document.activeElement;
  if (!activeEl) return;

  const isInput = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;
  if (!isInput) {
    warn('[TextTransform] Active element is not an editable field');
    return;
  }

  const inputEl = activeEl as HTMLInputElement | HTMLTextAreaElement;

  // Get selected text, or fall back to the full value
  const selStart = inputEl.selectionStart ?? 0;
  const selEnd = inputEl.selectionEnd ?? 0;
  const fullValue = inputEl.value || '';

  const hasSelection = selEnd > selStart;
  const selectedText = hasSelection ? fullValue.substring(selStart, selEnd) : fullValue;

  if (!selectedText.trim()) {
    warn('[TextTransform] No text selected / field is empty');
    return;
  }

  info(`[TextTransform] Action: "${action}" on ${selectedText.length} chars`);

  // Show an inline loading indicator on the field
  const originalBorder = inputEl.style.border;
  const originalBoxShadow = inputEl.style.boxShadow;
  inputEl.style.transition = 'box-shadow 0.2s ease';
  inputEl.style.boxShadow = '0 0 0 2px rgba(102, 126, 234, 0.4)';

  // Show a small toast
  showNotification('Offlyn AI', `Applying "${action}"...`, 'info', 3000);

  try {
    const { transformText } = await import('./shared/text-transform-service');
    const result = await transformText(selectedText, action as any);

    if (!result) {
      showWarning('Transform Failed', 'AI could not transform the text. Is Ollama running?');
      return;
    }

    // Replace the text
    autofillInProgress = true; // Prevent learning system from treating this as a user edit

    if (hasSelection) {
      // Replace only the selected portion
      const before = fullValue.substring(0, selStart);
      const after = fullValue.substring(selEnd);
      const newValue = before + result + after;

      // Use native setter for React compatibility
      const nativeSet = Object.getOwnPropertyDescriptor(
        inputEl instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeSet) {
        nativeSet.call(inputEl, newValue);
      } else {
        inputEl.value = newValue;
      }

      // Set cursor at the end of the replaced text
      const newCursorPos = selStart + result.length;
      inputEl.setSelectionRange(newCursorPos, newCursorPos);
    } else {
      // Replace the full value
      const nativeSet = Object.getOwnPropertyDescriptor(
        inputEl instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeSet) {
        nativeSet.call(inputEl, result);
      } else {
        inputEl.value = result;
      }
    }

    // Fire events so React/frameworks pick up the change
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    autofillInProgress = false;

    info(`[TextTransform] Done. Replaced ${selectedText.length} chars → ${result.length} chars`);
    showSuccess('Text Transformed', `"${action}" applied successfully.`);
  } catch (err) {
    error('[TextTransform] Error:', err);
    showError('Transform Error', 'An error occurred while transforming the text.');
  } finally {
    // Restore field style
    autofillInProgress = false;
    inputEl.style.boxShadow = originalBoxShadow;
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

      // Handle right-click text transforms (Professional Fix / Expand / Shorten)
      if ((message as any).kind === 'TEXT_TRANSFORM') {
        const action = (message as any).action as string;
        handleTextTransform(action);
        return Promise.resolve();
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
        // Multi-page flow: wait for actual state transition before rescanning
        info('Detected "Next" button click, waiting for state transition...');
        waitForStateTransition().then(() => {
          info('State transition detected, re-scanning for new fields...');
          detectPage();
        });
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
