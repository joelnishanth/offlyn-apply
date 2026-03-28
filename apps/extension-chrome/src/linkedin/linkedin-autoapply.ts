/**
 * LinkedIn Easy Apply automation engine.
 * Iterates through job cards on search results, clicks Easy Apply,
 * fills each modal step using the existing autofill pipeline, and submits.
 */

import browser from '../shared/browser-compat';
import {
  getJobCards,
  extractJobMetaFromCard,
  extractJobMetaFromDetailPane,
  findEasyApplyButton,
  findModalNextButton,
  findModalSubmitButton,
  findModalDismissButton,
  isModalOpen,
  getModalFormFields,
  type LinkedInJobMeta,
} from './linkedin-detector';
import { getUserProfile } from '../shared/profile';
import { generateFillMappings } from '../shared/autofill';
import { extractFormSchema } from '../shared/dom';

export interface AutoApplyOptions {
  maxApply: number;
  skipApplied: boolean;
  delayMinMs: number;
  delayMaxMs: number;
}

export interface AutoApplyResult {
  applied: number;
  skipped: number;
  failed: number;
  errors: string[];
  appliedJobs: LinkedInJobMeta[];
}

export type AutoApplyStatus = 'idle' | 'running' | 'paused' | 'done';

type ProgressCallback = (status: AutoApplyStatus, result: Partial<AutoApplyResult>) => void;

const DEFAULT_OPTIONS: AutoApplyOptions = {
  maxApply: 25,
  skipApplied: true,
  delayMinMs: 5000,
  delayMaxMs: 15000,
};

let _status: AutoApplyStatus = 'idle';
let _shouldStop = false;

export function getAutoApplyStatus(): AutoApplyStatus {
  return _status;
}

export function stopAutoApply(): void {
  _shouldStop = true;
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min)) + min;
  return new Promise(r => setTimeout(r, ms));
}

function waitFor(conditionFn: () => boolean, timeoutMs = 10000, pollMs = 300): Promise<boolean> {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (conditionFn()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(check, pollMs);
    };
    check();
  });
}

function simulateClick(el: HTMLElement): void {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function fillModalStep(): Promise<number> {
  const profile = await getUserProfile();
  if (!profile) return 0;

  const fields = getModalFormFields();
  if (fields.length === 0) return 0;

  const modal = document.querySelector('.jobs-easy-apply-modal, [data-test-modal]');
  if (!modal) return 0;

  const schema = extractFormSchema(Array.from(
    modal.querySelectorAll('input:not([type="hidden"]):not([type="file"]), select, textarea')
  ) as HTMLElement[]);

  const mappings = generateFillMappings(schema, profile);

  let filled = 0;
  for (const m of mappings) {
    try {
      const el = modal.querySelector(m.selector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (!el || !m.value) continue;

      if (el instanceof HTMLSelectElement) {
        const opts = Array.from(el.options);
        const match = opts.find(o =>
          o.text.toLowerCase().includes(String(m.value).toLowerCase()) ||
          o.value.toLowerCase() === String(m.value).toLowerCase()
        );
        if (match) {
          el.value = match.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
        }
      } else {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'value'
        )?.set ?? Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype, 'value'
        )?.set;

        if (nativeSetter) {
          nativeSetter.call(el, String(m.value));
        } else {
          el.value = String(m.value);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      }
    } catch {
      // Skip problematic fields
    }
  }
  return filled;
}

async function processEasyApplyModal(): Promise<boolean> {
  const maxSteps = 8;

  for (let step = 0; step < maxSteps; step++) {
    if (_shouldStop) return false;

    await new Promise(r => setTimeout(r, 800));

    await fillModalStep();

    const submitBtn = findModalSubmitButton();
    if (submitBtn) {
      simulateClick(submitBtn);
      await new Promise(r => setTimeout(r, 1500));

      const successEl = document.querySelector(
        '.artdeco-inline-feedback--success, [data-test-modal-close-btn]'
      );
      if (successEl || !isModalOpen()) {
        const dismiss = findModalDismissButton();
        if (dismiss) simulateClick(dismiss);
        return true;
      }
    }

    const nextBtn = findModalNextButton();
    if (nextBtn) {
      simulateClick(nextBtn);
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    // Neither submit nor next found — possibly stuck
    break;
  }

  // Close modal on failure
  const dismiss = findModalDismissButton();
  if (dismiss) {
    simulateClick(dismiss);
    await new Promise(r => setTimeout(r, 500));
    // Handle "discard" confirmation dialog
    const discardBtn = document.querySelector<HTMLButtonElement>(
      'button[data-test-dialog-primary-btn], button[data-control-name="discard_application_confirm_btn"]'
    );
    if (discardBtn) simulateClick(discardBtn);
  }
  return false;
}

export async function startAutoApply(
  options: Partial<AutoApplyOptions> = {},
  onProgress?: ProgressCallback,
): Promise<AutoApplyResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  _status = 'running';
  _shouldStop = false;

  const result: AutoApplyResult = {
    applied: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    appliedJobs: [],
  };

  onProgress?.('running', result);

  const cards = getJobCards();
  console.log(`[LinkedIn AutoApply] Found ${cards.length} job cards`);

  for (const card of cards) {
    if (_shouldStop || result.applied >= opts.maxApply) break;

    const meta = extractJobMetaFromCard(card);
    if (!meta) {
      result.skipped++;
      continue;
    }

    if (opts.skipApplied && meta.isAlreadyApplied) {
      console.log(`[LinkedIn AutoApply] Skipping already applied: ${meta.title}`);
      result.skipped++;
      continue;
    }

    if (!meta.isEasyApply) {
      console.log(`[LinkedIn AutoApply] Skipping non-Easy Apply: ${meta.title}`);
      result.skipped++;
      continue;
    }

    // Click the card to load job details
    simulateClick(card);
    await new Promise(r => setTimeout(r, 2000));

    // Find and click Easy Apply button
    const easyApplyBtn = findEasyApplyButton();
    if (!easyApplyBtn) {
      console.log(`[LinkedIn AutoApply] Easy Apply button not found for: ${meta.title}`);
      result.skipped++;
      continue;
    }

    simulateClick(easyApplyBtn);

    const modalOpened = await waitFor(() => isModalOpen(), 5000);
    if (!modalOpened) {
      console.log(`[LinkedIn AutoApply] Modal did not open for: ${meta.title}`);
      result.failed++;
      result.errors.push(`Modal failed to open: ${meta.title}`);
      continue;
    }

    console.log(`[LinkedIn AutoApply] Processing: ${meta.title} at ${meta.company}`);
    const success = await processEasyApplyModal();

    if (success) {
      result.applied++;
      result.appliedJobs.push(meta);
      console.log(`[LinkedIn AutoApply] Applied: ${meta.title} at ${meta.company}`);

      try {
        await browser.runtime.sendMessage({
          kind: 'JOB_APPLY_EVENT',
          eventType: 'SUBMIT_ATTEMPT',
          jobMeta: {
            jobTitle: meta.title,
            company: meta.company,
            url: window.location.href,
            atsHint: 'linkedin',
          },
          schema: [],
          timestamp: Date.now(),
        });
      } catch { /* non-critical */ }
    } else {
      result.failed++;
      result.errors.push(`Failed to complete: ${meta.title}`);
      console.log(`[LinkedIn AutoApply] Failed: ${meta.title}`);
    }

    onProgress?.('running', result);
    await randomDelay(opts.delayMinMs, opts.delayMaxMs);
  }

  _status = 'done';
  onProgress?.('done', result);
  console.log(`[LinkedIn AutoApply] Done: ${result.applied} applied, ${result.skipped} skipped, ${result.failed} failed`);
  return result;
}
