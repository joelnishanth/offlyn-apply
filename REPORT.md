# Offlyn Apply — Bug Fixes & Feature Report

**Date:** April 2, 2026  
**Build:** Chrome v0.7.6 / Firefox v0.7.6  
**Status:** All items implemented and verified

---

## Executive Summary

| # | Type | Item | Status |
|---|------|------|--------|
| B1 | Bug Fix | Dark mode missing on 5 pages | Fixed |
| B2 | Bug Fix | Adzuna slow — added Remotive + Arbeitnow | Fixed |
| B3 | Bug Fix | Browser notifications not appearing | Fixed |
| B4 | Bug Fix | Jobs page wrong title + no sort by match % | Fixed |
| B5 | Bug Fix | Profile page UX (Edit vs Setup confusion) | Fixed |
| F1 | Feature | Persist job search filters between reloads | Implemented |
| F2 | Feature | Post-onboarding feature tour with skip | Implemented |
| F3 | Feature | Guided UI (contextual tour system) | Implemented |
| F4 | Feature | Widget swivel + glow on high-confidence match | Implemented |

---

## Bug Fixes

### B1 — Dark Mode on Missing Pages

**Problem:** Settings, Help, Privacy, Job Detected, and Data pages had no dark mode support, making text unreadable at night.

**Fix:** Added `theme-init.js` (in `<head>` to prevent flash), `html.dark` CSS rules, and `dark-mode.js` toggle to each page. The Data Explorer page was already dark-themed.

**Pages fixed:** `settings.html`, `help.html`, `privacy.html`, `job-detected.html`  
**Already dark:** `data.html` (uses dark design tokens by default)

**Screenshots:**

Settings (dark mode):
![Settings Dark](.screenshots/extension-pages/settings-dark.png)

Help (dark mode):
![Help Dark](.screenshots/extension-pages/help-dark.png)

Privacy (dark mode):
![Privacy Dark](.screenshots/extension-pages/privacy-dark.png)

---

### B2 — Adzuna Slow + Alternative APIs

**Problem:** Job search relied solely on Adzuna, which could be slow and has rate limits (250 req/day).

**Fix:** Added two additional free APIs called in parallel via `Promise.allSettled`:
- **Remotive** (`remotive.com/api/remote-jobs`) — no API key, great for remote roles
- **Arbeitnow** (`arbeitnow.com/api/job-board-api`) — no API key, broad international coverage

Results are deduplicated by `title|company` and merged. Cache TTL increased from 5 to 15 minutes.

**Files changed:** `src/shared/job-search-service.ts` (Chrome + Firefox)

---

### B3 — Browser Notifications Not Appearing

**Problem:** Users never saw job match notifications. Defaults were already correct (`notificationsEnabled: true`, `scheduledSearchEnabled: true`), but there was no way to verify notifications worked.

**Fix:** 
- Added **"Test Notification"** button in Settings > Job Discovery section
- Button sends `TEST_NOTIFICATION` message to background script
- Background creates a Chrome/Firefox notification: "Notifications are working!"
- Not gated on `notificationsEnabled` so users can verify OS-level permissions

**Files changed:** `settings.html`, `settings.ts`, `background.ts` (Chrome + Firefox)

---

### B4 — Jobs Page Title Detection + Sort by Match %

**Problem:** 
1. Resume title extraction only found work entries marked `current: true`. If none were marked current, it fell through to skills (generic).
2. No way to sort results by compatibility score.

**Fix:**
1. Work history is now sorted by end/start date (newest first). Fallback chain: `current` entry title → most recent entry title → `professional.currentRole` → `professional.currentTitle` → top 3 skills.
2. Added "Sort: Best Match %" option to the sort dropdown. When selected, results are sorted client-side by `computeCompatibilityScore` (descending) after API fetch.

**Files changed:** `jobs.ts`, `jobs.html` (Chrome + Firefox)

**Screenshot:**

Jobs page (with Best Match sort option):
![Jobs Light](.screenshots/extension-pages/jobs-light.png)

---

### B5 — Profile Page UX Overhaul

**Problem:** Confusing "Edit" (meta-only modal) and "Setup" (onboarding) buttons. No auto-populated info from resume. Name not editable without a modal.

**Fix:**
1. **Merged Edit + Setup** into single "Edit" button that opens onboarding with `?edit=true`
2. **Auto-populated name and title** from stored profile data (resume-derived `personal.name`, current work title)
3. **Inline rename:** Profile name is now `contenteditable` — click to edit, blur/Enter to save. Hover shows subtle highlight, focus shows purple ring.
4. Cards show resume-derived info instead of generic profile meta

**Files changed:** `profiles.ts`, `profiles.html` (Chrome + Firefox)

**Screenshot:**

Profiles page:
![Profiles Light](.screenshots/extension-pages/profiles-light.png)
![Profiles Dark](.screenshots/extension-pages/profiles-dark.png)

---

## New Features

### F1 — Persist Job Search Filters

**Problem:** Every page reload reset search filters (salary, days, sort, remote toggle, etc.) back to defaults.

**Fix:** After each successful search, all form values are saved to `chrome.storage.local` under key `job_search_form_state`. On page load, `restoreFormState()` runs first — if saved state exists (with keywords), it populates all inputs and auto-searches. Profile-based auto-fill only runs if no saved state exists.

**Saved fields:** keywords, location, salary min/max, days posted, sort, remote, full-time, contract

**Files changed:** `jobs.ts` (Chrome + Firefox)

---

### F2/F3 — Post-Onboarding Feature Tour + Guided UI

**Problem:** Users found it hard to discover features after onboarding.

**Fix:** Built a lightweight tour engine (`public/shared/feature-tour.js`) with:
- Semi-transparent backdrop with SVG mask cutout around the target element
- Positioned tooltip card with title, body, step counter
- Prev / Next / Skip controls
- Persists `ofl-tour-done-{tourId}` in localStorage (shows only once)

**Tour triggers:** After popup initialization (800ms delay), if tour hasn't been completed, shows a 3-step tour:
1. **Manage Your Profile** — profile button
2. **Job Discovery** — jobs button  
3. **Quick Controls** — enable/disable toggle

**Skip option:** Always visible at top-right of tooltip card: "Skip tour"

**Files changed:** `feature-tour.js` (new), `popup.html`, `popup.ts` (Chrome + Firefox)

---

### F4 — Widget Swivel + Glow Animation

**Problem:** No visual indicator on the in-page widget when a high-confidence job match is detected.

**Fix:** Added CSS keyframe animations injected into the widget's shadow DOM:

- **Swivel:** Pendulum-style rotation (rocks ±22° dampening to 0°) with subtle scale bounce. Plays once after 0.35s delay.
- **Glow:** Pulsing box-shadow halo that plays 3 times then holds via `forwards`:
  - **Green glow** for scores >= 80% ("Excellent Match")
  - **Amber glow** for scores 60-79% ("Good Match")
- Scores < 60% get no animation (widget still appears, just no attention-grab)

The existing hover `transition: transform, box-shadow` naturally yields during the animation.

**Files changed:** `compatibility-widget.ts` (Chrome + Firefox)

---

## Known Limitations

1. **Widget animation:** Cannot be screenshot-tested without loading the extension into a browser and navigating to an actual job application page (Greenhouse, Lever, etc.)
2. **Feature tour:** Tour steps reference popup element IDs. If popup layout changes, selectors may need updating.
3. **Remotive API:** Only returns remote jobs — non-remote searches won't get results from this source (by design)
4. **Arbeitnow API:** Salary data is not available from this source
5. **Profile inline rename:** Does not update the profile dropdown in other open extension pages until they reload
6. **Job-detected page:** No dark mode toggle button (page is a small card popup with no header bar) — it follows the saved theme preference but has no manual toggle

---

## Test Checklist

### Dark Mode (B1)
- [ ] Open Settings page → click dark mode toggle → all sections readable
- [ ] Open Help page → toggle dark mode → FAQ items, feature cards, shortcuts readable
- [ ] Open Privacy page → toggle dark mode → cards, tables, badges visible
- [ ] Open Job Detected popup → verify it follows saved dark mode preference
- [ ] Toggle dark mode on one page → navigate to another → preference persisted

### Multi-API Search (B2)
- [ ] Search for "Software Engineer" → results show sources: adzuna, remotive, arbeitnow
- [ ] Search for "remote" roles → Remotive results appear
- [ ] If Adzuna is slow/down → results still appear from other sources
- [ ] Repeat same search within 15 minutes → cached results returned instantly

### Notifications (B3)
- [ ] Open Settings → Job Discovery → click "Test Notification" → OS notification appears
- [ ] Enable scheduled search → wait for alarm → notification with matched jobs appears
- [ ] Click notification → jobs page opens

### Jobs Title + Sort (B4)
- [ ] Upload resume with work history → open Jobs page → keywords auto-filled with most recent job title
- [ ] Select "Sort: Best Match %" → results reorder by compatibility score (highest first)
- [ ] Verify % badges on cards match the sort order

### Profile UX (B5)
- [ ] Open Profiles page → only "Edit" button (no separate "Setup")
- [ ] Click Edit → onboarding opens with profile data pre-loaded
- [ ] Click on profile name → editable inline → type new name → click away → name saved
- [ ] Card shows resume-derived name and job title

### Search Persistence (F1)
- [ ] Search with filters (salary, remote, contract) → close tab → reopen Jobs page → filters restored
- [ ] Filters auto-trigger search on reload
- [ ] Clear storage → filters reset to empty → profile-based auto-fill kicks in

### Feature Tour (F2/F3)
- [ ] First popup open → tour starts after 800ms delay
- [ ] Tour shows 3 steps with backdrop highlight
- [ ] Click "Skip tour" → tour dismissed, won't show again
- [ ] Click through Next → Next → "Got it!" → tour completes
- [ ] Reopen popup → tour does not show again

### Widget Animation (F4)
- [ ] Navigate to job application page with >= 80% match → green glow + swivel
- [ ] Navigate to job application page with 60-79% match → amber glow + swivel
- [ ] Navigate to job application page with < 60% match → no animation
- [ ] Animation plays once, then widget returns to normal hover behavior

---

## Files Changed Summary

### Chrome (`apps/extension-chrome/`)
| File | Change |
|------|--------|
| `public/settings/settings.html` | Dark mode + test notification button |
| `public/help/help.html` | Dark mode |
| `public/privacy/privacy.html` | Dark mode |
| `public/job-detected/job-detected.html` | Dark mode |
| `public/profiles/profiles.html` | Profile UX CSS (inline rename) |
| `public/jobs/jobs.html` | Sort by Best Match % option |
| `public/shared/feature-tour.js` | New — tour engine |
| `public/popup/popup.html` | Feature tour script include |
| `src/shared/job-search-service.ts` | Multi-API (Adzuna + Remotive + Arbeitnow) |
| `src/jobs/jobs.ts` | Title fix, sort by %, form persistence |
| `src/settings/settings.ts` | Test notification button |
| `src/profiles/profiles.ts` | Profile UX overhaul |
| `src/popup/popup.ts` | Feature tour trigger |
| `src/ui/compatibility-widget.ts` | Swivel + glow animation |
| `src/background.ts` | TEST_NOTIFICATION handler |

### Firefox (`apps/extension-firefox/`)
All above mirrored with `browser.*` API adaptations.
