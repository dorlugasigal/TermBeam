# Security Policy

## Supported Versions

| Version  | Supported          |
| -------- | ------------------ |
| latest   | :white_check_mark: |
| < latest | :x:                |

We only support the latest published version. Please upgrade before reporting issues.

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, report vulnerabilities privately:

1. Go to the [Security Advisories](https://github.com/dorlugasigal/TermBeam/security/advisories) page
2. Click **"Report a vulnerability"**
3. Provide a detailed description of the issue

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix or mitigation:** Depends on severity, typically within 2 weeks for critical issues

### What to expect

- We will acknowledge your report promptly
- We will work with you to understand and validate the issue
- We will develop a fix and coordinate disclosure
- You will be credited in the release notes (unless you prefer anonymity)

## Security Best Practices

When running TermBeam:

- Always use a **strong password** (`--generate-password` or `--password`)
- Bind TermBeam to **localhost** (`--host 127.0.0.1`) unless you need LAN access (default is `0.0.0.0`)
- Use a **reverse proxy with TLS** (nginx, Caddy) for production deployments
- Keep dependencies **up to date** (`npm update`)
- Review the [Security documentation](https://dorlugasigal.github.io/TermBeam/security/) for detailed guidance
