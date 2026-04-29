// Declares the Firefox native `browser` global using @types/webextension-polyfill shapes.
// The actual object is injected by Firefox at runtime; TypeScript doesn't know about it
// unless we declare it here.
import type _Browser from 'webextension-polyfill';

declare global {
  const browser: _Browser;
}

export {};
