---
title: Troubleshooting
description: Solutions to common TermBeam issues — connection problems, tunnel errors, authentication, and more.
---

Common issues and how to fix them. If your problem isn't listed here, see [Still Need Help?](#still-need-help) at the bottom.

---

## Connection Issues

### "Connection refused" when opening the URL

This usually means the server isn't running or you're hitting the wrong address.

- Verify the server is running: `curl http://localhost:3456`
- Check you're using the correct port (default is `3456`, or whatever `--port` you set)
- If using the default `--host 127.0.0.1`, only `localhost` connections work — you can't open it from another device

:::tip[Need LAN access?]
Use `termbeam --lan` or `termbeam --host 0.0.0.0` to bind to all interfaces so other devices on your network can connect.
:::

### WebSocket disconnects or "WebSocket error"

WebSocket connections can drop due to network instability, especially on mobile networks. TermBeam reconnects on its own and the connection pill in the top bar tells you what it is waiting for — tap it for details:

| Pill           | Meaning                                                       | What to do                                |
| -------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `42 ms`        | Live — the number is the round-trip time                      | —                                         |
| `Retry · 3s`   | The link dropped; reconnecting with backoff                   | Wait, or tap **Retry now**                |
| `Offline`      | Your phone has no network                                     | Reconnects automatically when it's back   |
| `Host offline` | Your computer is asleep, offline, or its tunnel is restarting | Wake the computer; TermBeam keeps probing |
| `Sign in`      | The Dev Tunnel's own Microsoft/GitHub sign-in expired         | Tap **Sign in again** (full-page sign-in) |
| `Locked`       | Your TermBeam session expired or was signed out               | Unlock with your passkey or password      |

- **Mobile data:** cellular connections are inherently less stable — try Wi-Fi if possible
- **Persisted tunnels:** use `--persisted-tunnel` for a stable URL (and passkeys that keep working) across restarts
- While disconnected, typing shows **Input paused** — keystrokes are never queued and replayed later

:::tip
If you're frequently disconnecting over a tunnel, switch to `--persisted-tunnel` for a connection that survives brief network interruptions.
:::

### Can't connect from another device on LAN

By default, TermBeam binds to `127.0.0.1` (localhost only) for security.

- Use `termbeam --lan` or `termbeam --host 0.0.0.0` to listen on all interfaces
- Ensure your firewall allows incoming connections on the port (default `3456`)
- Verify both devices are on the same network

```bash
# Start with LAN access on the default port
termbeam --lan

# Or specify a custom port
termbeam --lan --port 8080
```

---

## Tunnel Issues

### "devtunnel CLI not found"

TermBeam uses Microsoft DevTunnels for remote access. If the CLI isn't installed, TermBeam will offer to install it automatically.

To install manually:

- **macOS:** `brew install --cask devtunnel`
- **Windows:** `winget install Microsoft.devtunnel`
- **Linux:** `curl -sL https://aka.ms/DevTunnelCliInstall | bash`

After installing, authenticate:

```bash
devtunnel user login
```

### Tunnel URL not working / times out

- Check your DevTunnel login status: `devtunnel user show`
- **Ephemeral tunnels** (the default) are deleted when TermBeam shuts down — the URL won't work after a restart
- Use `--persisted-tunnel` for a stable URL that survives restarts
- Persisted tunnel IDs are saved to `~/.termbeam/tunnel.json`; Dev Tunnels expire after 30 days **without use**, and TermBeam extends the expiration while it is running

:::note
If a tunnel expired anyway (for example, the computer was off for longer than the expiration), TermBeam re-creates it automatically, prints the **new URL and QR code** in its terminal, and saves the new id — no need to delete `tunnel.json`.
:::

### Tunnel died overnight / after sleep

The tunnel watchdog recovers from these automatically — no manual restart required:

- **Sleep / wake:** when the computer resumes, TermBeam notices the gap (`System resumed after ~Nm — checking tunnel`) and verifies the tunnel immediately, restarting `devtunnel host` if the relay connection did not survive.
- **Network interruptions** (Wi-Fi drop, DHCP renewal, ISP DNS blip): the watchdog enters a **network-wait** state (`Tunnel paused — waiting for network connectivity`), probes the tunnel service every 30 seconds and resumes as soon as it's reachable (`Network connectivity restored — resuming tunnel`).
- **Tunnel expired while asleep:** Dev Tunnels expire after a period without use (1 day for the default ephemeral tunnel). TermBeam first tries to extend it; if it is gone it creates a replacement and prints `Tunnel was re-created — new public URL: …` with a fresh QR code. Devices must use the new URL (and register a new passkey for it).
- **Host login expired:** the watchdog pauses and asks you to run `devtunnel user login` on the computer, then reconnects by itself.

On the phone, the connection pill shows `Host offline` while the computer is unreachable and switches back to a live latency readout when the tunnel returns.

### macOS: tunnel paused after a brew upgrade ("DevTunnel auth restored" loop)

On macOS, `brew install --cask devtunnel` (and every subsequent upgrade) tags the binary with the `com.apple.quarantine` extended attribute. The first time TermBeam spawns the new binary from a non-interactive context (e.g. a `pm2`-managed service), Gatekeeper holds the spawn and pops a system dialog — until you click **Open** on the host machine, the auth probe reads as a failure and the watchdog logs:

```text
[INFO] DevTunnel auth restored — resuming tunnel
```

…right after you dismiss the dialog (the misleading message is because the spawn failure looks like an auth failure to the watchdog).

TermBeam **automatically strips the quarantine attribute** on every startup and re-strips it as a self-heal step inside the auth probe, so this should not recur. If you still see the dialog, run:

```bash
xattr -dr com.apple.quarantine "$(brew --prefix)/Caskroom/devtunnel"
spctl --assess --verbose "$(readlink -f "$(which devtunnel)")"
```

:::tip
This is harmless — the binary is still signed by Microsoft (`TeamIdentifier=UBF8T346G9`). Stripping `com.apple.quarantine` only removes the "downloaded from the internet" tag that triggers the Gatekeeper dialog.
:::

---

## Authentication Issues

### Password not accepted

TermBeam auto-generates a new password each time the server starts.

- Check the terminal output where you ran `termbeam` — the password is printed there
- If using `--password`, ensure there are no extra spaces or surrounding quotes
- **Rate limiting:** after 5 failed attempts per minute per IP, you'll be temporarily locked out — wait and retry
- **QR code tokens:** the QR code contains a single-use share token that expires after 5 minutes — rescan if it's expired

:::tip
The easiest way to connect is to scan the QR code from the terminal output. It includes the URL and a one-time auth token.
:::

### "Unauthorized" on API requests

TermBeam uses cookie-based authentication by default.

- **Browser clients:** sign in at `/login` to get an auth cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS). Remembered devices last 7 days without use and 30 days at most; without “Remember this device” the session lasts 2 hours idle / 12 hours at most and is never written to disk
- **API clients:** use the `Authorization: Bearer <password>` header instead of cookies
- **Expired or revoked session:** the app shows **Locked** and an unlock sheet — unlock with a passkey or the password; open terminals are kept

```bash
# Example API request with Bearer auth
curl -H "Authorization: Bearer YOUR_PASSWORD" http://localhost:3456/api/sessions
```

### Passkey option missing

Passkeys need a secure address and a registered passkey for that exact host:

- Open TermBeam through its **HTTPS tunnel URL** or `http://localhost` — plain-HTTP LAN addresses (e.g. `http://192.168.1.5:3456`) can only use the password
- After signing in with the password or QR code, accept **Add passkey** (or use Settings → Security → **Add a passkey for this device**)
- Passkeys are tied to the host name: an ephemeral tunnel gets a new URL on every start, so use `--persisted-tunnel` if you want passkeys to keep working across restarts

### "TermBeam doesn't recognise this address" when signing in

TermBeam refused the request because the page's address doesn't match any address it knows it is served at — almost always a reverse proxy that rewrites the `Host` header (nginx does by default). The TermBeam log names the origin and `Host` it saw. Forward the original `Host` header (nginx: `proxy_set_header Host $host;`), send `X-Forwarded-Host`, or start TermBeam with `--public-url https://your.address` — see [Behind Your Own Reverse Proxy](../configuration/#behind-your-own-reverse-proxy).

### Signed out after restarting TermBeam

Remembered devices survive restarts only when the password stays the same. The default auto-generated password changes on every start, which signs everyone out (passkeys keep working). Set a fixed password with `--password` / `TERMBEAM_PASSWORD` (the background service does this for you) to stay signed in across restarts.

---

## Installation Issues

### node-pty build errors

`node-pty` requires native compilation tools. Install the prerequisites for your platform:

- **macOS:** `xcode-select --install`
- **Ubuntu / Debian:** `sudo apt install build-essential python3`
- **Fedora / RHEL:** `sudo dnf groupinstall "Development Tools"`
- **Alpine (Docker):** `apk add build-base python3`
- **Windows (Admin PowerShell):** `npm install --global windows-build-tools`

Ensure your Node.js version is 22 or higher — older versions (including Node 20, EOL 2026-04-30) are not supported.

### "Port already in use"

Another process (possibly a previous TermBeam instance) is using the port.

- **Force restart:** use `termbeam --force` to stop the existing server and start a new one
- **Different port:** use `termbeam --port 8080` to pick an open port
- **Find what's using the port:** `lsof -i :3456` (macOS/Linux) or `netstat -ano | findstr 3456` (Windows)

---

## Terminal Issues

### Shell not found or wrong shell

TermBeam auto-detects your shell from the parent process. If it picks the wrong one:

- Override explicitly: `termbeam /bin/bash` or `termbeam /usr/bin/fish`
- Only shells detected by the system are allowed (for security)
- As a fallback, set the `SHELL` environment variable (Unix) or `COMSPEC` (Windows)

```bash
# Start with a specific shell
termbeam /bin/zsh

# Or set the environment variable
SHELL=/usr/bin/fish termbeam
```

### Terminal rendering issues on mobile

Mobile screens are small, but TermBeam is designed for them.

- Use the **command palette** to adjust font size (Increase / Decrease)
- **Pinch-to-zoom** for fine control on touch screens
- **Landscape mode** gives you a wider terminal — try rotating your device
- Some complex TUI apps (like `htop` or `vim`) may not render perfectly on very narrow screens

---

## Service Issues

### PM2 service won't start

TermBeam can run as a background service via PM2.

- Check PM2 is installed: `npm install -g pm2`
- View logs: `termbeam service logs`
- Check status: `termbeam service status`
- Reinstall if stuck:

```bash
termbeam service uninstall && termbeam service install
```

:::tip
If PM2 processes are in an error state, `pm2 kill` will reset everything. Then reinstall with `termbeam service install`.
:::

---

## Still Need Help?

If your issue isn't listed here, please [open an issue on GitHub](https://github.com/dorlugasigal/TermBeam/issues) with:

- Your **OS** and **Node.js version** (`node --version`)
- The **full command** you ran
- Any **error messages** from the terminal

---

## See Also

- **[Configuration](../configuration/)** — every CLI flag and env var
- **[Security](../security/)** — auth, headers, tunnels
- **[Resume & List](../resume/)** — reconnect to active sessions if the browser tab dies
- **[Contributing](../contributing/)** — how to file an issue with useful detail
