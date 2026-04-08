/**
 * Typed wrappers around browser.storage.local
 */

import browser from './browser-compat';
import type { ExtensionSettings, TabJobInfo, JobApplication, DailySummary } from './types';

const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  dryRun: false,
  whatsappTarget: undefined,
  scheduledSearchEnabled: true,
  scheduledSearchIntervalHours: 8,
  notificationsEnabled: true,
  preferenceLearnEnabled: true,
};

export async function getSettings(): Promise<ExtensionSettings> {
  try {
    const result = await browser.storage.local.get('settings') as Record<string, any>;
    return result.settings || DEFAULT_SETTINGS;
  } catch (err) {
    console.error('Failed to get settings:', err);
    return DEFAULT_SETTINGS;
  }
}

export async function setSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  try {
    const current = await getSettings();
    const updated = { ...current, ...settings };
    await browser.storage.local.set({ settings: updated });
  } catch (err) {
    console.error('Failed to set settings:', err);
    throw err;
  }
}

export async function getTabJobInfo(tabId: number): Promise<TabJobInfo | null> {
  try {
    const key = `tabJobInfo_${tabId}`;
    const result = await browser.storage.local.get(key);
    return (result[key] as TabJobInfo) || null;
  } catch (err) {
    console.error('Failed to get tab job info:', err);
    return null;
  }
}

export async function setTabJobInfo(tabId: number, info: TabJobInfo): Promise<void> {
  try {
    const key = `tabJobInfo_${tabId}`;
    await browser.storage.local.set({ [key]: info });
  } catch (err) {
    console.error('Failed to set tab job info:', err);
  }
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Build a list of dailySummary_* storage keys for the past N days.
 * Used instead of browser.storage.local.get(null) which is unreliable in Firefox.
 */
function getDailySummaryKeys(daysBack = 365): string[] {
  const keys: string[] = [];
  const today = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(`dailySummary_${d.toISOString().split('T')[0]}`);
  }
  return keys;
}

/**
 * Get today's job applications
 */
export async function getTodayApplications(): Promise<DailySummary> {
  try {
    const today = getTodayDate();
    const key = `dailySummary_${today}`;
    const result = await browser.storage.local.get(key);
    
    if (result[key]) {
      return result[key] as DailySummary;
    }
    
    return {
      date: today,
      applications: [],
      lastSentAt: null,
    };
  } catch (err) {
    console.error('Failed to get today applications:', err);
    return {
      date: getTodayDate(),
      applications: [],
      lastSentAt: null,
    };
  }
}

/**
 * Normalize a job URL for deduplication: strip tracking query params
 * (gh_src, lever-source, utm_*, ref, etc.) so the same job doesn't get
 * recorded twice because the tracking token changed between sessions.
 */
function normalizeJobUrl(url: string): string {
  try {
    const u = new URL(url);
    const TRACKING_PARAMS = ['gh_src', 'lever-source', 'lever-origin', 'ref', 'source',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    TRACKING_PARAMS.forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Add a job application to today's summary
 */
export async function addJobApplication(app: JobApplication): Promise<void> {
  try {
    console.log('[Storage] Adding application:', app.jobTitle, 'at', app.company);
    const summary = await getTodayApplications();

    const normalizedNew = normalizeJobUrl(app.url);
    
    // Check if this job already exists today (normalize URLs to strip tracking params)
    const existing = summary.applications.find(a => normalizeJobUrl(a.url) === normalizedNew);
    if (existing) {
      console.log('[Storage] Application already exists today, updating status/title');
      summary.applications = summary.applications.map(a =>
        normalizeJobUrl(a.url) === normalizedNew
          ? { ...a, status: app.status, timestamp: app.timestamp,
              jobTitle: app.jobTitle || a.jobTitle,
              company: app.company || a.company }
          : a
      );
    } else {
      summary.applications.push(app);
      console.log('[Storage] New application added. Total today:', summary.applications.length);
    }
    
    const key = `dailySummary_${summary.date}`;
    await browser.storage.local.set({ [key]: summary });
    console.log('[Storage] Saved to storage key:', key);
  } catch (err) {
    console.error('[Storage] Failed to add job application:', err);
  }
}

/**
 * Mark today's summary as sent
 */
export async function markSummaryAsSent(): Promise<void> {
  try {
    const summary = await getTodayApplications();
    summary.lastSentAt = Date.now();
    const key = `dailySummary_${summary.date}`;
    await browser.storage.local.set({ [key]: summary });
  } catch (err) {
    console.error('Failed to mark summary as sent:', err);
  }
}

/**
 * Generate WhatsApp message from today's applications
 */
export function generateSummaryMessage(summary: DailySummary): string {
  const count = summary.applications.length;
  
  if (count === 0) {
    return `Daily Job Application Summary (${summary.date})\n\nNo applications today.`;
  }
  
  const submittedCount = summary.applications.filter(a => a.status === 'submitted').length;
  const detectedCount = count - submittedCount;
  
  let message = `Daily Job Application Summary (${summary.date})\n\n`;
  message += `Total: ${count} positions\n`;
  message += `Submitted: ${submittedCount}\n`;
  message += `Detected: ${detectedCount}\n\n`;
  
  message += `Details:\n`;
  summary.applications.forEach((app, i) => {
    const status = app.status === 'submitted' ? '[Submitted]' : '[Detected]';
    message += `\n${i + 1}. ${status} ${app.jobTitle}\n`;
    message += `   Company: ${app.company}\n`;
    if (app.atsHint) {
      message += `   ATS: ${app.atsHint}\n`;
    }
  });
  
  return message;
}

/**
 * Get all job applications from all historical daily summaries
 * Aggregates all dailySummary_* keys into a single array
 * Filters OUT 'detected' status applications (only submitted and tracked applications)
 */
export async function getAllApplications(): Promise<JobApplication[]> {
  try {
    // Use targeted key lookup instead of get(null) — get(null) is unreliable in Firefox
    const keys = getDailySummaryKeys(365);
    const allData = await browser.storage.local.get(keys);
    console.log('[Storage] Scanned', keys.length, 'possible daily summary keys');

    const applications: JobApplication[] = [];
    let dailySummaryCount = 0;
    
    for (const key of keys) {
      if (allData[key]) {
        dailySummaryCount++;
        const summary = allData[key] as DailySummary;
        console.log('[Storage] Found daily summary:', key, 'with', summary.applications?.length || 0, 'applications');

        if (summary.applications && Array.isArray(summary.applications)) {
          // Add unique ID if missing
          const appsWithIds = summary.applications.map(app => ({
            ...app,
            id: app.id || `${app.url}_${app.timestamp}`,
          }));
          applications.push(...appsWithIds);
        }
      }
    }
    
    console.log('[Storage] Found', dailySummaryCount, 'daily summaries with', applications.length, 'total applications');

    // Filter out 'detected' status (only show submitted and tracked applications)
    const filteredApps = applications.filter(a => a.status !== 'detected');
    console.log('[Storage] After filtering detected:', filteredApps.length, 'applications');
    
    // Sort by timestamp (newest first)
    return filteredApps.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    console.error('[Storage] Failed to get all applications:', err);
    return [];
  }
}

/**
 * Update an application's status and notes
 * Searches through all daily summaries to find and update the application
 */
export async function updateApplicationStatus(
  appId: string,
  newStatus: JobApplication['status'],
  notes?: string
): Promise<boolean> {
  try {
    const keys = getDailySummaryKeys(365);
    const allData = await browser.storage.local.get(keys);
    
    // Find the application across all daily summaries
    for (const key of keys) {
      if (allData[key]) {
        const summary = allData[key] as DailySummary;
        const appIndex = summary.applications.findIndex(
          a => (a.id || `${a.url}_${a.timestamp}`) === appId
        );
        
        if (appIndex !== -1) {
          // Update the application
          summary.applications[appIndex] = {
            ...summary.applications[appIndex],
            status: newStatus,
            notes: notes !== undefined ? notes : summary.applications[appIndex].notes,
            id: appId,
          };
          
          // Save back to storage
          await browser.storage.local.set({ [key]: summary });
          return true;
        }
      }
    }
    
    console.warn('Application not found for update:', appId);
    return false;
  } catch (err) {
    console.error('Failed to update application status:', err);
    return false;
  }
}

/**
 * Delete an application from storage
 * Searches through all daily summaries to find and remove the application
 */
export async function deleteApplication(appId: string): Promise<boolean> {
  try {
    const keys = getDailySummaryKeys(365);
    const allData = await browser.storage.local.get(keys);
    
    // Find and delete the application from all daily summaries
    for (const key of keys) {
      if (allData[key]) {
        const summary = allData[key] as DailySummary;
        const originalLength = summary.applications.length;
        
        // Filter out the application
        summary.applications = summary.applications.filter(
          a => (a.id || `${a.url}_${a.timestamp}`) !== appId
        );
        
        if (summary.applications.length < originalLength) {
          // Application was found and removed
          await browser.storage.local.set({ [key]: summary });
          return true;
        }
      }
    }
    
    console.warn('Application not found for deletion:', appId);
    return false;
  } catch (err) {
    console.error('Failed to delete application:', err);
    return false;
  }
}

/**
 * Get summary statistics for all applications
 */
export interface ApplicationStats {
  total: number;
  submitted: number;
  interviewing: number;
  rejected: number;
  accepted: number;
  withdrawn: number;
  responseRate: number; // Percentage of applications that got interview/accept/reject (0-100)
  uniqueCompanies: number;
  dateRange: {
    earliest: string | null;
    latest: string | null;
  };
}

export async function getApplicationStats(): Promise<ApplicationStats> {
  try {
    const applications = await getAllApplications(); // Already filters out 'detected'
    
    if (applications.length === 0) {
      return {
        total: 0,
        submitted: 0,
        interviewing: 0,
        rejected: 0,
        accepted: 0,
        withdrawn: 0,
        responseRate: 0,
        uniqueCompanies: 0,
        dateRange: { earliest: null, latest: null },
      };
    }
    
    const submitted = applications.filter(a => a.status === 'submitted').length;
    const interviewing = applications.filter(a => a.status === 'interviewing').length;
    const rejected = applications.filter(a => a.status === 'rejected').length;
    const accepted = applications.filter(a => a.status === 'accepted').length;
    const withdrawn = applications.filter(a => a.status === 'withdrawn').length;
    
    // Response rate = applications that got a response (interviewing, rejected, accepted)
    const responded = interviewing + rejected + accepted;
    const responseRate = applications.length > 0 ? (responded / applications.length) * 100 : 0;
    
    // Get unique companies
    const companies = new Set(applications.map(a => a.company));
    
    // Get date range (applications are sorted by timestamp)
    const timestamps = applications.map(a => a.timestamp).sort((a, b) => a - b);
    const earliest = timestamps.length > 0 ? new Date(timestamps[0]).toISOString().split('T')[0] : null;
    const latest = timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString().split('T')[0] : null;
    
    return {
      total: applications.length,
      submitted,
      interviewing,
      rejected,
      accepted,
      withdrawn,
      responseRate: Math.round(responseRate * 10) / 10, // Round to 1 decimal
      uniqueCompanies: companies.size,
      dateRange: { earliest, latest },
    };
  } catch (err) {
    console.error('Failed to get application stats:', err);
    return {
      total: 0,
      submitted: 0,
      interviewing: 0,
      rejected: 0,
      accepted: 0,
      withdrawn: 0,
      responseRate: 0,
      uniqueCompanies: 0,
      dateRange: { earliest: null, latest: null },
    };
  }
}

/**
 * Get application trends for time-series charts
 * Returns data grouped by date (excludes 'detected' applications)
 */
export interface DailyTrend {
  date: string; // YYYY-MM-DD
  total: number;
  submitted: number;
  interviewing: number;
  rejected: number;
  accepted: number;
  withdrawn: number;
}

export async function getApplicationTrends(): Promise<DailyTrend[]> {
  try {
    // Use targeted key lookup — sorted oldest-first for trend charts
    const keys = getDailySummaryKeys(365).reverse();
    const allData = await browser.storage.local.get(keys);
    const trends: DailyTrend[] = [];
    
    for (const key of keys) {
      if (!allData[key]) continue;
      const summary = allData[key] as DailySummary;
      
      // Filter out 'detected' applications
      const trackedApps = summary.applications.filter(a => a.status !== 'detected');
      
      if (trackedApps.length > 0) {
        const submitted = trackedApps.filter(a => a.status === 'submitted').length;
        const interviewing = trackedApps.filter(a => a.status === 'interviewing').length;
        const rejected = trackedApps.filter(a => a.status === 'rejected').length;
        const accepted = trackedApps.filter(a => a.status === 'accepted').length;
        const withdrawn = trackedApps.filter(a => a.status === 'withdrawn').length;
        
        trends.push({
          date: summary.date,
          total: trackedApps.length,
          submitted,
          interviewing,
          rejected,
          accepted,
          withdrawn,
        });
      }
    }
    
    return trends;
  } catch (err) {
    console.error('Failed to get application trends:', err);
    return [];
  }
}

