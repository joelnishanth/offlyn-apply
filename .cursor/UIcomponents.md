# Offlyn UI Components Catalog

> **Purpose:** Reference document for the upcoming full UI redesign.
> Every UI component in the extension is cataloged here so nothing is missed during the rebuild.

Last updated: 2026-02-15

---

## Content Script UI (Injected into web pages)

### 1. Field Summary Panel — `src/ui/field-summary.ts`

**What it does:** Floating panel shown on job application pages that lists detected fields, displays job info, and offers Auto-Fill / Cover Letter buttons. Auto-minimizes to a draggable cube after 3 seconds of inactivity (pauses when mouse is inside).

**Exported functions:**
| Function | Description |
|----------|-------------|
| `showFieldSummary(fields, jobTitle?, company?)` | Show or update the panel |
| `hideFieldSummary()` | Remove the panel from the DOM |
| `toggleFieldSummary(fields, jobTitle?, company?)` | Toggle visibility |

**Injection method:** Appends `div#offlyn-field-summary` to `document.body`; injects `<style id="offlyn-field-summary-styles">` into `document.head`.

**Key DOM elements / CSS classes:**
- Root: `#offlyn-field-summary`, `.ofl-minimized`
- Cube (minimized state): `.ofl-cube`, `.ofl-cube-logo`
- Header: `.ofl-header`, `.ofl-brand`, `.ofl-logo`, `.ofl-title`, `.ofl-header-actions`, `.ofl-minimize-btn`, `.ofl-close`
- Body: `.ofl-body`, `.ofl-job`, `.ofl-job-title`, `.ofl-job-company`
- Stats: `.ofl-stats`, `.ofl-stat`, `.ofl-stat-num`, `.ofl-required`, `.ofl-stat-label`
- Actions: `.ofl-actions`, `.ofl-btn`, `.ofl-btn-fill`, `.ofl-btn-cover`
- Footer: `.ofl-footer`, `.ofl-link-btn`, `.ofl-sep`
- IDs: `#ofl-autofill-btn`, `#ofl-cover-letter-btn`, `#ofl-status`, `#ofl-refresh-btn`, `#ofl-details-btn`

**Dependencies:** `FieldSchema` from `../shared/types`

---

### 2. Inline Suggestion Tiles — `src/ui/inline-suggestion-tile.ts`

**What it does:** Small "AI fill" badges positioned inside empty text fields after autofill. Clicking triggers an AI suggestion. Tiles auto-hide when the field gets a value and reappear when cleared.

**Exported functions:**
| Function | Description |
|----------|-------------|
| `showInlineSuggestionTiles(fields, _filledSelectors, onClick)` | Register tiles for eligible text fields |
| `removeTile(selector)` | Remove a single tile by field selector |
| `removeAllTiles()` | Remove all tiles and clear dismissed state |
| `hasActiveTiles()` | Check if any tiles currently exist |

**Injection method:** Appends each tile `div.offlyn-ai-tile` to `document.body`; injects `<style id="offlyn-inline-tile-styles">` into `document.head`.

**Key DOM elements / CSS classes:**
- Root: `.offlyn-ai-tile`, `.offlyn-ai-tile--loading`, `.offlyn-ai-tile--fadeout`, `.offlyn-ai-tile--hidden`
- Children: `.offlyn-ai-tile__icon`, `.offlyn-ai-tile__text`
- Data attribute: `data-offlyn-selector`

**Dependencies:** `FieldSchema` from `../shared/types`

**Notes:** Uses `position: absolute` with scroll-aware calculations. Filters out non-text inputs (selects, comboboxes, `aria-autocomplete` fields, React-Select containers) via `isPlainTextInput` and `isInsideDropdownWidget`.

---

### 3. Autofill Notification — `src/ui/autofill-notification.ts`

**What it does:** Toast banner shown when form fields are first detected, displaying the field count. Auto-dismisses after 5 seconds.

**Exported functions:**
| Function | Description |
|----------|-------------|
| `showAutofillNotification(fieldCount)` | Show the notification |
| `hideAutofillNotification()` | Hide and remove it |

**Injection method:** Appends `div#offlyn-autofill-notification` to `document.body`; injects `<style id="offlyn-autofill-notification-styles">` into `document.head`.

**Key DOM elements / CSS classes:**
- Root: `#offlyn-autofill-notification`, `.show`
- Children: `.offlyn-notif-content`, `.offlyn-notif-icon`, `.offlyn-notif-text`, `.offlyn-notif-title`, `.offlyn-notif-subtitle`, `.offlyn-notif-close`

**Dependencies:** None

---

### 4. Progress Indicator — `src/ui/progress-indicator.ts`

**What it does:** Progress bar displayed during autofill operations. Shows a spinner, current field count, and completion state.

**Exported functions:**
| Function | Description |
|----------|-------------|
| `showProgress(total)` | Show the indicator with total field count |
| `updateProgress(current, total, fieldName?)` | Update progress bar and text |
| `hideProgress(delay?)` | Hide after optional delay (default 1000ms) |
| `showProgressComplete(success, filled, total)` | Show completion state then auto-hide |

**Injection method:** Appends `div#offlyn-progress-indicator` to `document.body`; injects `<style id="offlyn-progress-styles">` with keyframes.

**Key DOM elements / CSS classes:**
- Root: `#offlyn-progress-indicator`
- Children: `.spinner`, `#offlyn-progress-bar`, `#offlyn-progress-text`

**Dependencies:** None

---

### 5. Notification / Toast System — `src/ui/notification.ts`

**What it does:** General-purpose toast notification system supporting success, error, warning, and info messages.

**Exported functions:**
| Function | Description |
|----------|-------------|
| `showNotification(title, message, type?, duration?)` | Show a toast notification |
| `clearAllNotifications()` | Remove all toasts |
| `showSuccess(title, message, duration?)` | Success toast (green) |
| `showError(title, message, duration?)` | Error toast (red) |
| `showWarning(title, message, duration?)` | Warning toast (yellow) |
| `showInfo(title, message, duration?)` | Info toast (blue) |

**Injection method:** Creates `div#offlyn-notifications-container` in `document.body`; injects `<style id="offlyn-notification-styles">` into `document.head`. Each toast is appended as a child.

**Key DOM elements / CSS classes:**
- Container: `#offlyn-notifications-container`
- Toasts: dynamic IDs `notification_*`
- Keyframes: `slideInRight`, `slideOutRight`

**Dependencies:** None

---

### 6. Field Highlighter — `src/ui/field-highlighter.ts`

**What it does:** Highlights form fields during autofill with colored borders/shadows (blue = filling, green = success, red = error). Can show temporary labels above fields.

**Exported functions:**
| Function | Description |
|----------|-------------|
| `highlightField(selector, type?)` | Highlight a field |
| `removeHighlight(selector, delay?)` | Remove highlight |
| `highlightFieldAsFilling(selector)` | Blue "filling" highlight |
| `highlightFieldAsSuccess(selector, autoRemove?)` | Green success highlight |
| `highlightFieldAsError(selector, autoRemove?)` | Red error highlight |
| `clearAllHighlights()` | Clear all highlights |
| `highlightFieldsSequentially(selectors, delayBetween?)` | Staggered highlights |
| `showFieldLabel(selector, text, duration?)` | Temporary label above a field |

**Injection method:** Modifies existing elements' inline styles directly. Temporary label divs appended to `document.body`. Injects `<style id="offlyn-highlighter-styles">` for keyframes.

**Key DOM elements / CSS classes:**
- No persistent root; labels are temporary `div` elements with inline styles
- Keyframes: `slideInDown`, `slideOutUp`

**Dependencies:** None

---

### 7. Suggestion Panel — `src/ui/suggestion-panel.ts`

**What it does:** Right-side slide-in panel for reviewing smart suggestions before applying. Each card has a per-field "Apply" button and a checkbox to include/exclude from bulk apply. Hovering highlights the corresponding form field on the page.

**Exported functions:**
| Function | Description |
|----------|-------------|
| `showSuggestionPanel(suggestions, onApply, onDismiss)` | Show panel with suggestions |
| `hideSuggestionPanel()` | Hide and remove panel |
| `isSuggestionPanelVisible()` | Check visibility |

**Injection method:** Appends `div#offlyn-suggestion-panel` to `document.body`; injects `<style id="osp-styles">` into `document.head`.

**Key DOM elements / CSS classes:**
- Root: `#offlyn-suggestion-panel`, `.osp--open`
- Header: `.osp-header`, `.osp-logo`, `.osp-title`, `.osp-subtitle`, `.osp-close`
- Cards: `.osp-card`, `.osp-card--disabled`, `.osp-card--applied`, `.osp-card-head`, `.osp-toggle`, `.osp-card-label`, `.osp-badge`, `.osp-btn-single`, `.osp-applied-tag`
- Options: `.osp-options`, `.osp-option`, `.osp-option--selected`, `.osp-option-body`, `.osp-option-value`, `.osp-option-meta`, `.osp-source`, `.osp-reason`
- Footer: `.osp-footer`, `.osp-btn`, `.osp-btn-cancel`, `.osp-btn-apply`

**Dependencies:** `FieldSuggestion`, `SuggestionOption` from `../shared/suggestion-service`

**Note:** Currently not wired to a UI button (Smart Suggestions was replaced by Cover Letter). Kept for future use.

---

### 8. Cover Letter Panel — `src/ui/cover-letter-panel.ts`

**What it does:** Right-side slide-in panel for previewing AI-generated cover letters. Streams text live during generation. Offers Copy, Download (.txt), Auto-Apply (paste into cover letter field), and Regenerate actions.

**Exported functions:**
| Function | Description |
|----------|-------------|
| `openCoverLetterPanel(jobTitle, company, onAutoApply?)` | Open panel in generating state |
| `updateCoverLetterPreview(partialText)` | Live-update text while streaming |
| `showCoverLetterResult(result)` | Show final result with action buttons |
| `showCoverLetterError(msg)` | Show error state |
| `hideCoverLetterPanel()` | Close and remove panel |
| `isCoverLetterPanelVisible()` | Check visibility |

**Injection method:** Appends `div#offlyn-cover-letter-panel` to `document.body`; injects `<style id="ocl-styles">` into `document.head`.

**Key DOM elements / CSS classes:**
- Root: `#offlyn-cover-letter-panel`, `.ocl--open`
- Header: `.ocl-header`, `.ocl-logo`, `.ocl-title`, `.ocl-subtitle`, `.ocl-close`
- Body: `.ocl-body`, `.ocl-body-text`, `.ocl-generating`, `.ocl-spinner`, `.ocl-error`
- Actions: `.ocl-actions`, `.ocl-btn`, `.ocl-btn-copy`, `.ocl-btn-download`, `.ocl-btn-apply`, `.ocl-btn-regen`
- Utility: `.ocl-hidden`

**Dependencies:** `CoverLetterResult` from `../shared/cover-letter-service`

---

## Extension Popup UI

### 8. Browser Popup — `public/popup/popup.html` + `src/popup/popup.ts`

**What it does:** The main browser extension popup (300px wide). Contains enable toggle, job info bar, Auto-Fill/Smart Fill/Profile buttons, application stats, Ollama connection status, and a collapsible advanced section.

**Injection method:** Loaded as the `browser_action` popup page. Not injected into web pages.

**Key DOM elements / CSS classes:**
- Layout: `.header`, `.body`, `.footer`
- Header: `.header-brand`, `.header-logo`, `.header-title`, `.header-toggle`
- Job bar: `.job-bar`, `.job-bar-title`, `.job-bar-empty`
- Actions: `.actions`, `.actions-row`, `.btn`, `.btn-fill`, `.btn-suggest`, `.btn-profile`
- Stats: `.stats`, `.stat-card`, `.stat-num`, `.stat-label`
- Connection: `.conn`, `.conn-ok`, `.conn-err`
- Advanced: `.advanced-toggle`, `.advanced-panel`, `.btn-adv`, `.mini-toggle`, `.toggle-row`
- Footer: `.footer-link`
- IDs: `enabled-toggle`, `job-info`, `manual-autofill-btn`, `cover-letter-btn`, `profile-btn`, `stat-submitted`, `stat-detected`, `status`, `advanced-toggle`, `advanced-panel`, `dryrun-toggle`, `view-learned-btn`, `clean-selfid-btn`, `debug-profile-btn`, `copy-summary-btn`

**Dependencies (popup.ts):** `PopupState` from `../shared/types`; `getSettings`, `setSettings`, `getTodayApplications`, `generateSummaryMessage` from `../shared/storage`; `log`, `error` from `../shared/log`

---

## Onboarding UI

### 9. Onboarding Page — `public/onboarding/onboarding.html` + `src/onboarding/onboarding.ts`

**What it does:** Multi-step onboarding flow opened in a new tab. Guides users through resume upload, profile review, Self-ID questions, work authorization, learned values management, and a success screen.

**Steps:**
1. Resume upload (PDF/DOC/DOCX/TXT)
2. Profile review/edit
3. Self-ID (gender, race, orientation, veteran, transgender, disability)
4. Work authorization
5. Learned values management
6. Success screen

**Injection method:** Opened via `browser.runtime.getURL('onboarding/onboarding.html')` in a new tab.

**Key DOM elements / CSS classes:**
- Layout: `.container`, `.header`, `.content`
- Steps: `.step` (shown/hidden by step index)
- Upload: `.upload-area`, `.file-info`, `.status`, `.connection-status`
- Profile: `.profile-preview`, `.profile-section`
- Self-ID: `.question-group`, `.checkbox-group`, `.radio-group`
- Actions: `.button-group`, `.btn`, `.btn-primary`, `.btn-secondary`
- Learned values: `.learned-value-card`, `.ai-suggest-tile`, `.ai-suggestion-result`

---

## Context Menu (No dedicated UI file)

### 10. Right-Click Text Transform — `src/background.ts` + `src/shared/text-transform-service.ts`

**What it does:** Adds an "Offlyn AI" parent context menu on editable fields with three sub-items: Professional Fix, Expand, and Shorten. Transforms selected text via Ollama.

**Key interaction:** `browser.menus.create()` in background script; message relay to content script; visual feedback via blue `box-shadow` on the field + toast notification.

---

## Shared Style Patterns

All injected UI uses these conventions:
- **Style injection:** `<style>` tags with unique IDs (e.g., `offlyn-field-summary-styles`) in `document.head`
- **Namespace prefix:** All CSS classes use `ofl-` or `offlyn-` prefix to avoid conflicts with host page styles
- **Z-index range:** Injected elements use high z-index values (typically `999999` or `2147483647`)
- **Shadow DOM:** Not currently used (all elements are in the main DOM)
- **Cleanup:** Each component has a hide/remove function that cleans up both DOM elements and style tags
- **Color scheme:** Purple/indigo primary (`#7c3aed`, `#6d28d9`), with green for success, red for error
- **Font:** System font stack (no custom fonts loaded)
- **Animations:** CSS transitions and keyframes (slide-in, fade-out, pulse)
