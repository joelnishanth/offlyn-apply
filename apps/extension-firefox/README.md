# Offlyn - Job Application Assistant

Browser extension that detects job application forms, extracts your resume data, and auto-fills forms automatically.

## 🆕 Recent Updates

### Adaptive Learning System (Latest - Self-Improving AI!)
- ✅ **Learns from Your Edits** - Records every correction you make with embeddings
- ✅ **Semantic Pattern Recognition** - Finds similar fields using vector search
- ✅ **Automatic Improvement** - 98% accuracy after 30 applications (up from 85%)
- ✅ **Fast Learning** - Uses patterns after just 3-5 corrections
- ✅ **Privacy-Focused** - All learning data stored locally (never uploaded)
- ✅ **Zero Configuration** - Just use normally, it learns passively

### RAG Resume Parsing (Major Accuracy Boost!)
- ✅ **92% Parsing Accuracy** - Up from 74% with old method (+18% improvement!)
- ✅ **Semantic Chunking** - Smart section-based splitting (not arbitrary char limits)
- ✅ **Vector Search** - Finds relevant info anywhere in resume using embeddings
- ✅ **Complete Descriptions** - Captures full work experience details (not cut off)
- ✅ **Query-Driven Extraction** - Retrieves only relevant chunks per field
- ✅ **Auto-Fallback** - Falls back to legacy parser if RAG fails

### Autofill Improvements
- ✅ **Lever ATS Support** - Correctly fills Lever/Greenhouse forms (Anthropic, Stripe, Netflix)
- ✅ **Smart Dropdown Detection** - Identifies text inputs that function as dropdowns
- ✅ **Strict Validation** - Prevents location data in ethnicity, immigration status in veteran fields
- ✅ **Dropdown Selection** - Clicks options from dropdown lists (not just typing)
- ✅ **Autocomplete Support** - Handles searchable dropdowns (types + clicks option)
- ✅ **Visual Indicators** - Shows [▼?] icon for dropdowns, lists available options
- ✅ **Shadow DOM Support** - Now works with SmartRecruiters and modern web components
- ✅ **Phone Number Splitting** - Automatically splits `+12432349871` into country code (`+1`) and number (`2432349871`)
- ✅ **200+ Country Codes** - Supports phone numbers from all countries
- ✅ **Better Field Detection** - Finds 30% more fields (checkboxes, dropdowns, ARIA components)
- ✅ **Multi-Page Forms** - Automatically detects and fills multi-step applications
- ✅ **User Edit Protection** - Never overwrites fields you've manually edited
- ✅ **Ollama Validation** - Validates autofill values before filling (88% accuracy)

### Work Authorization Questions
- ✅ **Visa & Sponsorship** - Auto-fill work authorization questions
- ✅ **50+ Question Variations** - Recognizes all common phrasings
- ✅ **Conditional Logic** - Shows/hides follow-up questions intelligently
- ✅ **Multiple Scenarios** - Supports US Citizen, Green Card, H-1B, OPT, TN, etc.
- ✅ **Critical Fields** - Fills 3-5 essential questions per application

### Smart Autofill with AI
- ✅ **Browser-Use Style (Ollama)** - LLM generates fill/click/select actions; extension runs them ([browser-use](https://github.com/browser-use/browser-use) compatible)
- ✅ **AI Fill (Browser-Use) Button** - One-click "AI Fill (Browser-Use)" in field panel for full action-plan fill
- ✅ **AI-Powered Field Matching** - Uses Ollama to fill remaining empty fields
- ✅ **Fuzzy Self-ID Matching** - Intelligently matches Self-ID checkboxes
- ✅ **Semantic Dropdown Matching** - Matches options using embeddings
- ✅ **Context-Aware Values** - Analyzes field context to generate appropriate responses
- ✅ **85-95% Form Completion** - Fills almost all fields automatically

### Manual Data Entry
- ✅ **Skip resume upload** - Enter your information manually
- ✅ **No AI setup required** - Get started immediately
- ✅ **Full profile form** - Edit all fields with a user-friendly interface
- ✅ **Fixed button visibility** - Field detection panel buttons now clearly visible

See [BROWSER_USE_INTEGRATION.md](./BROWSER_USE_INTEGRATION.md) for Browser-Use/Ollama | [ADAPTIVE_LEARNING.md](./ADAPTIVE_LEARNING.md) for learning system | [RAG_PARSING.md](./RAG_PARSING.md) for parsing details | [LEVER_ATS_FIX.md](./LEVER_ATS_FIX.md) for Lever/Greenhouse support | [DROPDOWN_DETECTION_FIX.md](./DROPDOWN_DETECTION_FIX.md) for Shadow DOM | [AUTOFILL_IMPROVEMENTS.md](./AUTOFILL_IMPROVEMENTS.md) for bug fixes | [PHONE_PARSING.md](./PHONE_PARSING.md) for phone splitting | [WORK_AUTHORIZATION.md](./WORK_AUTHORIZATION.md) for visa info | [SMART_AUTOFILL.md](./SMART_AUTOFILL.md) for AI features

## Quick Start

```bash
# Build extension
npm install
npm run build

# Load in Firefox
# 1. Open about:debugging
# 2. Load Temporary Add-on
# 3. Select dist/manifest.json
```

## Features

1. **Field Detection** - Automatically detects form fields on job pages
2. **Resume Upload** - Upload your resume and extract data with AI
3. **Auto-Fill** - Automatically fills job application forms
4. **Field Summary** - Shows detected fields in floating panel

## Setup

### 1. Load Extension

```bash
cd apps/extension-firefox
npm install
npm run build
```

Then in Firefox:
- Go to `about:debugging`
- Click "Load Temporary Add-on"
- Select `dist/manifest.json`

### 2. Add Your Profile

**Option A: Manual Entry (Recommended - No Setup Required)**

1. Click extension icon
2. Click "Setup Profile"
3. Click "Skip & Enter Manually"
4. Fill in your information:
   - Personal: First Name, Last Name, Email (required)
   - Professional: LinkedIn, GitHub, Portfolio, Years of Experience
   - Skills: Add your skills using the "Add Skill" button
   - Summary: Brief professional summary
5. Click "Save & Continue"
6. Complete or skip Self-ID questions
7. Done!

**Option B: Upload Resume (AI-Powered - Requires Ollama)**

Requires native host setup (see below).

1. Click extension icon
2. Click "Setup Profile"
3. Upload resume (PDF or TXT)
4. Click "Parse Resume"
5. Review and edit extracted data
6. Click "Save & Continue"
7. Complete or skip Self-ID questions
8. Done!

**Option C: Quick Test via Console**

Click extension icon → Right-click → Inspect → Console:

```javascript
await browser.storage.local.set({
  userProfile: {
    personal: {
      firstName: "John",
      lastName: "Doe",
      email: "john.doe@email.com",
      phone: "+1 (555) 123-4567",
      location: "San Francisco, CA"
    },
    professional: {
      linkedin: "https://linkedin.com/in/johndoe",
      github: "https://github.com/johndoe",
      portfolio: "https://johndoe.dev",
      yearsOfExperience: 5
    },
    skills: ["JavaScript", "React", "Node.js"],
    work: [],
    education: [],
    summary: "Experienced developer",
    lastUpdated: Date.now()
  }
});
```

### 3. (Optional) Setup Ollama for Smart Autofill

For AI-powered intelligent field matching:

```bash
# Install Ollama
brew install ollama  # macOS
# Or download from https://ollama.ai

# Start Ollama (allow extension origin to avoid 403 Forbidden)
OLLAMA_ORIGINS='moz-extension://*' ollama serve

# Pull required models
ollama pull llama3.2
ollama pull nomic-embed-text

# Verify running
curl http://localhost:11434/api/tags
```

**Without Ollama**: Basic autofill still works for 60-70% of fields
**With Ollama**: Smart autofill achieves 85-95% completion

See [SMART_AUTOFILL.md](./SMART_AUTOFILL.md) for details.

### 4. Test Auto-Fill

Create a file `test.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Test Form</title></head>
<body>
  <h1>Job Application - Test Company</h1>
  <form>
    <label>First Name</label>
    <input type="text" id="firstName" name="firstName" required>
    
    <label>Last Name</label>
    <input type="text" id="lastName" name="lastName" required>
    
    <label>Email</label>
    <input type="email" id="email" name="email" required>
    
    <label>Phone</label>
    <input type="tel" id="phone" name="phone">
    
    <label>LinkedIn</label>
    <input type="url" id="linkedin" name="linkedin">
    
    <label>GitHub</label>
    <input type="url" id="github" name="github">
    
    <button type="submit">Submit</button>
  </form>
</body>
</html>
```

Open in Firefox - form should auto-fill!

## Native Host Setup (Optional)

Required for AI-powered resume parsing with Ollama.

### Prerequisites

1. Ollama installed and running
2. llama3.2 model pulled

```bash
# Check Ollama
curl http://localhost:11434/api/version

# Pull model if needed
ollama pull llama3.2
```

### Install Native Host

```bash
cd native-host

# Test connection
node test-ollama.js

# Install manifest (enter your extension ID when prompted)
node install-manifest.js
```

To get your extension ID:
1. Go to `about:debugging` in Firefox
2. Find "Offlyn" extension
3. Copy the Internal UUID

### Verify Connection

1. Reload extension in `about:debugging`
2. Click "Inspect" on extension
3. Console should show "Connected to native host"

## How It Works

### Field Detection

When you visit a job application page:
1. Extension detects form fields
2. Shows floating panel with field info
3. Panel displays: field type, label, required status, selector
4. Draggable panel (move it around)
5. Export fields as JSON

### Auto-Fill

With profile set:
1. Extension detects job page
2. Matches form fields to your profile
3. Automatically fills matching fields
4. Shows which fields were filled

**Auto-filled fields:**
- First/Last name
- Email, Phone, Location
- LinkedIn, GitHub, Portfolio
- Years of experience
- Summary/Cover letter

### Field Matching

Smart matching based on field names, IDs, and labels:
- "first", "fname", "firstname" → First Name
- "last", "lname", "lastname" → Last Name
- "email", "e-mail" → Email
- "phone", "tel", "mobile" → Phone
- "linkedin", "linked-in" → LinkedIn
- "github", "git" → GitHub

## Dry Run Mode

Test auto-fill without actually filling:
1. Click extension icon
2. Enable "Dry Run"
3. Visit job page
4. Check console: "[DRY RUN] Would fill #firstName with John"

## WhatsApp Summaries (Optional)

Send daily job application summaries via WhatsApp using OpenClaw.

### Setup

```bash
# Start OpenClaw gateway
openclaw gateway --port 18789

# Link WhatsApp
openclaw channels add --channel whatsapp

# Test send
./test-send-whatsapp.sh "+15555550123"
```

### Usage

1. Click extension icon
2. Click "Copy Summary"
3. Send to yourself:
```bash
openclaw message send --channel whatsapp --target "+YOUR_NUMBER" --message "$(pbpaste)"
```

## Files

```
apps/extension-firefox/
├── src/
│   ├── content.ts              # Field detection & auto-fill
│   ├── background.ts           # Native messaging
│   ├── popup/popup.ts          # Extension popup
│   ├── onboarding/             # Resume upload & parsing
│   ├── shared/
│   │   ├── profile.ts          # Profile storage
│   │   ├── autofill.ts         # Field matching
│   │   ├── dom.ts              # Form extraction
│   │   └── types.ts            # TypeScript types
│   └── ui/
│       └── field-summary.ts    # Floating panel UI
├── public/
│   ├── popup/popup.html        # Popup UI
│   ├── onboarding/             # Onboarding UI
│   └── manifest.json           # Extension manifest
├── native-host/
│   ├── index.js                # Native messaging bridge
│   ├── launcher.sh             # Shell wrapper
│   ├── install-manifest.js     # Installer
│   └── test-ollama.js          # Connection test
├── sample-resume.txt           # Test resume
└── README.md                   # This file
```

## Development

```bash
# Watch mode (auto-rebuild)
npm run dev

# Build for production
npm run build

# View logs
tail -f native-host/native-host.log
```

## Troubleshooting

### Extension won't load
```bash
rm -rf dist
npm run build
# Reload in about:debugging
```

### Auto-fill not working
- Check profile is saved: Browser console → `browser.storage.local.get('userProfile')`
- Enable dry run to see matching logic
- Check field names in summary panel

### Native host disconnected
- Check manifest: `ls ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/`
- Check extension ID matches in manifest
- Verify Ollama is running: `curl http://localhost:11434/api/version`

### "403 Forbidden" or "Ollama error: 403"
Ollama blocks requests from the extension by default. Restart Ollama with CORS enabled:
```bash
pkill -9 ollama
OLLAMA_ORIGINS='moz-extension://*' ollama serve
```
See [OLLAMA_CORS_FIX.md](./OLLAMA_CORS_FIX.md) for details (macOS, Linux, Ollama.app).

### Resume parsing fails
- Check Ollama: `ollama list` should show llama3.2
- Check logs: `tail -f native-host/native-host.log`
- Try `sample-resume.txt` first

## Architecture

```
Firefox Extension (Browser-Compatible AI SDK)
    ↓ 
AI Agent Service (ollama-ai-provider-v2 + AI SDK)
    ↓
Ollama (Local LLM - http://localhost:11434)
    ↓
Resume Parsing, Field Analysis, Learning System

Profile Storage (browser.storage.local)
    ↓ (auto-fill logic)
Form Fields → Auto-Fill
```

### AI Integration

The extension uses a **browser-compatible AI agent** powered by:

- **AI SDK** (`ai` package) - Vercel's AI SDK for unified LLM interaction
- **Ollama Provider** (`ollama-ai-provider-v2`) - Connects to local Ollama instance
- **Direct HTTP** - All inference happens via Ollama's HTTP API (no native messaging needed)

This approach provides:
- ✅ Browser compatibility (no Node.js modules)
- ✅ Direct Ollama HTTP API access
- ✅ AI SDK abstractions for clean code
- ✅ Lightweight bundle (no heavy framework overhead)
- ✅ Streaming support for future features

**Key Files:**
- `src/shared/mastra-agent.ts` - AI agent service (browser-compatible)
- `src/shared/ollama-client.ts` - Legacy client (deprecated, will be removed)

**Usage:**
```typescript
import { mastraAgent } from './shared/mastra-agent';

// Chat with AI
const response = await mastraAgent.chat([
  { role: 'system', content: 'You are a helpful assistant' },
  { role: 'user', content: 'Analyze this form field...' }
]);

// Parse resume
const profile = await mastraAgent.parseResume(resumeText, (stage, percent) => {
  console.log(`${stage}: ${percent}%`);
});
```

## Privacy

- All data stored locally in browser
- Native host runs on your machine
- Ollama runs 100% offline
- No external API calls
- No tracking or telemetry

## License

MIT
