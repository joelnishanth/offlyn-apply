# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.2.x (latest) | Yes |
| < 0.2.0 | No |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, email **hi@offlyn.ai** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept (if applicable)
- Any relevant logs, screenshots, or extension version

You should receive a response within **72 hours**. If you don't hear back, follow up by email.

We'll keep you informed as the issue is investigated and fixed, and credit you in the release notes unless you prefer to remain anonymous.

## Scope

This extension handles sensitive personal data (resume content, profile information). The following are considered in-scope for security reports:

- Unauthorized data exfiltration (data leaving the local machine unexpectedly)
- Content script vulnerabilities that could be exploited by malicious web pages
- Storage security issues (plaintext storage of sensitive fields)
- Privilege escalation within the extension

The following are **out of scope**:

- Vulnerabilities in Ollama itself (report those to the [Ollama project](https://github.com/ollama/ollama))
- Issues requiring physical access to the user's machine
- Social engineering attacks

## Privacy Architecture

Offlyn Apply is designed to keep all data local:

- Profile data is stored in `browser.storage.local` — never synced to the cloud
- All AI inference runs through a local Ollama instance
- No analytics, telemetry, or tracking of any kind
- No network requests are made by the extension except to `localhost` (Ollama)
