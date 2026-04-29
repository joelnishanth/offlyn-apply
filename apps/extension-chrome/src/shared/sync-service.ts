/**
 * Sync service for backend integration
 * Allows syncing profile and contextual data to a backend API
 * Similar to superfill.ai's data syncing mechanism
 */

import browser from './browser-compat';
import type { UserProfile } from './profile';
import type { ContextualStorage } from './context-aware-storage';

export interface SyncConfig {
  enabled: boolean;
  apiEndpoint?: string;
  apiKey?: string;
  autoSync: boolean;
  syncInterval: number; // in milliseconds
}

export interface SyncStatus {
  lastSyncTime: number;
  lastSyncSuccess: boolean;
  lastSyncError?: string;
  pendingChanges: number;
}

const SYNC_CONFIG_KEY = 'syncConfig';
const SYNC_STATUS_KEY = 'syncStatus';

let syncInterval: number | null = null;

/**
 * Get sync configuration
 */
export async function getSyncConfig(): Promise<SyncConfig> {
  try {
    const result = await browser.storage.local.get(SYNC_CONFIG_KEY);
    return result[SYNC_CONFIG_KEY] || {
      enabled: false,
      autoSync: false,
      syncInterval: 5 * 60 * 1000 // 5 minutes default
    };
  } catch (err) {
    console.error('Failed to get sync config:', err);
    return {
      enabled: false,
      autoSync: false,
      syncInterval: 5 * 60 * 1000
    };
  }
}

/**
 * Save sync configuration
 */
export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  try {
    await browser.storage.local.set({ [SYNC_CONFIG_KEY]: config });
    
    // Restart sync if auto-sync is enabled
    if (config.enabled && config.autoSync) {
      startAutoSync();
    } else {
      stopAutoSync();
    }
  } catch (err) {
    console.error('Failed to save sync config:', err);
    throw err;
  }
}

/**
 * Get sync status
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    const result = await browser.storage.local.get(SYNC_STATUS_KEY);
    return result[SYNC_STATUS_KEY] || {
      lastSyncTime: 0,
      lastSyncSuccess: false,
      pendingChanges: 0
    };
  } catch (err) {
    console.error('Failed to get sync status:', err);
    return {
      lastSyncTime: 0,
      lastSyncSuccess: false,
      pendingChanges: 0
    };
  }
}

/**
 * Update sync status
 */
async function updateSyncStatus(status: Partial<SyncStatus>): Promise<void> {
  try {
    const current = await getSyncStatus();
    const updated = { ...current, ...status };
    await browser.storage.local.set({ [SYNC_STATUS_KEY]: updated });
  } catch (err) {
    console.error('Failed to update sync status:', err);
  }
}

/**
 * Sync profile to backend
 */
export async function syncProfileToBackend(profile: UserProfile): Promise<boolean> {
  const config = await getSyncConfig();
  
  if (!config.enabled || !config.apiEndpoint || !config.apiKey) {
    console.warn('[Sync] Sync not configured');
    return false;
  }
  
  try {
    const response = await fetch(`${config.apiEndpoint}/profile/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        profile,
        timestamp: Date.now()
      })
    });
    
    if (!response.ok) {
      throw new Error(`Sync failed: ${response.statusText}`);
    }
    
    await updateSyncStatus({
      lastSyncTime: Date.now(),
      lastSyncSuccess: true,
      lastSyncError: undefined,
      pendingChanges: 0
    });
    
    console.log('[Sync] Profile synced successfully');
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Sync] Failed to sync profile:', errorMsg);
    
    await updateSyncStatus({
      lastSyncSuccess: false,
      lastSyncError: errorMsg
    });
    
    return false;
  }
}

/**
 * Sync contextual data to backend
 */
export async function syncContextualDataToBackend(contextualData: ContextualStorage): Promise<boolean> {
  const config = await getSyncConfig();
  
  if (!config.enabled || !config.apiEndpoint || !config.apiKey) {
    console.warn('[Sync] Sync not configured');
    return false;
  }
  
  try {
    // Convert Map to object for JSON serialization
    const dataToSync = {
      answers: Object.fromEntries(contextualData.answers),
      lastUpdated: contextualData.lastUpdated
    };
    
    const response = await fetch(`${config.apiEndpoint}/contextual/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        contextualData: dataToSync,
        timestamp: Date.now()
      })
    });
    
    if (!response.ok) {
      throw new Error(`Sync failed: ${response.statusText}`);
    }
    
    await updateSyncStatus({
      lastSyncTime: Date.now(),
      lastSyncSuccess: true,
      lastSyncError: undefined,
      pendingChanges: 0
    });
    
    console.log('[Sync] Contextual data synced successfully');
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Sync] Failed to sync contextual data:', errorMsg);
    
    await updateSyncStatus({
      lastSyncSuccess: false,
      lastSyncError: errorMsg
    });
    
    return false;
  }
}

/**
 * Pull profile from backend
 */
export async function pullProfileFromBackend(): Promise<UserProfile | null> {
  const config = await getSyncConfig();
  
  if (!config.enabled || !config.apiEndpoint || !config.apiKey) {
    console.warn('[Sync] Sync not configured');
    return null;
  }
  
  try {
    const response = await fetch(`${config.apiEndpoint}/profile/pull`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Pull failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[Sync] Profile pulled successfully');
    
    return data.profile;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Sync] Failed to pull profile:', errorMsg);
    return null;
  }
}

/**
 * Pull contextual data from backend
 */
export async function pullContextualDataFromBackend(): Promise<ContextualStorage | null> {
  const config = await getSyncConfig();
  
  if (!config.enabled || !config.apiEndpoint || !config.apiKey) {
    console.warn('[Sync] Sync not configured');
    return null;
  }
  
  try {
    const response = await fetch(`${config.apiEndpoint}/contextual/pull`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Pull failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[Sync] Contextual data pulled successfully');
    
    // Convert object back to Map
    const answers = new Map(Object.entries(data.contextualData.answers || {}));
    
    return {
      answers,
      lastUpdated: data.contextualData.lastUpdated || Date.now()
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Sync] Failed to pull contextual data:', errorMsg);
    return null;
  }
}

/**
 * Start auto-sync
 */
export function startAutoSync(): void {
  stopAutoSync(); // Clear any existing interval
  
  getSyncConfig().then(config => {
    if (config.enabled && config.autoSync) {
      syncInterval = window.setInterval(() => {
        console.log('[Sync] Auto-sync triggered');
        performFullSync();
      }, config.syncInterval);
      
      console.log(`[Sync] Auto-sync started (interval: ${config.syncInterval}ms)`);
    }
  });
}

/**
 * Stop auto-sync
 */
export function stopAutoSync(): void {
  if (syncInterval !== null) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[Sync] Auto-sync stopped');
  }
}

/**
 * Perform full sync (both profile and contextual data)
 */
export async function performFullSync(): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Import dynamically to avoid circular dependencies
  const { getUserProfile } = await import('./profile');
  const { getContextualStorage } = await import('./context-aware-storage');
  
  // Sync profile
  const profile = await getUserProfile();
  if (profile) {
    const profileSuccess = await syncProfileToBackend(profile);
    if (!profileSuccess) {
      errors.push('Failed to sync profile');
    }
  } else {
    errors.push('No profile to sync');
  }
  
  // Sync contextual data
  const contextualData = await getContextualStorage();
  const contextualSuccess = await syncContextualDataToBackend(contextualData);
  if (!contextualSuccess) {
    errors.push('Failed to sync contextual data');
  }
  
  return {
    success: errors.length === 0,
    errors
  };
}

/**
 * Test backend connection
 */
export async function testBackendConnection(apiEndpoint: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiEndpoint}/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    return response.ok;
  } catch (err) {
    console.error('[Sync] Connection test failed:', err);
    return false;
  }
}
