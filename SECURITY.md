# Security Policy

## Reporting

**Never as a public issue.** Use GitHub's advisory form:
<https://github.com/DiLTAnalytics/dilt-bactwin-wizard/security/advisories/new>, or email `security@dilt.at`.

Include what the issue is, how to reproduce it and what an attacker could achieve. We acknowledge
within 3 working days, give an assessment and fix timeline within 10, and credit you in the
advisory unless you ask us not to.

Only the latest release is supported.

## Scope

An offline desktop app: no network requests, no accounts, nothing stored remotely. In scope:

- **Malicious files:** EDE CSV, project and sequence JSON (crashes, path traversal, resource exhaustion).
- **Malicious plugins:** code execution, escaping the plugin folder, or crashing the app.
- **Electron hardening:** context isolation, sandbox, protocol handler, CSP, the IPC bridge.
- **Supply chain:** a shipped dependency with a known vulnerability.

Out of scope: attacks that need write access to the machine already, and writing a value the
catalogue flags as unusual (that is intended).
