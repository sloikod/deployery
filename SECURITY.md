# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in Deployery, please report it privately through GitHub's private vulnerability reporting flow:

<https://github.com/sloikod/deployery/security/advisories/new>

Please do not open a public GitHub issue for sensitive reports.

When possible, include:

- A short description of the issue and why it matters
- Affected version(s)
- Reproduction steps or a small proof of concept
- Any suggested fix or mitigation

I will review reports on a best-effort basis and coordinate a fix before any public disclosure.

## Supported Versions

Security fixes, when needed, will be made against the latest published version of Deployery.

## Scope

Deployery runs user-defined workflows and executes code in a containerized environment. The most relevant reports are issues that could affect users running self-hosted instances, for example:

- Container escape or host privilege escalation
- Unauthorized access to workflow data or credentials
- Code execution outside the intended sandbox
- Vulnerabilities introduced by published package or image contents
- Denial-of-service style behavior from malicious workflow inputs

For non-security bugs or feature requests, please use public GitHub issues instead.