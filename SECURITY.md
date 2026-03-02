# Security Policy

## Supported Versions

| Version  | Supported          |
| -------- | ------------------ |
| latest   | :white_check_mark: |
| < latest | :x:                |

We only support the latest published version. Please upgrade before reporting issues.

## Threat Model

TermBeam exposes a real shell over the network. The risk depends entirely on **how** you run it. Understanding the operating modes below helps you make informed decisions.

### Operating Modes

TermBeam has three access layers that combine to determine your risk profile:

| Mode                          | Command                                    | Who Can Connect                       | Auth                              | Risk      |
| ----------------------------- | ------------------------------------------ | ------------------------------------- | --------------------------------- | --------- |
| **Default (private tunnel)**  | `termbeam`                                 | Only you (Microsoft login + password) | Auto-password + tunnel owner auth | ✅ Low    |
| **Public tunnel**             | `termbeam --public`                        | Anyone with the URL + password        | Auto-password                     | ⚠️ Medium |
| **LAN-only (localhost)**      | `termbeam --no-tunnel`                     | Local machine only                    | Auto-password                     | ✅ Low    |
| **LAN-only (all interfaces)** | `termbeam --no-tunnel --lan`               | Any device on your network            | Auto-password                     | ⚠️ Medium |
| **Localhost, no password**    | `termbeam --no-tunnel --no-password`       | Local processes only                  | None                              | ⚠️ Medium |
| **LAN, no password**          | `termbeam --no-tunnel --no-password --lan` | Anyone on your network                | None                              | 🔴 High   |

> **Note:** `--public --no-password` is rejected by the CLI — TermBeam refuses to start with a public tunnel and no password.

### Private Tunnel (Default)

The default mode creates an ephemeral [Azure DevTunnel](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/) that requires **two layers of authentication**:

1. **Microsoft account login** — only the tunnel owner can access the URL
2. **TermBeam password** — auto-generated on each run

This is the safest way to access your terminal remotely. The tunnel URL is HTTPS, the connection is encrypted end-to-end, and the URL is unguessable.

### Public Tunnel

With `--public`, the tunnel URL is accessible to anyone who has it — no Microsoft login required. Password authentication is still enforced and required. This mode is useful for sharing temporary access, but the terminal is effectively internet-accessible and protected only by the password and rate limiting (5 attempts/min/IP).

### LAN Exposure

With `--lan` or `--host 0.0.0.0`, TermBeam binds to all network interfaces. Any device on your local network can reach the server. On trusted home networks this may be acceptable; on shared or public networks (coffee shops, coworking spaces, hotel Wi-Fi) this is risky.

## Safe Defaults

Out of the box, TermBeam is configured conservatively:

- ✅ **Password auto-generated** — a strong random password is created on every run
- ✅ **Localhost bind** — server listens on `127.0.0.1` only, not reachable from the network
- ✅ **Private tunnel** — tunnel requires Microsoft account login (owner-only access)
- ✅ **Ephemeral tunnel** — tunnel URL is deleted when TermBeam exits
- ✅ **Security headers** — X-Frame-Options, CSP, no-store, nosniff on all responses
- ✅ **Rate-limited login** — 5 attempts per minute per IP
- ✅ **httpOnly cookies** — tokens not accessible to JavaScript
- ✅ **WebSocket origin validation** — cross-origin connections rejected
- ✅ **Shell path validation** — only detected shells allowed, arbitrary paths rejected

You do not need to change any defaults to use TermBeam safely.

## Dangerous Modes

The following flags increase your attack surface. Use them only when you understand the trade-offs.

### `--public` — Public tunnel access

Removes the Microsoft login requirement from the tunnel. Anyone with the URL can attempt to log in. Mitigated by password auth and rate limiting, but the terminal is internet-facing.

**When acceptable:** Sharing temporary access with someone who doesn't have a Microsoft account.
**Mitigation:** Use a strong password. Close TermBeam when done.

### `--no-password` — Disable authentication

Removes password protection entirely. Any client that can reach the server has full terminal access.

**When acceptable:** Localhost-only use on a single-user machine where no untrusted local processes are running.
**Never combine with:** `--public` (CLI rejects this) or `--lan` on shared networks.

### `--lan` / `--host 0.0.0.0` — Bind to all interfaces

Makes the server reachable from any device on your local network. Combined with `--no-password`, this gives any network device unrestricted terminal access.

**When acceptable:** Trusted home network with password enabled.
**Not recommended:** Public Wi-Fi, shared office networks, or any network with untrusted devices.

### Combining dangerous flags

| Combination              | Result                                 | Risk      |
| ------------------------ | -------------------------------------- | --------- |
| `--public`               | Internet-accessible, password required | ⚠️ Medium |
| `--no-password`          | No auth, localhost only                | ⚠️ Medium |
| `--lan`                  | LAN-accessible, password required      | ⚠️ Medium |
| `--lan --no-password`    | LAN-accessible, no auth                | 🔴 High   |
| `--public --no-password` | **Blocked by CLI**                     | —         |

## Quick Safety Checklist

Before running TermBeam, verify:

- [ ] **Password is enabled** — don't use `--no-password` unless localhost-only on a trusted machine
- [ ] **Tunnel is private** — don't use `--public` unless you specifically need anonymous tunnel access
- [ ] **Bind is localhost** — don't use `--lan` or `--host 0.0.0.0` unless you need LAN access
- [ ] **Close when done** — TermBeam is not a daemon; don't leave it running unattended
- [ ] **Check the network** — on shared/public Wi-Fi, stick to defaults (private tunnel + localhost)
- [ ] **Review the password** — if using `--password`, ensure it's strong (12+ chars, mixed case/symbols)

## Work vs Personal Machine

### Personal machine (home network)

Default settings are appropriate. If you need LAN access (e.g., phone on the same Wi-Fi), `--lan` with the auto-generated password is reasonable.

### Work machine (corporate network)

- **Use defaults** (private tunnel + auto-password) — this routes through your Microsoft account
- **Avoid `--public`** — a public tunnel on a corporate device exposes the terminal to the internet
- **Avoid `--lan`** on corporate networks — other devices on the network could discover the server
- **Don't use for production** — TermBeam is a development tool, not a production remote access solution

### Not recommended

- Running TermBeam with `--public` on machines with access to customer data or secrets
- Using `--no-password --lan` on any network you don't fully control
- Leaving TermBeam running unattended for extended periods
- Using TermBeam as a replacement for SSH, VPN, or proper remote access infrastructure

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
- Bind TermBeam to **localhost** (`--host 127.0.0.1`) unless you need LAN access (default is `127.0.0.1`)
- Use a **reverse proxy with TLS** (nginx, Caddy) for production deployments
- Keep dependencies **up to date** (`npm update`)
- Review the [Security documentation](https://dorlugasigal.github.io/TermBeam/security/) for detailed guidance
