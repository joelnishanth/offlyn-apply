import browser from 'webextension-polyfill';

export default browser;
export { browser };
export type { Runtime, Tabs, Menus, Storage } from 'webextension-polyfill';

/**
 * Safe runtime reference for content scripts where webextension-polyfill
 * can throw ReferenceError. Falls back to native chrome API.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const chromeCompat: typeof browser = (typeof (globalThis as any).chrome !== 'undefined' ? (globalThis as any).chrome : browser) as typeof browser;
