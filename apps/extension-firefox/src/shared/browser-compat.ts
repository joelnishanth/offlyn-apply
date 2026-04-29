import browser from 'webextension-polyfill';

export default browser;
export { browser };
export type { Runtime, Tabs, Menus, Storage } from 'webextension-polyfill';

/**
 * In Firefox we always use the polyfill; the chromeCompat fallback is a
 * no-op shim so shared code that imports it compiles without changes.
 */
export const chromeCompat: typeof browser = browser;

// ── MV3 → MV2 global shims ─────────────────────────────────────────────────
// Chrome code uses `chrome.action` and `chrome.scripting` (MV3 APIs) directly.
// Firefox MV2 only has `browserAction` and `tabs.executeScript`. These shims
// patch the global `chrome` object so MV3-style calls work transparently.

(function installMV3Shims() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g.chrome) return;

  // chrome.action → chrome.browserAction (MV2)
  if (!g.chrome.action && g.chrome.browserAction) {
    g.chrome.action = g.chrome.browserAction;
  }

  // chrome.contextMenus → chrome.menus (Firefox MV2 uses "menus" namespace)
  if (!g.chrome.contextMenus && g.chrome.menus) {
    g.chrome.contextMenus = g.chrome.menus;
  }

  // Also patch the polyfill's browser object
  if (!g.browser?.contextMenus && g.browser?.menus) {
    g.browser.contextMenus = g.browser.menus;
  }

  // chrome.scripting.executeScript → browser.tabs.executeScript (MV2)
  if (!g.chrome.scripting) {
    g.chrome.scripting = {
      executeScript: async (details: {
        target: { tabId: number; allFrames?: boolean };
        files?: string[];
        func?: (...args: unknown[]) => unknown;
        args?: unknown[];
      }) => {
        const { target, files, func, args } = details;
        const opts: { allFrames?: boolean } = { allFrames: target.allFrames ?? false };

        if (func) {
          const argList = (args ?? []).map((a) => JSON.stringify(a)).join(',');
          const results = await browser.tabs.executeScript(target.tabId, {
            ...opts,
            code: `(${func.toString()})(${argList})`,
          });
          return (results ?? []).map((r: unknown) => ({ result: r }));
        }

        if (files && files.length > 0) {
          const results = [];
          for (const file of files) {
            const r = await browser.tabs.executeScript(target.tabId, { ...opts, file });
            results.push({ result: r?.[0] });
          }
          return results;
        }

        return [];
      },
    };
  }
})();
