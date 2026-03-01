# Offlyn Apply

> A privacy-first, offline-first Firefox extension that auto-fills job applications using a local AI model (Ollama). Your data never leaves your machine.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.2.4-green.svg)
![Firefox](https://img.shields.io/badge/browser-Firefox-orange.svg)

---

## What It Does

Offlyn Apply detects job application forms on sites like Workday, Greenhouse, Lever, and plain HTML forms, then fills them out automatically using your stored profile. Everything runs locally via [Ollama](https://ollama.com) — no cloud, no API keys, no data sent anywhere.

**Key features:**
- One-click autofill for job application forms
- Local AI (Ollama) for intelligent field matching and cover letter generation
- Reinforcement learning — improves from your corrections over time
- In-page dashboard to track application status
- Context-aware popup (adapts to what stage of the application you're on)
- 100% offline — works without internet after initial setup

---

## Requirements

- Firefox 109+
- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.com) running locally with a model pulled (e.g. `llama3.2`)

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/joelnishanth/offlyn-apply.git
cd offlyn-apply/apps/extension-firefox
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start Ollama

```bash
ollama serve
ollama pull llama3.2
```

### 4. Build the extension

```bash
npm run build
```

### 5. Load in Firefox

```bash
npm run run:firefox
```

Or load manually: open `about:debugging` → "This Firefox" → "Load Temporary Add-on" → select `dist/manifest.json`.

---

## Project Structure

```
offlyn-apply/
├── apps/
│   └── extension-firefox/     # Main Firefox extension
│       ├── src/
│       │   ├── background.ts   # Service worker / background script
│       │   ├── content.ts      # Content script (injected into pages)
│       │   ├── popup/          # Popup UI
│       │   ├── onboarding/     # First-run onboarding flow
│       │   ├── dashboard/      # In-page job tracker
│       │   ├── settings/       # Settings page
│       │   └── shared/         # Shared utilities, AI clients, autofill logic
│       ├── public/             # Static assets
│       └── package.json
├── docs/                       # Design specs and implementation plans
├── LICENSE
└── README.md
```

---

## Development

| Command | Description |
|---|---|
| `npm run build` | Production build |
| `npm run dev` | Watch mode (rebuilds on change) |
| `npm run run:firefox` | Build + launch Firefox with extension loaded |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## Security

If you find a security vulnerability, please follow the process in [SECURITY.md](SECURITY.md) rather than opening a public issue.

---

## License

[MIT](LICENSE) — © 2026 Joel Nishanth
