/**
 * Content script for detecting job application pages and filling forms
 */

import type { ApplyEvent, FillPlan, FillResult, JobMeta, FieldSchema, PageClassification } from './shared/types';
import { extractJobMetadata, extractFormSchema, isJobConfirmationPage, classifyPage, isTrustedATSIframe } from './shared/dom';
import { log, info, warn, error } from './shared/log';
import { hideFieldSummary, ensureFieldSummaryExpanded } from './ui/field-summary';
import { showCompatibilityWidget, updateCompatibilityFields, removeCompatibilityWidget } from './ui/compatibility-widget';
import { getUserProfile, saveUserProfile, type UserProfile } from './shared/profile';
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
import { rlSystem } from './shared/learning-rl';
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
import { showNotification, showSuccess, showError, showWarning, showInfo, showWorkdayBetaBanner } from './ui/notification';
import { showAutofillNotification, hideAutofillNotification, showShoppingHelperNotification } from './ui/autofill-notification';
import { showTrackingBadge, hideTrackingBadge } from './ui/tracking-badge';
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
import { isWorkdayPage, detectWorkdayStep, runWorkdaySpecialHandlers } from './shared/workday-handler';
import { applyGraphEnhancement } from './shared/autofill';
import { detectFieldType } from './shared/context-aware-storage';
import { showFillDebugPanel } from './ui/fill-debug-panel';

const IS_TOP_FRAME = window.self === window.top;

let lastJobMeta: JobMeta | null = null;
let lastSchema: string | null = null;
let resumeFilesUploaded: Set<string> = new Set(); // Track which file inputs we've already filled
let filledSelectors: Set<string> = new Set(); // Track which fields have been filled
let userEditedFields: Set<string> = new Set(); // Track which fields user has manually edited

/** Latest page classification result — used to gate fill/learn behaviour */
let pageClassification: PageClassification | null = null;

/** Tracks the last right-clicked editable field for the debug panel. */
let lastRightClickedField: { selector: string; label: string; value: string } | null = null;

// Capture the field under the cursor when the context menu opens
document.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement;
  if (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    (el as HTMLElement).isContentEditable
  ) {
    const input = el as HTMLInputElement;
    const selector = input.id
      ? `#${CSS.escape(input.id)}`
      : input.name
        ? `[name="${CSS.escape(input.name)}"]`
        : el.tagName.toLowerCase();

    // Try to find a richer label from already-detected field schema
    const matchedSchema = allDetectedFields.find(f => f.selector === selector);

    // Walk the DOM for an associated <label> element
    const domLabel = (() => {
      const id = input.id;
      if (id) {
        const labelEl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (labelEl) return (labelEl.textContent ?? '').trim();
      }
      const closest = el.closest('.form-group, .field-wrapper, [class*="field"], [class*="form"], [class*="input"]');
      if (closest) {
        const lbl = closest.querySelector('label');
        if (lbl) return (lbl.textContent ?? '').trim();
      }
      return '';
    })();

    const label =
      matchedSchema?.label ||
      (el.closest('[data-label]') as HTMLElement | null)?.dataset.label ||
      input.getAttribute('aria-label') ||
      domLabel ||
      input.placeholder ||
      input.name ||
      input.id ||
      '';

    lastRightClickedField = {
      selector,
      label,
      value: input.value ?? (el as HTMLElement).textContent ?? '',
    };
  }
}, true);
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
  // Track which fields the user has touched manually.
  // We do NOT record corrections here — only at form submission.
  // This prevents partial / in-progress edits from being stored.
  function trackEdit(target: EventTarget | null): void {
    if (autofillInProgress) return;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      const selector = generateFieldSelector(target);
      if (selector) {
        userEditedFields.add(selector);
      }
    }
  }

  document.addEventListener('input',  (e) => trackEdit(e.target), true);
  document.addEventListener('change', (e) => trackEdit(e.target), true);
}

// recordUserCorrection has been removed.
// All learning (corrections + successes + new values) is now done
// at form-submission time inside learnFromCurrentFormValues().

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
    console.log('[OA] detectPage() called');
    console.log('[OA] URL:', window.location.href);
    
    // ── Confirmation-page fast path ────────────────────────────────────────
    // A /confirmation or /thank-you URL is definitive proof of submission.
    // Record the application immediately without requiring form fields.
    if (isJobConfirmationPage()) {
      console.log('[OA] ✓ Confirmation/thank-you page detected — recording submission');

      // Avoid double-recording if we already fired for this exact URL.
      // This also guards against the form-submit handler having already recorded
      // the same (company + title) pair milliseconds earlier.
      const confirmationKey = `offlyn_confirmed_${window.location.href}`;
      if (sessionStorage.getItem(confirmationKey)) {
        console.log('[OA] Confirmation already recorded this session, skipping');
        return;
      }
      sessionStorage.setItem(confirmationKey, '1');

      // Prefer the job metadata stored during the fill phase (same iframe session)
      // so we get the real job title instead of "Confirmation" from the thank-you heading.
      let jobMeta = extractJobMetadata();
      try {
        const stored = sessionStorage.getItem('offlyn_last_job_meta');
        if (stored) {
          const parsed = JSON.parse(stored) as typeof jobMeta;
          // Use stored values only when they are more informative than what we just scraped
          if (parsed.jobTitle && parsed.jobTitle !== jobMeta.jobTitle) {
            console.log('[OA] Using stored job title from fill phase:', parsed.jobTitle);
            jobMeta = { ...jobMeta, ...parsed };
          }
        }
      } catch (_) { /* ignore JSON parse errors */ }

      showTrackingBadge(jobMeta.jobTitle, jobMeta.company);

      const event: ApplyEvent = {
        kind: 'JOB_APPLY_EVENT',
        eventType: 'SUBMIT_ATTEMPT',
        jobMeta,
        schema: [],
        timestamp: Date.now(),
      };
      sendToBackground(event);
      return;
    }

    const classification = classifyPage();
    pageClassification = classification;
    console.log('[OA] Page state:', classification.state, '|', classification.detectionReason);

    if (classification.state === 'NOT_JOB_PAGE') {
      console.warn('[OA] Not a job page — skipping');
      return;
    }

    if (classification.state === 'FORM_HELPER_PAGE') {
      console.log('[OA] Shopping checkout page — showing helper notification, filling name/address only (credit cards excluded)');
      showShoppingHelperNotification();
      // Credit card fields are excluded via JUNK_CC_LABEL_RE in field-classifier.ts
      // Fall through to normal autofill flow but skip tracking badge and graph learning
    }

    if (classification.state === 'JOB_POSTING_PAGE') {
      // Job detail / listing page — the application form hasn't opened yet.
      // Show a passive badge but do NOT scan, fill, or learn.
      console.log('[OA] Job posting page detected — waiting for application form to open');
      const jobMeta = extractJobMetadata();
      showTrackingBadge(jobMeta.jobTitle, jobMeta.company);
      return;
    }

    // ── JOB_APPLICATION_PAGE ──────────────────────────────────────────────────
    console.log('[OA] ✓ Detected as job application page!');

    // Workday beta warning — shown once per session at the bottom of the screen
    if (isWorkdayPage()) {
      showWorkdayBetaBanner(browser.runtime.getURL('icons/monogram-nosquare.png'));
    }

    const jobMeta = extractJobMetadata();

    // If a trusted ATS iframe is handling the form, skip parent-page field scan.
    // The iframe's own content script will report its fields via OFFLYN_IFRAME_FIELDS.
    if (classification.parentFillSuppressed) {
      console.log('[OA] Trusted ATS iframe detected — suppressing parent-page field scan');
      showTrackingBadge(jobMeta.jobTitle, jobMeta.company);

      // Show the widget with 0 fields for now; it will be updated when the iframe reports back
      if (IS_TOP_FRAME) {
        void (async () => {
          try {
            const profileForCompat = await getUserProfile();
            if (profileForCompat) {
              showCompatibilityWidget(
                profileForCompat,
                jobMeta.jobTitle || '',
                jobMeta.company || '',
                document.body.innerText || '',
                [], // fields will arrive via OFFLYN_IFRAME_FIELDS
                browser.runtime.getURL('icons/monogram-nosquare.png'),
                browser.runtime.getURL('icons/primary-logo.png')
              );
            }
          } catch (_) { /* non-critical */ }
        })();
      }
      return;
    }

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

      // Persist job metadata to sessionStorage so the /confirmation page (which
      // loads as a fresh script context in the same iframe) can retrieve the real
      // job title instead of scraping "Confirmation" from the thank-you heading.
      try {
        sessionStorage.setItem('offlyn_last_job_meta', JSON.stringify(jobMeta));
      } catch (_) { /* storage unavailable — ignore */ }

      // Show subtle tracking badge so user knows this application will be recorded
      // (suppressed on shopping/checkout pages — shopping notification already shown)
      if (classification.state !== 'FORM_HELPER_PAGE') {
        showTrackingBadge(jobMeta.jobTitle, jobMeta.company);
      }

      // Show the "Autofill Ready" pulsing notification when fields are detected
      // (suppressed on FORM_HELPER_PAGE — shopping notification already shown)
      if (uniqueFields.length > 0 && classification.state !== 'FORM_HELPER_PAGE') {
        showAutofillNotification(uniqueFields.length);
      }

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

      // If running inside an iframe, forward field schema to the parent frame and skip
      // showing the widget here — the parent will render a single unified panel.
      if (!IS_TOP_FRAME) {
        try {
          window.parent.postMessage({
            type: 'OFFLYN_IFRAME_FIELDS',
            fields: uniqueFields,
            url: window.location.href,
          }, '*');
        } catch (_) { /* cross-origin, parent can't be reached — ignore */ }
        return;
      }

      // Show unified floating widget (compatibility oval + action panel)
      void (async () => {
        try {
          const profileForCompat = await getUserProfile();
          if (profileForCompat) {
            const pageText = document.body.innerText || '';
            showCompatibilityWidget(
              profileForCompat,
              jobMeta.jobTitle || '',
              jobMeta.company || '',
              pageText,
              uniqueFields,
              browser.runtime.getURL('icons/monogram-nosquare.png'),
              browser.runtime.getURL('icons/primary-logo.png')
            );
          }
        } catch (_) { /* non-critical */ }
      })();

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
    
    let mappings = generateFillMappings(schema, profile);

    // Enhance with graph memory — fills any fields not matched by profile/RL
    try {
      mappings = await applyGraphEnhancement(schema, mappings, {
        platform: lastJobMeta?.atsHint ?? undefined,
        company: lastJobMeta?.company ?? undefined,
        jobTitle: lastJobMeta?.jobTitle ?? undefined,
        url: window.location.href,
      });
    } catch (err) {
      warn('[Graph] Enhancement failed, continuing with profile mappings:', err);
    }

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

    // Workday-specific: handle "Add" modal sections (Work Experience, Education,
    // Languages) and the Skills tag-input that the generic engine cannot reach.
    if (isWorkdayPage()) {
      const wdStep = detectWorkdayStep();
      info(`[Workday] Step detected: "${wdStep}"`);
      try {
        await runWorkdaySpecialHandlers(profile);
      } catch (wdErr) {
        warn('[Workday] Special handler error (non-fatal):', wdErr);
      }
    }
    
    // Also try to fill resume file inputs (await to catch errors)
    await fillResumeFileInputs();

    // Post-fill re-scan: Some fields appear dynamically after other fields are filled
    // (e.g., "Please identify your race" appears after Hispanic/Latino = "No")
    // Wait for React to re-render, then re-scan for newly appeared fields
    await postFillRescan(profile);

    // Retry resume upload after post-fill rescan (file inputs may appear after form renders)
    await fillResumeFileInputs();

    // Delayed retry for ATS sites that lazy-load file inputs (e.g. Workday)
    setTimeout(async () => {
      const newInputs = findAllFileInputs().filter(input => {
        const id = input.id || input.name || generateInputSelector(input);
        return !resumeFilesUploaded.has(id);
      });
      if (newInputs.length > 0) {
        log(`[Resume] Delayed retry: found ${newInputs.length} new file input(s)`);
        await fillResumeFileInputs();
      }
    }, 3000);
    
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
        
        // Check RL learning system first (faster than AI, in-memory lookup)
        let value: string | null = null;
        try {
          const learned = rlSystem.getLearnedValue(unfilled.field);
          if (learned && learned.value.trim() !== '') {
            info(`[RL] Using learned value for "${unfilled.context.label}": "${learned.value}" (confidence: ${learned.confidence.toFixed(2)})`);
            value = learned.value;
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

    // Resolve the target element upfront so we can stream into it
    let targetEl: HTMLInputElement | HTMLTextAreaElement | null = null;
    if (selector.includes('::shadow::')) {
      const [hostSel, fieldSel] = selector.split('::shadow::');
      const host = document.querySelector(hostSel);
      if (host?.shadowRoot) {
        targetEl = host.shadowRoot.querySelector(fieldSel) as HTMLInputElement | HTMLTextAreaElement | null;
      }
    } else {
      targetEl = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
    }

    // onChunk: stream partial AI text directly into the field as it's generated
    const onChunk = targetEl
      ? (partial: string) => {
          setNativeInputValue(targetEl!, partial);
        }
      : undefined;

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
      true, // use AI
      onChunk
    );

    if (!suggestion || suggestion.suggestions.length === 0) {
      warn(`[InlineTile] No suggestion found for "${field.label || field.name}"`);
      showInfo('No Suggestion', `Could not generate a suggestion for "${field.label || field.name}".`);
      return;
    }

    // Use the primary (best) suggestion
    const primary = suggestion.suggestions.find(s => s.isPrimary) || suggestion.suggestions[0];
    info(`[InlineTile] Applying suggestion: "${primary.value}" (source: ${primary.source}, confidence: ${primary.confidence})`);

    // Final fill with the cleaned/validated value (overwrites any partial stream)
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

// ── Cover letter state ──────────────────────────────────────────────────────
let coverLetterGenerating = false;
let lastCoverLetterResult: { text: string; jobTitle: string; company: string; generatedAt: number } | null = null;
let lastCoverLetterAutoApplySelector: string | null = null;

/**
 * Listen for cover letter generation trigger.
 * If a letter was already generated, just re-open the panel with the cached result.
 * If generation is already in progress, just re-show the panel (no duplicate work).
 */
window.addEventListener('offlyn-generate-cover-letter', () => {
  if (coverLetterGenerating) {
    // Already generating — just make sure panel is visible
    if (!isCoverLetterPanelVisible()) {
      const title = lastJobMeta?.jobTitle || 'Position';
      const company = lastJobMeta?.company || 'Company';
      const autoApply = lastCoverLetterAutoApplySelector
        ? (text: string) => applyCoverLetterToField(lastCoverLetterAutoApplySelector!, text)
        : undefined;
      openCoverLetterPanel(title, company, autoApply);
    }
    return;
  }

  if (lastCoverLetterResult) {
    // Already have a result — re-open panel showing the cached letter
    reopenCoverLetterWithResult();
    return;
  }

  triggerCoverLetterGeneration();
});

/**
 * Listen for cover letter regeneration (from the panel's "Regenerate" button).
 * Always forces a fresh generation, clearing the cache.
 */
window.addEventListener('offlyn-regenerate-cover-letter', () => {
  lastCoverLetterResult = null;
  triggerCoverLetterGeneration();
});

/**
 * When user presses back from cover letter panel, expand the field summary
 * and keep it expanded (no auto-minimize).
 */
window.addEventListener('offlyn-cover-letter-back', () => {
  ensureFieldSummaryExpanded();
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

    const refinedResult = {
      text: refined,
      jobTitle: lastJobMeta?.jobTitle || '',
      company: lastJobMeta?.company || '',
      generatedAt: Date.now(),
    };
    lastCoverLetterResult = refinedResult;
    showCoverLetterResult(refinedResult);

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
  if (coverLetterGenerating) return; // prevent double-fire
  coverLetterGenerating = true;

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
    lastCoverLetterAutoApplySelector = coverLetterField;

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

    // 7. Cache the result + show it
    lastCoverLetterResult = result;
    showCoverLetterResult(result);
    showSuccess('Cover Letter Ready', 'Your tailored cover letter has been generated.');
  } catch (err: any) {
    error('Cover letter generation failed:', err);
    showCoverLetterError(err?.message || 'Generation failed. Is Ollama running?');
  } finally {
    coverLetterGenerating = false;
  }
}

/**
 * Re-open the cover letter panel showing the previously generated letter.
 */
function reopenCoverLetterWithResult(): void {
  if (!lastCoverLetterResult) return;

  const autoApply = lastCoverLetterAutoApplySelector
    ? (text: string) => applyCoverLetterToField(lastCoverLetterAutoApplySelector!, text)
    : undefined;

  openCoverLetterPanel(
    lastCoverLetterResult.jobTitle || 'Position',
    lastCoverLetterResult.company || 'Company',
    autoApply,
  );

  // Immediately show the cached result (skip generating state)
  showCoverLetterResult(lastCoverLetterResult);
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
    warn('[Autofill] No detected fields in this frame. Refresh the scan first.');
  }

  // Top frame: forward autofill trigger only to trusted ATS iframes (Greenhouse, Lever,
  // Workday, etc.). Explicitly skip chat widgets, ShareThis, about:blank, analytics
  // embeds, and any iframe whose origin does not match a known ATS platform.
  if (IS_TOP_FRAME) {
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const iframe of iframes) {
      if (!isTrustedATSIframe(iframe.src)) {
        info(`[Autofill] Skipping non-ATS iframe: ${iframe.src || 'about:blank'}`);
        continue;
      }
      try {
        iframe.contentWindow?.postMessage({ type: 'OFFLYN_TRIGGER_AUTOFILL' }, '*');
        info(`[Autofill] Forwarded autofill trigger to trusted ATS iframe: ${iframe.src}`);
      } catch (_) {
        // Cross-origin — content script in that frame handles its own autofill
      }
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
  } else if (event.data.type === 'OFFLYN_IFRAME_FIELDS' && IS_TOP_FRAME) {
    // A child iframe detected a job application form and reported its fields.
    // If the iframe has more fields than what we see in the parent page, update
    // the widget so the user sees the real form's field count.
    const iframeFields = event.data.fields as FieldSchema[];
    const iframeUrl = event.data.url as string;
    if (Array.isArray(iframeFields) && iframeFields.length > allDetectedFields.length) {
      info(`[OA] Child iframe (${iframeUrl}) has ${iframeFields.length} fields — updating widget`);
      updateCompatibilityFields(iframeFields);
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
        console.log('[OA] State transition: URL changed');
        resolved = true;
        resolve();
        return;
      }
      
      // Check 2: Step title changed
      const currentStepTitle = document.querySelector('[class*="step"], [class*="page"], h1, h2')?.textContent || '';
      if (currentStepTitle && currentStepTitle !== startStepTitle) {
        console.log('[OA] State transition: Step title changed');
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
        console.log('[OA] State transition: >50% of old fields detached');
        resolved = true;
        resolve();
        return;
      }
      
      // Check 4: Timeout - give up after max checks
      if (checkCount >= maxChecks) {
        console.log('[OA] State transition: timeout, proceeding anyway');
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
 * @param e   - The original DOM event
 * @param resolvedTarget - The nearest button/link ancestor (pre-resolved via closest())
 */
function handleSubmitAttempt(e: Event, resolvedTarget?: HTMLElement): void {
  try {
    // Use the pre-resolved button element when available (avoids missing clicks
    // on icon/span children of buttons). Fall back to e.target for submit events.
    const target = resolvedTarget ?? (e.target as HTMLElement);
    const text = (target.textContent || target.getAttribute('value') || '').trim();
    // Only match final-submit button labels. "Next" / "Continue" are
    // navigation buttons in multi-step forms and must NOT trigger tracking.
    const applyPattern = /apply|submit|finish|complete\s+(application|form)/i;

    if (!applyPattern.test(text)) {
      return;
    }

    // ── Job application guard ──────────────────────────────────────────
    // Only process if this page has already been identified as a job
    // application page. This prevents learning from login forms, search
    // boxes, newsletter signups, etc.
    // lastJobMeta is set by detectPage() only when isJobApplicationPage()
    // returns true, so it is the reliable indicator.
    if (!lastJobMeta) {
      return;
    }
    
    const jobMeta = lastJobMeta;
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
    // Use the pre-scanned fields if available — they were scanned when the
    // page was first identified as a job application page.
    const fieldsToLearn = allDetectedFields.length > 0 ? allDetectedFields : allFields;
    learnFromCurrentFormValues(fieldsToLearn, jobMeta);
  } catch (err) {
    error('Error handling submit attempt:', err);
  }
}

/**
 * Learn from ALL field values present at form submission.
 *
 * For each field with a non-empty value we decide:
 *   1. Field was autofilled AND user kept the value  → recordSuccess  (positive RL)
 *   2. Field was autofilled AND user changed the value → recordCorrection (negative RL)
 *   3. Field was NOT autofilled (user typed it fresh)  → recordSuccess  (learn new value)
 *
 * After recording RL signals we also call updateProfileFromSubmission() to
 * persist any new data back into the user's profile.
 */
async function learnFromCurrentFormValues(
  fields: FieldSchema[],
  jobMeta: JobMeta | null
): Promise<void> {
  try {
    // Double-guard: refuse to learn if there's no confirmed job context.
    // This is a safety net in case this function is ever called directly
    // without going through handleSubmitAttempt's guard.
    if (!jobMeta) {
      info('[RL] Skipping learning — no job context (not a job application page)');
      return;
    }

    // Also require that we have at least some detected fields — an empty field
    // list means this page was never properly scanned as a job application.
    if (fields.length === 0) {
      info('[RL] Skipping learning — no detected fields');
      return;
    }

    const jobCtx = {
      url: window.location.href,
      company: jobMeta.company || '',
      jobTitle: jobMeta.jobTitle || '',
    };

    // Collect current DOM values for all fields
    const fieldValues = new Map<string, string>(); // selector → current value
    for (const field of fields) {
      const el = document.querySelector(field.selector);
      if (!el) continue;
      const value = getFieldValue(el);
      if (value && value.trim()) {
        fieldValues.set(field.selector, value.trim());
      }
    }

    if (fieldValues.size === 0) {
      info('[RL] No field values found at submission — nothing to learn');
      return;
    }

    let corrections = 0;
    let successes = 0;

    for (const field of fields) {
      // Skip file inputs, hidden fields, and disabled fields
      if (field.type === 'file' || field.disabled) continue;

      // Never learn from untrusted fields (cookie banners, chat widgets, marketing embeds)
      if (field.learnEligible === false || field.trustTier === 3) {
        info(`[RL] Skipping learning for untrusted field "${field.label}" (tier=${field.trustTier}, reason=${field.exclusionReason ?? 'none'})`);
        continue;
      }

      const currentValue = fieldValues.get(field.selector);
      if (!currentValue) continue; // blank field — skip

      const autoFilled = autoFilledValues.get(field.selector);

      if (autoFilled) {
        const autoStr = String(autoFilled.value).trim();
        if (currentValue !== autoStr && currentValue !== '') {
          // User changed an autofilled field → correction (negative signal)
          info(`[RL] Correction at submit — "${field.label}": "${autoStr}" → "${currentValue}"`);
          await rlSystem.recordCorrection(field, autoStr, currentValue, jobCtx);
          corrections++;
          // Send graph correction to background (background owns graphMemory)
          browser.runtime.sendMessage({
            kind: 'GRAPH_RECORD_CORRECTION',
            questionText: field.label ?? '',
            canonicalField: detectFieldType(field.label ?? '', field.type ?? '', field.name ?? '') || undefined,
            originalValue: autoStr,
            correctedValue: currentValue,
            context: {
              company: lastJobMeta?.company ?? undefined,
              jobTitle: lastJobMeta?.jobTitle ?? undefined,
              url: window.location.href,
              platform: lastJobMeta?.atsHint ?? undefined,
            },
          }).catch(() => {});
        } else {
          // User kept the autofilled value → success (positive signal)
          await rlSystem.recordSuccess(field, currentValue, jobCtx);
          successes++;
        }
      } else {
        // Field was NOT autofilled — user typed it themselves.
        // Treat as a success so we learn this value for next time.
        await rlSystem.recordSuccess(field, currentValue, jobCtx);
        successes++;
      }
    }

    info(`[RL] Submission learning complete: ${successes} successes, ${corrections} corrections`);

    if (successes + corrections > 0) {
      showNotification(
        'Learning updated',
        `Saved ${successes + corrections} field value${successes + corrections !== 1 ? 's' : ''} for future applications`,
        'info',
        3000
      );
    }

    // Persist new values into the user profile
    await updateProfileFromSubmission(fieldValues, fields);

  } catch (err) {
    error('[RL] Error learning from submission:', err);
  }
}

/**
 * Map submitted field values back into the user's stored profile.
 *
 * Only updates fields that are clearly identifiable (email, phone, LinkedIn,
 * GitHub, portfolio, location, name) and only when the submitted value is
 * non-empty and longer than what the profile already has (or when the profile
 * field is empty).  This prevents overwriting good data with garbage.
 */
async function updateProfileFromSubmission(
  fieldValues: Map<string, string>,   // selector → final submitted value
  fields: FieldSchema[]
): Promise<void> {
  try {
    const profile = await getUserProfile();
    if (!profile) return;

    let changed = false;

    for (const field of fields) {
      const value = fieldValues.get(field.selector);
      if (!value || !value.trim()) continue;

      const v = value.trim();
      const label = (field.label || field.name || field.id || '').toLowerCase();
      const name  = (field.name  || '').toLowerCase();
      const id    = (field.id    || '').toLowerCase();

      // Helper: does any of label/name/id include the keyword?
      const has = (...keywords: string[]) =>
        keywords.some(k => label.includes(k) || name.includes(k) || id.includes(k));

      // ── Personal ───────────────────────────────────────────────────────

      if (has('email', 'e-mail')) {
        if (!profile.personal.email || profile.personal.email.trim() === '') {
          profile.personal.email = v;
          changed = true;
        }
      }

      if (has('first', 'fname', 'firstname', 'given') &&
          !has('last', 'lname', 'lastname')) {
        if (!profile.personal.firstName || profile.personal.firstName.trim() === '') {
          profile.personal.firstName = v;
          changed = true;
        }
      }

      if (has('last', 'lname', 'lastname', 'surname', 'family') &&
          !has('first', 'fname')) {
        if (!profile.personal.lastName || profile.personal.lastName.trim() === '') {
          profile.personal.lastName = v;
          changed = true;
        }
      }

      if (has('phone', 'mobile', 'tel', 'telephone') &&
          !has('country', 'code', 'extension', 'ext')) {
        const existingPhone = typeof profile.personal.phone === 'string'
          ? profile.personal.phone
          : '';
        // Only update if profile phone is empty or the user typed something longer/different
        if (!existingPhone || existingPhone.trim() === '') {
          profile.personal.phone = v;
          changed = true;
        }
      }

      if (has('location', 'city', 'address') &&
          !has('country', 'state', 'zip', 'postal', 'sponsor', 'visa', 'authorize')) {
        const existingLoc = typeof profile.personal.location === 'string'
          ? profile.personal.location
          : '';
        if (!existingLoc || existingLoc.trim() === '') {
          profile.personal.location = v;
          changed = true;
        }
      }

      // ── Professional ──────────────────────────────────────────────────

      if (has('linkedin', 'linked-in')) {
        if (!profile.professional.linkedin || profile.professional.linkedin.trim() === '') {
          profile.professional.linkedin = v;
          changed = true;
        } else if (v.length > profile.professional.linkedin.length) {
          // Accept longer (more complete) URL
          profile.professional.linkedin = v;
          changed = true;
        }
      }

      if (has('github', 'git') && !has('ignore', 'skip')) {
        if (!profile.professional.github || profile.professional.github.trim() === '') {
          profile.professional.github = v;
          changed = true;
        } else if (v.length > profile.professional.github.length) {
          profile.professional.github = v;
          changed = true;
        }
      }

      if (has('portfolio', 'website', 'personal site') &&
          !has('hear', 'find', 'source')) {
        if (!profile.professional.portfolio || profile.professional.portfolio.trim() === '') {
          profile.professional.portfolio = v;
          changed = true;
        }
      }
    }

    if (changed) {
      await saveUserProfile(profile);
      info('[RL] Profile updated with values from form submission');
    }
  } catch (err) {
    // Non-critical — log but don't throw
    error('[RL] Failed to update profile from submission:', err);
  }
}

/**
 * Load resume from storage, handling both chunked (new) and single-key (legacy) formats.
 * Chunked format is needed for resumes > ~300KB because browser.storage.local
 * fails to retrieve large single keys.
 */
async function loadResumeFromStorage(): Promise<{ name: string; type: string; size: number; base64: string } | null> {
  // Step 1: Read metadata (small key — should always succeed)
  let meta: { name: string; type: string; size: number; chunkCount?: number; chunked?: boolean } | null = null;
  try {
    const metaResult = await browser.storage.local.get('resumeFileMeta');
    meta = metaResult.resumeFileMeta || null;
  } catch (metaErr) {
    warn('[Resume] Could not read resumeFileMeta:', metaErr);
    // Storage may be fully broken — nothing we can do without the metadata
    return null;
  }

  // Step 2: Chunked format (new — saved after the storage fix)
  if (meta?.chunked && meta.chunkCount && meta.chunkCount > 0) {
    try {
      log(`[Resume] Loading ${meta.chunkCount} chunks for "${meta.name}" (${meta.size} bytes)`);
      const chunkKeys = Array.from({ length: meta.chunkCount }, (_, i) => `resumeChunk_${i}`);
      const chunkResults = await browser.storage.local.get(chunkKeys);
      const chunks: string[] = [];
      for (let i = 0; i < meta.chunkCount; i++) {
        const chunk = chunkResults[`resumeChunk_${i}`];
        if (!chunk) {
          error(`[Resume] Missing chunk ${i}/${meta.chunkCount} — please re-upload resume`);
          return null;
        }
        chunks.push(chunk);
      }
      const base64 = chunks.join('');
      log(`[Resume] Reassembled ${meta.chunkCount} chunks (${base64.length} chars)`);
      return { name: meta.name, type: meta.type, size: meta.size, base64 };
    } catch (chunkErr) {
      error('[Resume] Failed to read chunks:', chunkErr);
      return null;
    }
  }

  // Step 3: Legacy single-key format (old — may be too large for Firefox to read)
  // Wrap in its own try/catch: a large resumeFile key causes Firefox to throw
  // "An unexpected error occurred". If that happens we auto-remove the corrupt key
  // and notify the user to re-upload.
  log('[Resume] Trying legacy single-key format...');
  let resumeFile: any = null;
  try {
    const legacyResult = await browser.storage.local.get('resumeFile');
    resumeFile = legacyResult.resumeFile;
  } catch (legacyErr) {
    warn('[Resume] Legacy resumeFile key too large to read — removing corrupt key. Please re-upload your resume.');
    // Auto-clean the oversized key so future reads don't fail
    try {
      await browser.storage.local.remove('resumeFile');
      log('[Resume] Removed oversized resumeFile key from storage');
    } catch (_) { /* ignore */ }
    showNotification(
      'Resume needs re-upload',
      'Your resume was stored in an old format. Please open Profile settings and re-upload it.',
      'warning',
      8000
    );
    return null;
  }

  if (resumeFile?.dataBase64 && resumeFile.dataBase64.length > 0) {
    log(`[Resume] Loaded legacy base64 resume: ${resumeFile.name} (${resumeFile.size} bytes)`);
    return { name: resumeFile.name, type: resumeFile.type, size: resumeFile.size, base64: resumeFile.dataBase64 };
  }

  if (resumeFile?.data && Array.isArray(resumeFile.data) && resumeFile.data.length > 0) {
    // Very old number-array format — convert on the fly
    log(`[Resume] Loaded legacy array resume: ${resumeFile.name} — converting to base64`);
    const uint8Array = new Uint8Array(resumeFile.data);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i += 8192) {
      binary += String.fromCharCode(...uint8Array.subarray(i, i + 8192));
    }
    return { name: resumeFile.name, type: resumeFile.type, size: resumeFile.size, base64: btoa(binary) };
  }

  // Nothing found
  if (meta) {
    warn(`[Resume] Metadata found for "${meta.name}" (${meta.size} bytes) but no file data — please re-upload.`);
  } else {
    log('[Resume] No resume found in storage');
  }
  return null;
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
    log('═══ Resume Upload: Starting ═══');

    // Step 1: Load resume from storage (handles chunked + legacy formats)
    const resumeData = await loadResumeFromStorage();

    if (!resumeData) {
      log('[Resume Upload] No resume found in storage — skipping');
      return;
    }

    log(`[Resume Upload] Loaded: ${resumeData.name} (${resumeData.size} bytes)`);

    // Step 2: Create the File object from base64 data
    let file: File;
    try {
      const binaryString = atob(resumeData.base64);
      const uint8Array = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([uint8Array], { type: resumeData.type });
      file = new File([blob], resumeData.name, { type: resumeData.type, lastModified: Date.now() });
      log(`[Resume Upload] Created File object: ${file.name} (${file.size} bytes)`);
    } catch (fileErr) {
      error('[Resume Upload] Failed to create File object:', fileErr);
      return;
    }

    // Step 3: Find all file input fields
    const fileInputs = findAllFileInputs();
    log(`[Resume Upload] Found ${fileInputs.length} file input(s) on page`);

    if (fileInputs.length === 0) {
      log('[Resume Upload] No file inputs found — checking for upload buttons/drop zones...');
      const triggered = await triggerFileInputViaButton();
      if (triggered) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const newFileInputs = findAllFileInputs();
        if (newFileInputs.length > 0) {
          info(`[Resume Upload] Found ${newFileInputs.length} file input(s) after triggering upload button`);
          await attachFileToInputs(newFileInputs, file);
        } else {
          log('[Resume Upload] Still no file inputs after triggering upload button');
        }
      }
      return;
    }

    // Step 4: Attach file to inputs
    await attachFileToInputs(fileInputs, file);
    log('═══ Resume Upload: Complete ═══');

  } catch (err) {
    error('[Resume Upload] Fatal error:', err);
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
 * Attach a File object to file input elements.
 * Returns { successCount, failedCount } for caller notification.
 */
async function attachFileToInputs(fileInputs: HTMLInputElement[], file: File): Promise<{ successCount: number; failedCount: number }> {
  let successCount = 0;
  let failedCount = 0;

  for (const fileInput of fileInputs) {
    try {
      const inputId = fileInput.id || fileInput.name || generateInputSelector(fileInput);
      log(`[Resume] ─── Input: ${inputId}`);

      // Skip already-uploaded inputs
      if (resumeFilesUploaded.has(inputId)) {
        log(`[Resume] Already uploaded to: ${inputId} — skipping`);
        continue;
      }

      // Check if this looks like a resume upload field
      const isResume = isResumeFileInput(fileInput);
      if (!isResume) {
        log(`[Resume] Not a resume field, skipping: ${inputId}`);
        continue;
      }

      // Skip if input already has a file
      if (fileInput.files && fileInput.files.length > 0) {
        log(`[Resume] Already has a file: ${inputId} — skipping`);
        continue;
      }

      const isVisible = fileInput.offsetParent !== null;
      const isHiddenStyle = fileInput.style.display === 'none' || fileInput.style.visibility === 'hidden';
      log(`[Resume] Visibility: ${isVisible ? 'visible' : 'not-in-layout'}, style hidden: ${isHiddenStyle}`);

      let success = false;

      // Method 1: DataTransfer API
      log('[Resume] Trying Method 1: DataTransfer API...');
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        try {
          fileInput.files = dataTransfer.files;
          success = fileInput.files.length > 0;
        } catch (assignErr) {
          log('[Resume] Direct files assignment failed, trying defineProperty...');
          Object.defineProperty(fileInput, 'files', {
            value: dataTransfer.files,
            writable: true,
            configurable: true,
          });
          success = fileInput.files.length > 0;
        }
        if (success) log('[Resume] Method 1 succeeded');
      } catch (dtErr) {
        log(`[Resume] Method 1 failed: ${(dtErr as Error).message}`);
      }

      // Method 2: ClipboardEvent (Firefox fallback)
      if (!success) {
        log('[Resume] Trying Method 2: ClipboardEvent...');
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
          fileInput.dispatchEvent(event);
          success = fileInput.files !== null && fileInput.files.length > 0;
          if (success) log('[Resume] Method 2 succeeded');
          else log('[Resume] Method 2 dispatched but files not set');
        } catch (clipErr) {
          log(`[Resume] Method 2 failed: ${(clipErr as Error).message}`);
        }
      }

      // Method 3: Drag-and-drop simulation
      if (!success) {
        log('[Resume] Trying Method 3: Drag-and-drop simulation...');
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const dropZone = fileInput.closest('[class*="drop"], [class*="upload"]') || fileInput.parentElement;
          const target = dropZone || fileInput;
          target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
          target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
          target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
          await new Promise(resolve => setTimeout(resolve, 200));
          success = fileInput.files !== null && fileInput.files.length > 0;
          if (success) log('[Resume] Method 3 succeeded');
          else log('[Resume] Method 3 dispatched but files not set');
        } catch (dragErr) {
          log(`[Resume] Method 3 failed: ${(dragErr as Error).message}`);
        }
      }

      if (success) {
        // Dispatch events for React/Vue/Angular to pick up the file
        fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        fileInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, composed: true }));
        resumeFilesUploaded.add(inputId);
        successCount++;
        info(`[Resume] Attached "${file.name}" to: ${inputId}`);
      } else {
        failedCount++;
        warn(`[Resume] All methods failed for: ${inputId} — manual upload required`);
      }

    } catch (err) {
      error('[Resume] Error processing input:', err);
      failedCount++;
    }
  }

  log(`[Resume] Summary: ${successCount} succeeded, ${failedCount} failed`);

  // Show user notification
  if (successCount > 0) {
    showNotification(
      'Resume Attached',
      `Attached ${file.name} to ${successCount} field${successCount > 1 ? 's' : ''}`,
      'success',
      3000
    );
  } else if (failedCount > 0) {
    showNotification(
      'Resume Upload Failed',
      `Could not attach resume automatically. Please upload it manually.`,
      'warning',
      5000
    );
  }

  return { successCount, failedCount };
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
  
  // Container text match (less specific)
  const parentHasResumeKeyword = resumeKeywords.some(kw => parentText.includes(kw));

  // Also check sibling/nearby label text for "resume" or "cv"
  const siblingText = (fileInput.previousElementSibling?.textContent || '').toLowerCase() +
                      (fileInput.nextElementSibling?.textContent || '').toLowerCase();
  const siblingHasResumeKeyword = resumeKeywords.some(kw => siblingText.includes(kw));

  // Require an explicit resume keyword — either in field attributes, parent, or sibling.
  // The old broad fallback "any file input on a job page that accepts PDFs" was attaching
  // resumes to "Additional Attachments" and other file inputs that are not the resume field.
  return hasResumeKeyword || (hasFileType && (parentHasResumeKeyword || siblingHasResumeKeyword));
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
          console.warn(`[OA] ⚠️ Validation error for "${fieldLabel}": ${errorText}`);
          highlightFieldAsError(selector);
          return;
        }
      }
    }
  }
  
  // Check if field itself is marked as invalid
  if (element.getAttribute('aria-invalid') === 'true') {
    console.warn(`[OA] ⚠️ Field "${fieldLabel}" marked as invalid`);
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
  
  console.log('[OA] Exclusive checkbox detected:', label);
  
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
    console.log(`[OA] Unchecking ${groupCheckboxes.length} other checkboxes in exclusive group`);
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
            console.log('[OA] Found field in Shadow DOM:', hostSelector);
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

      // Query RL learning system for suggestions (in-memory, fast lookup)
      let finalValue = mapping.value;
      if (fieldSchema) {
        try {
          const learned = rlSystem.getLearnedValue(fieldSchema);
          // Only apply when learned value is non-empty and different from current mapping
          const learnedStr = learned?.value?.trim() ?? '';
          if (learned && learnedStr !== '' && learnedStr !== String(mapping.value).trim()) {
            info(`[RL] Using learned value for "${fieldSchema.label}": "${learned.value}" (confidence: ${learned.confidence.toFixed(2)})`);
            finalValue = learned.value;
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
        console.log('[OA] Filling Shadow DOM dropdown/autocomplete:', mapping.selector, 'with:', finalValue);
        
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
            console.log('[OA] Found', options.length, 'options in dropdown');
            
            for (const option of options) {
              const optionText = option.textContent?.trim().toLowerCase();
              const valueText = String(finalValue).toLowerCase();
              
              if (optionText?.includes(valueText) || valueText.includes(optionText || '')) {
                console.log('[OA] ✓ Clicking autocomplete option:', optionText);
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
        console.log('[OA] Handling autocomplete/dropdown field:', mapping.selector);
        console.log('[OA] Field label:', fieldSchema?.label);
        console.log('[OA] Field type:', fieldType, '| Has options:', hasOptionsArray);
        console.log('[OA] Setting value:', finalValue);
        
        // Skip the intl-tel-input country code search box — it is an internal widget
        // element, not a real form field, and filling it corrupts the phone country code
        const elId = element.id || '';
        if (elId.startsWith('iti-') || elId.includes('__search') || element.closest('.iti')) {
          console.log('[OA] Skipping ITI phone country widget:', mapping.selector);
          result.filledSelectors.push(mapping.selector); // treat as done so it doesn't count as a failure
          continue;
        }

        // Skip fields with empty values
        if (!finalValue || String(finalValue).trim() === '') {
          console.log('[OA] Skipping field with empty value');
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
            console.warn(`[OA] Value "${finalValue}" not in known options for ${fieldSchema.label}`);
            console.warn('[OA] Known options:', knownOptions.slice(0, 5).join(', '));
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
        console.log('[OA] Step 1: Opening combobox and waiting for listbox...');
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
            console.log('[OA] ✓ Best match:', bestMatch.text, `(score: ${bestMatch.score})`);
            console.log('[OA] Option element:', bestMatch.option.tagName, 'role:', bestMatch.option.getAttribute('role'), 'class:', bestMatch.option.className);
            
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
              console.log('[OA] Found clickable child:', clickableChild.tagName, clickableChild.className);
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
            console.log('[OA] Input value before click:', valueBefore || '<empty string>', '| after click:', valueAfter || '<empty string>');
            
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
                console.log('[OA] React-Select: option click accepted (input cleared = selection made)');
                // Don't force value - React-Select manages it internally
              } else if (valueAfter === valueBefore || !valueAfter) {
                console.log('[OA] React-Select: click may not have worked, forcing value...');
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
              console.log('[OA] Click did not update input, forcing value via React...');
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
        
        console.log('[OA] Found', realOptions.length, 'options after initial open');
        
        if (realOptions.length > 0) {
          optionClicked = await tryMatchOption(realOptions, valueToMatch);
        }
        
        // STEP 2: Type-to-search — for dropdowns that only show options after typing (Greenhouse/React-Select)
        if (!optionClicked && realOptions.length === 0) {
          console.log('[OA] Step 2: No options after initial open, typing prefix to trigger search...');
          
          // Type the first few characters to trigger the dropdown's search/filter
          const prefix = valueStr.substring(0, Math.min(4, valueStr.length));
          console.log('[OA] Step 2: Typing prefix:', JSON.stringify(prefix));
          
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
              console.log('[OA] Step 2: Found', realOptions.length, 'options after', pollAttempts * 300, 'ms');
              optionClicked = await tryMatchOption(realOptions, valueToMatch);
              if (optionClicked) {
                console.log('[OA] Step 2: Successfully selected from dropdown');
              }
              break;
            }
          }
          
          if (!optionClicked && realOptions.length === 0) {
            console.log('[OA] Step 2: No options appeared after', maxPolls * 300, 'ms of polling');
          }
        }
        
        // STEP 2b: Retry with gender synonyms if Step 2 didn't find a match
        // e.g., if we typed "Male" but dropdown has "Man", clear and try "Man" instead
        if (!optionClicked && getGenderSynonyms(valueToMatch).length > 0) {
          const synonyms = getGenderSynonyms(valueToMatch).filter(s => s !== valueToMatch);
          for (const synonym of synonyms) {
            if (optionClicked) break;
            console.log('[OA] Step 2b: Retrying with gender synonym:', JSON.stringify(synonym));
            
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
                console.log('[OA] Step 2b: Found', realOptions.length, 'options for synonym', JSON.stringify(synonym));
                // Match against the synonym value, not the original
                optionClicked = await tryMatchOption(realOptions, synonym);
                if (optionClicked) {
                  console.log('[OA] Step 2b: Successfully selected synonym option');
                }
                break;
              }
            }
          }
        }
        
        // STEP 3: If still no match, try scrolling listbox to load virtualized options
        if (!optionClicked && listbox) {
          console.log('[OA] Step 3: Scrolling listbox to load virtualized options...');
          
          for (let scrollAttempt = 0; scrollAttempt < 3; scrollAttempt++) {
            listbox.scrollTop = listbox.scrollTop + 200; // Scroll down
            await new Promise(resolve => setTimeout(resolve, 200));
            
            realOptions = getRealOptions(listbox);
            if (realOptions.length > 0) {
              optionClicked = await tryMatchOption(realOptions, valueToMatch);
              if (optionClicked) break;
            }
          }
          
          console.log('[OA] After scrolling:', realOptions.length, 'options');
        }
        
        // STEP 4: Fallback to tokenized partial matching
        // When multiple options contain all target tokens, prefer the option with the
        // FEWEST extra words (i.e. closest length to target) to avoid selecting a longer
        // but semantically opposite option (e.g. "I am a veteran..." vs "I am not a veteran").
        if (!optionClicked && realOptions.length > 0) {
          console.log('[OA] Step 4: Trying tokenized partial matching...');
          
          let tokens: string[];
          if (valueToMatch.length <= 3) {
            tokens = [valueToMatch];
          } else {
            tokens = valueToMatch.split(/\s+/).filter(t => t.length > 2);
          }
          
          if (tokens.length === 0) {
            console.log('[OA] No valid tokens for matching, skipping tokenized step');
          } else {
            const targetWordCount = valueToMatch.split(/\s+/).length;
            let bestTokenMatch: { option: Element; extraWords: number; text: string } | null = null;

            for (const option of realOptions) {
              const optionText = (option.textContent || '').toLowerCase().trim();
              const matchesAllTokens = tokens.every(token => optionText.includes(token));
              if (matchesAllTokens) {
                const optionWordCount = optionText.split(/\s+/).length;
                const extraWords = Math.max(0, optionWordCount - targetWordCount);
                if (bestTokenMatch === null || extraWords < bestTokenMatch.extraWords) {
                  bestTokenMatch = { option, extraWords, text: optionText };
                }
              }
            }

            if (bestTokenMatch) {
              console.log('[OA] ✓ Tokenized match:', bestTokenMatch.text, '(extra words:', bestTokenMatch.extraWords, ')');
              (bestTokenMatch.option as HTMLElement).click();
              optionClicked = true;
            }
          }
        }
        
        // STEP 5: Keyboard fallback (last resort) — type full value char-by-char, then ArrowDown+Enter
        if (!optionClicked) {
          console.log('[OA] Step 5: Keyboard fallback (type full value + ArrowDown + Enter)...');
          
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
            console.log('[OA] Step 5: Found', realOptions.length, 'options after full value, trying to select...');
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
          
          console.log('[OA] Keyboard fallback completed, current value:', element.value || '<empty>');
        }
        
        element.blur();
        console.log('[OA] ✓ Autocomplete field done:', fieldSchema?.label);
        
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
          // Pass selector so retries can re-query the element if React re-renders it
          const success = await smartFillField(element, String(finalValue), mapping.selector);
          if (!success) {
            warn(`Smart fill failed for ${mapping.selector}, value may not have stuck`);
          }
          
          // Check for validation errors
          await checkForValidationError(mapping.selector, fieldSchema?.label || '');
        }
      } else if (element instanceof HTMLTextAreaElement) {
        // Textarea - use smart fill (human typing for short, native setter for long)
        const success = await smartFillField(element, String(finalValue), mapping.selector);
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

  // Teach the graph — record every successfully filled answer into background's graphMemory.
  // Skip untrusted fields (Tier 3: cookie banners, chat widgets, marketing embeds).
  for (const [selector, { field, value }] of autoFilledValues) {
    const fieldLabel = field.label ?? field.name ?? '';
    if (!fieldLabel || !value || typeof value === 'boolean') continue;
    if (field.learnEligible === false || field.trustTier === 3) continue;
    browser.runtime.sendMessage({
      kind: 'GRAPH_RECORD_ANSWER',
      questionText: fieldLabel,
      value: String(value),
      source: 'profile',
      canonicalField: detectFieldType(fieldLabel, field.type ?? '', field.name ?? '') || 'unknown',
      context: {
        company: lastJobMeta?.company ?? undefined,
        jobTitle: lastJobMeta?.jobTitle ?? undefined,
        url: window.location.href,
        platform: lastJobMeta?.atsHint ?? undefined,
      },
    }).catch(() => {});
  }
  
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
      console.log('[OA Smart] Filling Shadow DOM autocomplete/dropdown:', fieldLabel, 'with:', value);
      
      if (element instanceof HTMLInputElement && host) {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        
        // Wait for options to appear
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Try to click matching option
        if (host.shadowRoot) {
          const options = host.shadowRoot.querySelectorAll('[role="option"], li[data-value], .option, [class*="option"]');
          console.log('[OA Smart] Found', options.length, 'options');
          
          for (const option of options) {
            const optionText = option.textContent?.trim().toLowerCase();
            const valueText = value.toLowerCase();
            
            if (optionText?.includes(valueText) || valueText.includes(optionText || '')) {
              console.log('[OA Smart] ✓ Clicking option:', optionText);
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
      console.log('[OA Smart] Setting dropdown value (React-compat):', fieldLabel, 'with:', value);
      
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
            console.log('[OA Smart] ✓ Clicking option:', optText);
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
  inputEl.style.boxShadow = '0 0 0 2px rgba(30, 42, 58, 0.3)';

  // Show a small toast
  showNotification('Offlyn Apply', `Applying "${action}"...`, 'info', 3000);

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

      // Handle "Why was this filled?" debug panel trigger
      if ((message as any).kind === 'GRAPH_DEBUG_FIELD') {
        return (async () => {
          if (!lastRightClickedField) return;
          try {
            const response = await browser.runtime.sendMessage({
              kind: 'GRAPH_DEBUG_REQUEST',
              label: lastRightClickedField.label,
              currentValue: lastRightClickedField.value,
            });
            const provenance = (response as any)?.provenance ?? null;
            const el = document.querySelector(lastRightClickedField.selector) as HTMLElement | null;
            showFillDebugPanel(el ?? document.body, lastRightClickedField.label, provenance);
          } catch (err) {
            warn('[Graph] Debug panel error:', err);
          }
        })();
      }

      // Handle "Smart Fill this field" — generates an appropriately-sized answer via LLM
      if ((message as any).kind === 'SMART_FILL_FIELD') {
        return (async () => {
          if (!lastRightClickedField) {
            showWarning('Smart Fill', 'Could not identify the field. Try right-clicking directly on the input.');
            return;
          }

          const { selector, label, value: currentValue } = lastRightClickedField;

          // Find matching schema for richer field info (type, options)
          const schema = allDetectedFields.find(f => f.selector === selector);
          const fieldType = schema?.type ?? 'text';
          const options: string[] = (schema as any)?.options ?? [];

          // Find the DOM element
          const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
          if (!el) {
            showWarning('Smart Fill', 'Field not found. The page may have changed.');
            return;
          }

          // Loading state — purple ring to distinguish from profile autofill
          const originalBoxShadow = el.style.boxShadow;
          el.style.transition = 'box-shadow 0.2s ease';
          el.style.boxShadow = '0 0 0 3px rgba(124, 58, 237, 0.35)';
          el.setAttribute('data-offlyn-loading', 'true');

          showInfo('Smart Fill', `Generating answer for "${label || 'this field'}"…`);

          try {
            const response = await browser.runtime.sendMessage({
              kind: 'SMART_FILL_QUERY',
              label,
              fieldType,
              options,
              currentValue,
            }) as { value?: string; responseType?: string; error?: string } | undefined;

            if (!response || response.error) {
              showError('Smart Fill Failed', response?.error ?? 'No response from background.');
              return;
            }

            const { value: answer, responseType } = response;
            if (!answer?.trim()) {
              showWarning('Smart Fill', 'The AI returned an empty answer. Try rephrasing the field label.');
              return;
            }

            // Fill the field using the existing smart fill infrastructure
            autofillInProgress = true;
            const success = await smartFillField(el, answer, selector);
            autofillInProgress = false;

            if (success) {
              const typeLabel =
                responseType === 'yesno'  ? 'Yes/No answer' :
                responseType === 'long'   ? 'detailed response' :
                responseType === 'medium' ? 'short response' : 'value';
              showSuccess('Smart Fill', `Filled with ${typeLabel}. Right-click → "Professional Fix" to refine.`);
              // Teach the graph about this answer
              browser.runtime.sendMessage({
                kind: 'GRAPH_RECORD_ANSWER',
                questionText: label,
                value: answer,
                source: 'llm',
                canonicalField: null,
              }).catch(() => {});
            } else {
              showWarning('Smart Fill', 'Could not fill the field — the page may be using a custom input widget.');
            }
          } catch (err) {
            warn('[SmartFill] Error:', err);
            showError('Smart Fill Error', 'An error occurred. Make sure Ollama is running.');
          } finally {
            autofillInProgress = false;
            el.style.boxShadow = originalBoxShadow;
            el.removeAttribute('data-offlyn-loading');
          }
        })();
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
  // Initialize RL learning system
  try {
    await rlSystem.initialize();
    const stats = rlSystem.getStats();
    info(`[RL] System initialized: ${stats.totalCorrections} corrections, ${stats.totalPatterns} patterns (${stats.highConfidence} high-confidence)`);
  } catch (err) {
    warn('[RL] Failed to initialize:', err);
  }
  
  // Setup user edit tracking first
  setupUserEditTracking();
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[OA] DOM loaded, starting detection...');
      // Initial detection
      setTimeout(detectPage, 100);
      
      // Retry detection for slow-loading SPAs (like SmartRecruiters)
      setTimeout(detectPage, 1000);
      setTimeout(detectPage, 2000);
      setTimeout(detectPage, 3000);
      setTimeout(detectPage, 5000);  // Extra retry for very slow sites
    });
  } else {
    console.log('[OA] DOM already ready, starting detection...');
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
  console.log('[OA] Manual trigger available: window.offlyn_detectPage()');
  
  // Listen for form submissions
  document.addEventListener('submit', (e) => {
    handleSubmitAttempt(e);
  }, true); // Use capture phase
  
  // Listen for button/link clicks (for multi-page forms and Apply buttons).
  // Use closest() so clicks on icon/span children of buttons are still caught.
  document.addEventListener('click', (e) => {
    const clicked = e.target as HTMLElement;

    // Skip clicks inside our own UI panels
    if (clicked.closest('#offlyn-suggestion-panel')) return;

    // Walk up to the nearest interactive element
    const target = clicked.closest('button, a, [role="button"], input[type="submit"], input[type="button"]') as HTMLElement | null;
    if (!target) return;

    handleSubmitAttempt(e, target);

    // Check if this might navigate to next page or load form
    const text = (target.textContent || target.getAttribute('value') || '').toLowerCase();

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
      lastCoverLetterResult = null;
      lastCoverLetterAutoApplySelector = null;

      // Hide badge until new page is confirmed as a job page
      hideTrackingBadge();
      
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
    lastCoverLetterResult = null;
    lastCoverLetterAutoApplySelector = null;
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
