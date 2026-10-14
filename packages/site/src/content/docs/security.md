---
title: TermBeam Security
description: How TermBeam secures your remote terminal — password and passkey auth, revocable remembered devices, cross-site protection, rate limiting, and tunnel encryption.
---

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
:::caution[`--public --no-password` is blocked]
The CLI refuses to start with a public tunnel and no password.
:::

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
- ✅ **Security headers** — X-Frame-Options, CSP, no-store, nosniff on app responses (the `/preview` proxy is exempt; PWA icons and the manifest are cacheable)
- ✅ **Rate-limited login** — 5 attempts per minute per IP
- ✅ **Constant-time password comparison** — prevents timing-based password recovery
- ✅ **httpOnly cookies** — tokens not accessible to JavaScript
- ✅ **Revocable remembered devices** — see and sign out every device from Settings → Security
- ✅ **Passkeys** — phishing-resistant Face ID / Touch ID unlock, no password typing
- ✅ **Cross-site protection** — API calls and WebSockets from other origins are rejected
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
:::danger[Not Recommended]

- Running TermBeam with `--public` on machines with access to customer data or secrets
- Using `--no-password --lan` on any network you don't fully control
- Leaving TermBeam running unattended for extended periods
- Using TermBeam as a replacement for SSH, VPN, or proper remote access infrastructure
  :::

## Security Features

### Authentication

- Password is auto-generated by default; can also be set via `--password` or `TERMBEAM_PASSWORD`
- Session tokens are cryptographically random (32 bytes, hex-encoded)
- Terminal session IDs use 128-bit entropy (`crypto.randomBytes(16)`, hex-encoded)
- Stored in httpOnly cookies (not accessible via JavaScript)
- Cookie uses `sameSite: strict`; cross-site requests are additionally rejected server-side (see below)
- Cookie `Secure` flag is set dynamically based on the request protocol — enabled automatically when accessed over HTTPS (including via `X-Forwarded-Proto` from tunnel proxies), omitted for plain HTTP
- API routes (`/api/*`) always return JSON `401`/`429` responses. UI routes redirect to `/login?next=…` and return you to the original page after signing in.

### Remembered Devices

Each sign-in creates a **device session**:

| Login option                   | Lifetime                              | Stored on disk |
| ------------------------------ | ------------------------------------- | -------------- |
| **Remember this device** (on)  | 7 days without use, 30 days at most   | Yes            |
| **Remember this device** (off) | 2 hours without use, 12 hours at most | No             |

- Activity slides the idle window (an open terminal counts as activity), but never past the absolute limit.
- Remembered sessions are persisted to `~/.termbeam/auth.json` (mode `0600`) as **SHA-256 hashes only** — a copied file cannot be replayed as a cookie.
- Sessions survive a TermBeam restart **only if the password is unchanged**: the file stores a scrypt fingerprint of the password, and starting with a different password (including a new auto-generated one) signs every remembered device out.
- **Settings → Security** lists every signed-in device (browser, sign-in method, last seen, IP) with per-device **Sign out**, plus **Sign out everywhere**. Revoking a device also closes its open terminal WebSockets immediately (close code `4401`).
- The startup banner shows how many remembered devices and passkeys exist. `termbeam --reset-auth` signs out every device and removes every passkey.

### Passkeys

After a password or QR sign-in, TermBeam offers to register a **passkey** so the next unlock is a single Face ID / Touch ID / fingerprint / PIN confirmation:

- Standard WebAuthn with `userVerification: required`; ES256, Ed25519 and RS256 keys are supported.
- Passkeys are phishing-resistant: they are bound to the exact host name they were created on (the tunnel host, or `localhost`).
- Passkeys need a secure context — the HTTPS tunnel URL, your `--public-url`, or `http://localhost`. On plain-HTTP LAN addresses the password is the only option.
- The page reports its own origin when a passkey ceremony starts, because the Dev Tunnels relay rewrites a same-origin `Origin` header to `http://localhost:<port>`. TermBeam only accepts an origin whose host it is really reached at, and the browser signs the true origin into the credential, which is verified on every registration and sign-in.
- Passkeys are explicit credentials and **survive password changes and restarts** until removed in Settings → Security (removing one also signs out the devices that used it) or with `--reset-auth`.
- Because a passkey is tied to the host name, use `--persisted-tunnel` for a stable tunnel URL if you want passkeys to keep working across restarts. If a tunnel has to be re-created (see [Tunnel Reliability](#tunnel-reliability)), register a new passkey on the new URL.
- Public keys and signature counters are stored in `~/.termbeam/auth.json`; private keys never leave your device.

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

### Cross-Site Protection (WebSocket + API)

- A browser origin must match an address TermBeam is actually reached at — same host **and** same port: the `Host` header, the public tunnel URL, the `--public-url` you configured, or `X-Forwarded-Host` when it comes from a loopback reverse proxy (the DevTunnel host process). A `Host` without a port (or with the scheme's default port) matches the default port only; a page on another port of the same host is rejected, because cookies are shared across ports.
- Blocked requests are logged with the origin and `Host` that were seen, plus how to fix a reverse-proxy setup (see [Behind Your Own Reverse Proxy](../configuration/#behind-your-own-reverse-proxy)).
- WebSocket handshakes from any other origin are closed with code `1008`; state-changing API requests (`POST`/`PUT`/`PATCH`/`DELETE`) from another origin get `403`.
- Requests a browser marks as `Sec-Fetch-Site: same-site` or `cross-site` are refused for every `/api/*` call and WebSocket.

<!-- prettier-ignore -->
:::note[Why SameSite cookies are not enough behind Dev Tunnels]
`devtunnels.ms` is not on the Public Suffix List, so every tunnel is "same-site" with every other tunnel and `SameSite=Strict` cookies are still sent to cross-tunnel requests. The relay also rewrites `Host` to `localhost`, which used to satisfy the old "one side is localhost" origin rule. Strict origin matching closes that gap: a page served from someone else's tunnel cannot open an authenticated socket to yours.
:::

### Rate Limiting

- Login endpoint limited to **5 attempts per minute** per IP
- WebSocket auth limited to **5 attempts per minute** per IP
- Passkey endpoints limited to **30 requests per minute** per IP (signatures cannot be brute-forced; this bounds CPU use)
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

### Tunnel Reliability

The tunnel watchdog runs entirely asynchronously (it never blocks terminal I/O) and recovers from:

- **Host process crash / relay drop** — `devtunnel host` is restarted with backoff.
- **Laptop sleep** — a wake detector notices the system resumed and checks the tunnel immediately instead of waiting for missed health checks.
- **Network loss** — restarts pause until DNS for the tunnel service resolves again.
- **Host login expiry** — TermBeam enters **auth-wait mode** until you run `devtunnel user login` on the host, then reconnects automatically.
- **Tunnel expired or deleted** — Dev Tunnels expire after a period of inactivity (1 day for the default ephemeral tunnel, 30 days for `--persisted-tunnel`), which a long sleep can exceed. TermBeam first tries to extend the tunnel in place; if it is gone, it creates a replacement with the same settings, prints the **new URL and QR code** in the terminal, and tells connected LAN/localhost clients. Healthy tunnels have their expiration pushed out periodically.

In the browser, the connection status pill distinguishes _offline_, _your computer is unreachable_, _Dev Tunnel sign-in expired_ (the relay's own Microsoft/GitHub login — a full-page **Sign in again** fixes it), and _TermBeam session expired_ (unlock in place with a passkey or password, without losing open terminals). Input is never queued while disconnected.

## Best Practices

<!-- prettier-ignore -->
:::danger[Never Run Without a Password on a Public Network]
Without authentication, anyone on the network can access your terminal with your user permissions.
:::

1. **Password is on by default** — use `--no-password` only for trusted localhost scenarios. `--public` requires password authentication and will refuse to start without it
2. **Localhost is the default** — use `--lan` only when you need LAN access
3. **Tunnel access is private by default** — only you (the tunnel owner) can access it via Microsoft login. Use `--public` to allow public access, or `--no-tunnel` for LAN-only mode
4. **Close TermBeam when done** — it's not a daemon, don't leave it running
5. **Use on trusted networks** — TermBeam is not designed for hostile environments

## Reporting Vulnerabilities

**Please do NOT open a public GitHub issue for security vulnerabilities.** Instead, report vulnerabilities privately via the [Security Advisories](https://github.com/dorlugasigal/TermBeam/security/advisories) page — click "Report a vulnerability" and provide a detailed description.

---

## See Also

- **[Configuration](../configuration/)** — CLI flags, environment variables, and defaults
- **[Getting Started](../getting-started/)** — install and run TermBeam in under a minute
