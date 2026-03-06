---
title: TermBeam Security
description: How TermBeam secures your remote terminal — password auth, rate limiting, token cookies, and tunnel encryption.
---

# Security

## Overview

TermBeam provides access to a real shell on your machine. **Security is critical.**

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

<!-- prettier-ignore -->
!!! warning "`--public --no-password` is blocked"
    The CLI refuses to start with a public tunnel and no password.

### Private Tunnel (Default)

The default mode creates an ephemeral [Azure DevTunnel](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/) that requires **two layers of authentication**:

1. **Microsoft account login** — only the tunnel owner can access the URL
2. **TermBeam password** — auto-generated on each run

This is the safest way to access your terminal remotely. The tunnel URL is HTTPS, the connection is encrypted end-to-end, and the URL is unguessable.

### Public Tunnel

With `--public`, the tunnel URL is accessible to anyone who has it — no Microsoft login required. Password authentication is still enforced. This mode is useful for sharing temporary access, but the terminal is internet-accessible and protected only by the password and rate limiting (5 attempts/min/IP).

### LAN Exposure

With `--lan` or `--host 0.0.0.0`, TermBeam binds to all network interfaces. Any device on your local network can reach the server. On trusted home networks this may be acceptable; on shared or public networks (coffee shops, coworking spaces, hotel Wi-Fi) this is risky.

### Safe Defaults

Out of the box, TermBeam is configured conservatively:

- ✅ **Password auto-generated** — a strong random password is created on every run
- ✅ **Localhost bind** — server listens on `127.0.0.1` only
- ✅ **Private tunnel** — tunnel requires Microsoft account login (owner-only)
- ✅ **Ephemeral tunnel** — tunnel URL is deleted when TermBeam exits
- ✅ **Security headers** — X-Frame-Options, CSP, no-store, nosniff on all responses
- ✅ **Rate-limited login** — 5 attempts per minute per IP
- ✅ **httpOnly cookies** — tokens not accessible to JavaScript
- ✅ **WebSocket origin validation** — cross-origin connections rejected
- ✅ **Shell path validation** — only detected shells allowed

### Dangerous Modes

The following flags increase your attack surface. Use them only when you understand the trade-offs.

| Flag                       | Effect                              | When Acceptable                                                   |
| -------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `--public`                 | Removes Microsoft login from tunnel | Sharing temporary access with someone without a Microsoft account |
| `--no-password`            | Removes password auth               | Localhost-only on a single-user machine                           |
| `--lan` / `--host 0.0.0.0` | Binds to all interfaces             | Trusted home network with password enabled                        |
| `--lan --no-password`      | LAN-accessible, no auth             | **Not recommended**                                               |

### Quick Safety Checklist

Before running TermBeam, verify:

- [ ] **Password is enabled** — don't use `--no-password` unless localhost-only on a trusted machine
- [ ] **Tunnel is private** — don't use `--public` unless you specifically need anonymous tunnel access
- [ ] **Bind is localhost** — don't use `--lan` unless you need LAN access on a trusted network
- [ ] **Close when done** — TermBeam is not a daemon; don't leave it running unattended
- [ ] **Check the network** — on shared/public Wi-Fi, stick to defaults

### Work vs Personal Machine

**Personal machine (home network):** Default settings are appropriate. If you need LAN access (e.g., phone on the same Wi-Fi), `--lan` with the auto-generated password is reasonable.

**Work machine (corporate network):** Use defaults (private tunnel + auto-password). Avoid `--public` and `--lan` on corporate networks. TermBeam is a development tool, not a production remote access solution.

<!-- prettier-ignore -->
!!! danger "Not Recommended"
    - Running TermBeam with `--public` on machines with access to customer data or secrets
    - Using `--no-password --lan` on any network you don't fully control
    - Leaving TermBeam running unattended for extended periods
    - Using TermBeam as a replacement for SSH, VPN, or proper remote access infrastructure

## Security Features

### Authentication

- Password is auto-generated by default; can also be set via `--password` or `TERMBEAM_PASSWORD`
- Tokens are cryptographically random (32 bytes, hex-encoded)
- Tokens expire after 24 hours
- Session IDs use 128-bit entropy (`crypto.randomBytes(16)`, hex-encoded)
- Stored in httpOnly cookies (not accessible via JavaScript)
- Cookie uses `sameSite: strict` to prevent CSRF
- Cookie `Secure` flag is set dynamically based on the request protocol — enabled automatically when accessed over HTTPS (including via `X-Forwarded-Proto` from tunnel proxies), omitted for plain HTTP
- API routes (`/api/*`) always return JSON `401`/`429` responses. UI routes redirect to the login page.

### QR Code & Share Auto-Login (Share Tokens)

- On startup, a **share token** is generated and embedded in the QR code URL as `?ott=<token>`
- Scanning the QR code sets a full session cookie and redirects to the clean URL — no password typing required
- Share tokens are **one-time use** — consumed on first successful login to prevent replay attacks
- Share tokens **expire after 5 minutes**
- The share button generates a fresh share token via `GET /api/share-token` (authenticated endpoint)
- If the user already has a valid session cookie, a repeated `?ott=` request simply redirects without re-validating
- Raw password is never embedded in any URL

### Shell Path Validation

- The `POST /api/sessions` endpoint validates the `shell` parameter against the list of detected shells on the host
- Arbitrary shell paths are rejected — only shells returned by `GET /api/shells` are allowed
- The `cwd` parameter is validated to be an existing, absolute directory path

### Image Upload Validation

- The `POST /api/upload` endpoint validates uploaded images using multiple checks:
  - **Content-Type** must be an `image/*` MIME type
  - **Magic bytes** are verified against the declared content type to prevent spoofing
  - **File size** is capped at 10 MB (returns HTTP 413 if exceeded)
- Uploaded files are stored with UUID-generated filenames to prevent path traversal
- Requires authentication to upload or access uploaded files

### Terminal Resize Bounds

- WebSocket `resize` messages validate dimensions: columns must be 1–500, rows must be 1–200
- Values outside these bounds are silently ignored, preventing DoS via extreme terminal sizes

### WebSocket Origin Validation

- WebSocket connections include Origin header checks
- Cross-origin connections are rejected (close code `1008`) unless one side is `localhost`
- Prevents malicious websites from connecting to a local TermBeam instance

### Rate Limiting

- Login endpoint limited to **5 attempts per minute** per IP
- WebSocket auth limited to **5 attempts per minute** per IP
- Returns HTTP 429 (or WebSocket close) when exceeded

### HTTP Security Headers

Every response includes:

| Header                    | Value                        | Purpose               |
| ------------------------- | ---------------------------- | --------------------- |
| `X-Content-Type-Options`  | `nosniff`                    | Prevent MIME sniffing |
| `X-Frame-Options`         | `DENY`                       | Prevent clickjacking  |
| `Content-Security-Policy` | script/style/connect sources | Prevent XSS           |
| `Cache-Control`           | `no-store`                   | Prevent caching       |
| `Referrer-Policy`         | `no-referrer`                | No referrer leaks     |

### Client-Side Features

The following UI features are entirely client-side and introduce **no new server-side attack surface**:

- **Command completion notifications** — uses the browser [Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API), which requires explicit user permission (opt-in). No data is sent to external services; notifications are generated locally in the browser.
- **Terminal search** — runs in the browser via the xterm.js SearchAddon. Search queries never leave the client.
- **Command palette** — a client-side UI panel that triggers existing actions. No new endpoints or permissions required.

### Network Binding

- **Default:** Binds to `127.0.0.1` (localhost only)
- Use `--lan` or `--host 0.0.0.0` to allow LAN access
- The tunnel feature handles TLS via Azure DevTunnels

## Best Practices

<!-- prettier-ignore -->
!!! danger "Never Run Without a Password on a Public Network"
    Without authentication, anyone on the network can access your terminal with your user permissions.

1. **Password is on by default** — use `--no-password` only for trusted localhost scenarios. `--public` requires password authentication and will refuse to start without it
2. **Localhost is the default** — use `--lan` only when you need LAN access
3. **Tunnel access is private by default** — only you (the tunnel owner) can access it via Microsoft login. Use `--public` to allow public access, or `--no-tunnel` for LAN-only mode
4. **Close TermBeam when done** — it's not a daemon, don't leave it running
5. **Use on trusted networks** — TermBeam is not designed for hostile environments

## Reporting Vulnerabilities

**Please do NOT open a public GitHub issue for security vulnerabilities.** Instead, report vulnerabilities privately via the [Security Advisories](https://github.com/dorlugasigal/TermBeam/security/advisories) page — click "Report a vulnerability" and provide a detailed description.

---

## See Also

- **[Configuration](configuration.md)** — CLI flags, environment variables, and defaults
- **[Getting Started](getting-started.md)** — install and run TermBeam in under a minute
