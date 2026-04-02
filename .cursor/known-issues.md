# Known Issues & Solutions

This file tracks all issues encountered during development, their root causes, and solutions. Always check this file before implementing similar features.

---

## React Input Values Not Persisting - 2024
**Severity**: Critical  
**Context**: When autofilling forms on React-based websites  
**Symptoms**: 
- Values appear briefly then disappear
- Forms show as empty even though value was set
- React devtools show state not updated

**Root Cause**: 
React uses synthetic events and controlled components. Setting `input.value` directly bypasses React's state management, so the framework doesn't know the value changed.

**Solution**: 
1. Get the native property descriptor from HTMLInputElement.prototype
2. Call the native setter: `nativeInputValueSetter.call(input, value)`
3. Dispatch both 'input' and 'change' events
4. For React 16+, the event must be trusted or use proper event init

**Prevention**: 
- Always use `setReactInputValue()` from `shared/react-input.ts`
- Never use `input.value = x` directly
- See browserextension-bestpractices.mdc for implementation

**Related Files**: 
- `src/shared/react-input.ts`
- `src/content.ts` (fillFieldWithValue, executeFillPlan)

---

## Form Autofill Race Conditions - 2024
**Severity**: High  
**Context**: Filling forms immediately after page load or during dynamic updates  
**Symptoms**:
- Fields get filled then cleared
- Dropdown options not available when trying to select
- Autocomplete fields don't accept values

**Root Cause**: 
- React/Vue apps remount components during hydration
- Async data fetching populates dropdowns after initial render
- DOM mutations from framework lifecycle

**Solution**: 
Implement page stability gates:
1. `waitForPageStability()` - Wait for DOM to stop mutating (500-800ms quiet)
2. `hasPendingRequests()` - Check Performance API for active XHR/fetch
3. Apply before filling dropdowns, autocomplete, or any dynamic field

**Prevention**: 
- Always call `waitForStability()` before autofill operations
- Especially critical for dropdown/autocomplete fields
- See browserextension-bestpractices.mdc for implementation

**Related Files**: 
- `src/content.ts` (stability functions)
- All autofill operations

---

## Shadow DOM Elements Not Found - [Add Date When Encountered]
**Severity**: Medium  
**Context**: [To be filled when encountered]  
**Symptoms**: 
- querySelector returns null for elements that visibly exist
- Event listeners don't work on certain components

**Root Cause**: 
Shadow DOM encapsulation prevents regular DOM queries from accessing shadow root elements.

**Solution**: 
1. Recursively traverse shadow roots
2. Use `element.shadowRoot` to access shadow DOM
3. Query within each shadow root separately

**Prevention**: 
- Always implement shadow DOM fallback in selectors
- Test on sites using Web Components

**Related Files**: 
- [To be filled]

---

## Eightfold AI Dropdowns - Click Target Mismatch - 2026-02-04
**Severity**: Critical  
**Context**: Autofilling dropdown/combobox fields on Eightfold AI ATS (e.g., PayPal careers)  
**Symptoms**: 
- Dropdown opens and correct option is found (logs show "Best match" with score 10000)
- Option appears to be "clicked" but input value stays empty
- Extension falls back to forcing value via React native setter (visible typing)
- Logs show: `Input value before click: <empty string> | after click: <empty string>`
- Extension reports "Filled 14 fields, 0 failed" but dropdowns visually remain unselected

**Root Cause**: 
Eightfold uses `<LI role="presentation">` elements as dropdown option wrappers. These LI elements do **NOT** have click event handlers. The actual click handlers are on **child `<button>` elements** inside the LI (class: `menuItem-module_menu-item-button__-RdU7`). Clicking the LI dispatches events that bubble up but never trigger the button's React onClick handler.

**Solution**: 
1. After finding the best-match option element, check for clickable children before clicking
2. Query for `button`, `[role="button"]`, or `div[class*="item"]` inside the option element
3. Click the child element instead of the wrapper LI
4. Verify `element.value` changed after click; if not, fall back to React native setter

```typescript
const clickableChild = optionEl.querySelector('button, [role="button"], div[class*="item"]');
if (clickableChild) {
  clickTarget = clickableChild as HTMLElement;
}
```

**Prevention**: 
- NEVER assume the matched option element itself is the click target
- Always search for clickable children (button, [role="button"]) inside list items
- Verify input value changed after click; implement fallback if not
- This pattern applies to ANY dropdown library that wraps buttons in LI/DIV containers

**Related Files**: 
- `src/content.ts` (tryMatchOption helper, executeFillPlan dropdown handling)

---

## Cross-Origin Iframe Forms Not Detected - 2026-02-04
**Severity**: Critical  
**Context**: Job applications embedded in cross-origin iframes (e.g., Greenhouse on careers.roblox.com)  
**Symptoms**: 
- Extension detects the page as a job application but finds 0 fields
- Logs show: "Found 1 iframe(s) - fields might be inside iframe"
- Clicking "Fill Form" says the form is empty
- After adding `all_frames: true`, fields detected in iframe but "Fill Form" button on parent page still says empty

**Root Cause**: 
Two-part issue:
1. Content script wasn't injected into cross-origin iframes (manifest missing `all_frames: true`)
2. Even after injection, the autofill trigger from the popup/parent frame only checked `allDetectedFields` in the parent context, which had 0 fields. The iframe had its own separate content script instance with its own `allDetectedFields`.

**Solution**: 
1. Add `"all_frames": true` to `manifest.json` content_scripts entry
2. Implement cross-frame messaging via `window.postMessage`:
   - Parent frame: if no local fields, iterate iframes and send `OFFLYN_TRIGGER_AUTOFILL`
   - Iframe: listen for `OFFLYN_TRIGGER_AUTOFILL` message and trigger `tryAutoFill` locally
   - Same pattern for `OFFLYN_TRIGGER_SUGGESTIONS`

**Prevention**: 
- Always consider iframe-embedded forms (Greenhouse, Lever often use iframes)
- Test on sites that embed ATS forms in iframes
- Any new trigger mechanism must include cross-frame forwarding

**Related Files**: 
- `public/manifest.json` (all_frames: true)
- `src/content.ts` (postMessage listeners, iframe iteration)

---

## Workday Multi-Page Forms Not Auto-Advancing - 2026-02-04
**Severity**: High  
**Context**: Multi-step Workday job applications (myworkdayjobs.com)  
**Symptoms**: 
- Autofill works on first page but doesn't click "Save and Continue"
- User has to manually advance each page
- Some pages have no fillable fields but still need advancing

**Root Cause**: 
The extension had no awareness of multi-page Workday wizards. After filling fields, it stopped. Workday requires clicking "Save and Continue" (or "Next"/"Continue") to advance to the next page, then re-scanning for new fields.

**Solution**: 
1. After `executeFillPlan`, detect if on Workday (`myworkdayjobs.com`)
2. Auto-click "Save and Continue" button after a 1.5s delay
3. Click even if `filledCount === 0` (page may be optional or pre-filled)
4. Fall back to "Next"/"Continue" button patterns
5. Re-trigger field detection after page transition

**Prevention**: 
- Multi-page ATS forms need explicit navigation handling
- Always attempt to advance even if no fields were filled on current page
- Treat each page transition as a fresh form scan

**Related Files**: 
- `src/content.ts` (Workday auto-advance logic after executeFillPlan)

---

## Template for New Issues

Copy this template when documenting new issues:

```markdown
## [Issue Title] - [YYYY-MM-DD]
**Severity**: Critical/High/Medium/Low  
**Context**: [When/where this occurs - be specific]  
**Symptoms**: 
- [Observable behavior 1]
- [Observable behavior 2]

**Root Cause**: 
[Technical explanation of WHY this happens, not just WHAT happens]

**Solution**: 
[Step-by-step fix with code references]

**Prevention**: 
- [How to avoid this in future implementations]
- [Patterns/checks to apply]

**Related Files**: 
- [List all files that needed changes]
- [Reference relevant best practice docs]

---
```

## Notes

- Keep this file up to date after every bug fix
- Be specific with dates and context
- Focus on ROOT CAUSE, not just symptoms
- Link to related files and documentation
- If an issue becomes a pattern, promote it to best practices

---

## Qwen3:4b Incompatible with JSON Extraction Pipeline - 2026-03-31
**Severity**: Critical  
**Context**: A/B testing Qwen3:4b + mxbai-embed-large vs Llama3.2 + nomic-embed-text for resume parsing  
**Symptoms**: Resume parsing fails with "No response content from AI agent". All parsing attempts produce empty results.  
**Root Cause**: Qwen3 models have a built-in "thinking" mode that generates extensive reasoning in a separate `thinking` field before producing the actual answer in `response`. When token budget is consumed by thinking, `data.response` is an empty string. Our `ollamaGenerate()` reads only `data.response`, which returns `""`, causing the `if (!content)` check to throw. Additionally, even when thinking doesn't exhaust the budget, response times are 59+ seconds for trivial prompts (vs 0.13 seconds for Llama3.2), making it impractical for a browser extension with multiple sequential LLM calls.  
**Solution**: Use Llama3.2 instead. If Qwen3 support is needed in the future, either: (1) disable thinking mode via Ollama API `think: false` option, (2) fall back to `data.thinking` when `data.response` is empty, or (3) significantly increase `num_predict` to leave room for actual output after thinking.  
**Prevention**: Before adopting any new model, always test with actual prompts used in production (JSON extraction) and verify both response content and latency. Models with "reasoning" or "thinking" modes need special handling.  
**Related Files**: `apps/extension-chrome/src/shared/mastra-agent.ts`, `apps/extension-chrome/src/shared/rag-parser.ts`

---

## Resume Parsing: Work Experience Empty for Glen Cook Resume - 2026-03-31
**Severity**: High  
**Context**: Llama3.2 + nomic-embed-text RAG parsing of Glen Cook's resume through onboarding flow  
**Symptoms**: `work: []` in parsed output despite 15+ years of detailed work experience in the resume  
**Root Cause**: The RAG chunking + retrieval may not be surfacing work experience chunks effectively for shorter resumes (4.0 KB). The semantic chunking or query "work experience employment history job roles" may not be matching the resume sections correctly.  
**Solution**: Investigate RAG retrieval for work experience extraction. Consider using the single-pass parser for small resumes (< 3000 chars is already handled, but this may be just over the threshold).  
**Prevention**: Add integration tests with known resumes and expected field coverage.  
**Related Files**: `apps/extension-chrome/src/shared/rag-parser.ts`

---

## Resume Parsing: Company Names Not Extracted in Joel Resume - 2026-03-31
**Severity**: Medium  
**Context**: Llama3.2 parsing of Joel's resume - company names are empty for most work entries  
**Symptoms**: `company: ""` for work entries. Job titles contain the company name embedded (e.g., "Amazon Web Services, Palo Alto, CA - Senior Solution Architect").  
**Root Cause**: The extraction prompt asks for `company` and `title` separately but the resume format embeds company and title in a single line. Llama3.2 puts everything in the `title` field instead of separating them.  
**Solution**: Improve the work experience extraction prompt to explicitly instruct separation of company name from title, or add post-processing to split "Company, Location - Title" patterns.  
**Prevention**: Test with various resume formats during development.  
**Related Files**: `apps/extension-chrome/src/shared/rag-parser.ts`

---

## Model Name Mismatch Across Extension Code - 2026-04-01
**Severity**: Critical  
**Context**: Fresh VM installs fail at resume parsing even when Ollama is connected and models are pulled  
**Symptoms**:
- `"Required AI model not found"` error on resume parsing page
- Ollama shows connected (green checkmark) but parsing fails
- `setup-mac.sh` pulls `llama3.2` + `nomic-embed-text` but extension code requests `qwen3:4b` + `mxbai-embed-large`

**Root Cause**: Model names were hardcoded in 8+ files across both Chrome and Firefox extensions. When the decision was made to switch from Qwen3 to Llama3.2, only some files were updated. The following files all had independent model name constants: `ollama-config.ts`, `ollama-client.ts`, `ollama-service.ts`, `mastra-agent.ts`, `error-classify.ts`, `resume-tailor-service.ts`, `cover-letter-service.ts`, `browser-use-actions.ts`, `text-transform-service.ts`, `field-validator.ts`.

**Solution**: Updated all files to use `llama3.2` and `nomic-embed-text` consistently. Verified by grepping built JS bundles for old model names.

**Prevention**:
- Model names should be defined in ONE place (`ollama-config.ts`) and imported everywhere
- Before any release, run: `grep -r "qwen3\|mxbai-embed" apps/ --include="*.ts"` to verify zero old references
- Before any release, verify built bundles: `unzip -p <zip> background.js | grep -o "qwen3\|mxbai-embed\|llama3\.2\|nomic-embed-text" | sort | uniq -c`
- When switching models, search the ENTIRE codebase, not just the file you're editing

**Related Files**: All `src/shared/ollama-*.ts`, `src/shared/mastra-agent.ts`, `src/shared/error-classify.ts`, `src/shared/resume-tailor-service.ts`, `src/shared/cover-letter-service.ts`, `src/shared/browser-use-actions.ts`, `src/shared/text-transform-service.ts`, `src/shared/field-validator.ts`

---

## Firefox CORS Blocks Localhost Fetch from Extension Pages - 2026-04-01
**Severity**: Critical  
**Context**: Firefox extension onboarding page cannot check Ollama connection at `http://localhost:11434`  
**Symptoms**:
- `Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at http://localhost:11434/api/version`
- `NetworkError when attempting to fetch resource`
- Works fine on the developer's machine but fails on fresh VMs

**Root Cause**: Firefox does not allow `moz-extension://` pages to fetch `http://localhost` directly due to CORS policy. Chrome does not have this restriction for `chrome-extension://` pages. The developer's machine worked because Ollama had `OLLAMA_ORIGINS` set from a previous manual install, but fresh installs don't have this set before the helper runs `setup-mac.sh`.

**Solution**: Added a background script proxy in Firefox's `background.ts`. The onboarding page sends a `CHECK_OLLAMA_CONNECTION` message to the background script, which performs the fetch (background scripts have fewer CORS restrictions) and returns the result.

**Prevention**:
- NEVER assume extension pages can fetch localhost in Firefox -- always proxy through background script
- When testing Ollama connectivity, always test on a fresh VM without prior Ollama configuration
- Chrome and Firefox extension pages have different network capabilities; test both

**Related Files**: `apps/extension-firefox/src/background.ts` (CORS proxy handler), `apps/extension-firefox/src/onboarding/onboarding.ts` (uses message-based connection check)

---

## Native Messaging Host Not Found After .pkg Install - 2026-04-01
**Severity**: Critical  
**Context**: `offlyn-helper-signed.pkg` installs helper files but Chrome/Firefox report "Specified native messaging host not found"  
**Symptoms**:
- `[NativeMsg] connectNative disconnected: Specified native messaging host not found`
- Helper files exist in `~/.offlyn/` but native messaging manifests are missing or point to wrong paths
- Works for the developer but fails in VMs

**Root Cause**: Two issues compounded:
1. The `build-mac-pkg.sh` postinstall script used `$HOME` which resolved to the *build machine's* home directory, not the install target's
2. Chrome's native messaging manifest `allowed_origins` only included the published CWS extension ID, but unpacked/dev extensions get a different ID

**Solution**:
1. Fixed postinstall to detect the active user's home directory at install time and copy files there
2. Added dynamic detection of unpacked Offlyn extension IDs from Chrome's `Secure Preferences` during `.pkg` install
3. Added a 5-second timeout to `CHECK_NATIVE_HELPER` to prevent indefinite hangs when the host is missing

**Prevention**:
- NEVER hardcode `$HOME` or user paths in `.pkg` postinstall scripts -- detect at runtime
- Always include both published and development extension IDs in `allowed_origins`
- Test `.pkg` installs on a fresh user account, not the build machine
- Add timeouts to all native messaging operations

**Related Files**: `scripts/build-mac-pkg.sh`, `apps/extension-chrome/src/background.ts`, `apps/extension-firefox/src/background.ts`

---

## Ollama CORS Not Applied on Fresh Install - 2026-04-01
**Severity**: High  
**Context**: `setup-mac.sh` configures CORS but running Ollama doesn't pick it up  
**Symptoms**:
- `launchctl setenv OLLAMA_ORIGINS` runs successfully
- But `ollama serve` starts without CORS origins
- Connection tests fail with CORS errors even after setup completes

**Root Cause**: `launchctl setenv` sets environment variables for future processes launched by launchd, but the `nohup ollama serve` spawned by the script inherits the *current shell's* environment, not the launchd one. If `OLLAMA_ORIGINS` isn't exported in the current shell, the spawned Ollama process doesn't see it.

**Solution**: Three-pronged approach in `setup-mac.sh`:
1. `launchctl setenv OLLAMA_ORIGINS "$ORIGINS"` (persists for future launches)
2. `export OLLAMA_ORIGINS="$ORIGINS"` (current shell)
3. `OLLAMA_ORIGINS="$ORIGINS" nohup ollama serve` (inline env var for the process)
4. `pkill -f "ollama serve"` before starting to ensure old instances without CORS are killed

**Prevention**:
- When setting env vars for a spawned process, ALWAYS pass them inline (`VAR=val command`)
- Kill existing instances before restarting with new config
- Test the full setup flow on a machine with NO prior Ollama installation

**Related Files**: `scripts/setup-ollama/setup-mac.sh`

---

## Windows Helper .bat Missing from GitHub Release - 2026-04-01
**Severity**: High  
**Context**: Windows users clicking "Download for Windows" on onboarding page get a 404 error  
**Symptoms**: `404 Not Found` when downloading `offlyn-windows-installer.bat` from GitHub release

**Root Cause**: When creating the v0.7.5 GitHub release, only the `.pkg` was uploaded. The `.bat` file was not included in the `gh release create` command.

**Prevention**:
- Release checklist must include ALL platform artifacts: `.pkg` (macOS), `.bat` (Windows)
- After uploading, verify ALL assets exist: `gh release view <tag> --json assets --jq '.assets[].name'`
- Keep a release script or checklist that enumerates every required artifact

**Related Files**: `releases/v0.7.4/native-helpers/offlyn-windows-installer.bat`

---

## v0.7.5 Release Verification Checklist
This is not an issue but a release checklist derived from all the above problems:

1. **Model consistency**: `grep -r "qwen3\|mxbai-embed" apps/ --include="*.ts"` must return zero results
2. **Version alignment**: `manifest.json`, `package.json` in both Chrome and Firefox must match
3. **Helper URLs**: Both `onboarding.ts` files must point to the same release tag
4. **Build verification**: `unzip -p <zip> background.js | grep -o "model_name"` in built bundles
5. **GitHub release assets**: `.pkg` AND `.bat` both uploaded, verify with `gh release view`
6. **Fresh VM test**: Chrome and Firefox on macOS, Chrome and Firefox on Windows
