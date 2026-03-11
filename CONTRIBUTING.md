# Contributing to Offlyn Apply

Thanks for your interest in contributing. This document covers how to set up a local dev environment, the PR process, and coding conventions.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Development Setup](#development-setup)
- [Coding Conventions](#coding-conventions)
- [Commit Messages](#commit-messages)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

---

## Getting Started

1. **Fork** the repo and clone your fork:
   ```bash
   git clone https://github.com/<your-username>/offlyn-apply.git
   ```

2. **Navigate to the extension you want to work on:**
   ```bash
   # For Chrome
   cd offlyn-apply/apps/extension-chrome

   # For Firefox
   cd offlyn-apply/apps/extension-firefox
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Install and start Ollama** (required for AI features):
   ```bash
   ollama serve
   ollama pull llama3.2
   ```

5. **Build and run:**
   ```bash
   # Chrome — load dist/ folder via chrome://extensions (Developer mode)
   npm run build

   # Firefox — launches browser with extension loaded
   npm run run:firefox
   ```

---

## Reporting Bugs

Before opening a new issue, search existing issues to avoid duplicates.

When filing a bug, include:
- Browser and version (Chrome or Firefox)
- Ollama model being used
- The job site/form where the issue occurs (if applicable)
- Steps to reproduce
- Expected vs actual behavior
- Console errors (open DevTools → Console)

Use the **Bug Report** issue template.

---

## Requesting Features

Open a **Feature Request** issue and describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

---

## Submitting a Pull Request

1. Create a branch from the latest `main`:
   ```bash
   git fetch origin
   git checkout origin/main -b your-branch-name
   ```

2. Make your changes, following the [coding conventions](#coding-conventions) below.

3. Run tests before pushing:
   ```bash
   npm test
   ```

4. Push to your fork and open a PR against `main`. Fill in the PR template.

5. Address any review feedback. PRs are merged once approved by a maintainer.

**Keep PRs focused** — one feature or fix per PR. Large PRs are harder to review and more likely to conflict.

---

## Development Setup

| Command | Description |
|---|---|
| `npm run build` | Production build to `dist/` |
| `npm run dev` | Watch mode — rebuilds on file changes |
| `npm run run:firefox` | Launch Firefox with the extension loaded |
| `npm test` | Run unit tests |
| `npm run test:watch` | Tests in watch mode |

The extension is built with plain TypeScript + esbuild (no framework). Content scripts run in isolated worlds; background scripts use the WebExtension API.

**Chrome:** After building, load the `dist/` folder via `chrome://extensions` with Developer mode enabled.

**Firefox:** Use `npm run run:firefox` or load via `about:debugging` → "This Firefox" → "Load Temporary Add-on".

---

## Coding Conventions

- **TypeScript** — all new code must be typed. Avoid `any`.
- **No framework in content scripts** — content scripts must stay framework-free to avoid conflicts with host pages.
- **React-compatible input setters** — when programmatically setting input values on React/Vue pages, use the property descriptor pattern (see `src/shared/react-input.ts`).
- **Page stability checks** — always wait for DOM stability before manipulating form fields (see `src/shared/dom.ts`).
- **No `eval()` or inline scripts** — CSP compliance is required.
- **Error handling** — don't swallow errors silently. Log with context using `src/shared/log.ts`.
- **No `console.log` in committed code** — use the project logger.

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

Examples:
```
feat(autofill): add Workday shadow DOM support
fix(popup): correct state transition after autofill
docs: update contributing guide
```

Keep the summary under 72 characters.
