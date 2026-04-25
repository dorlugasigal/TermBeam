---
title: Troubleshooting
description: Solutions to common TermBeam issues — connection problems, tunnel errors, authentication, and more.
---

# Troubleshooting

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

WebSocket connections can drop due to network instability, especially on mobile networks.

- **Mobile data:** cellular connections are inherently less stable — try Wi-Fi if possible
- **Tunnel timeout:** ephemeral tunnels may drop after periods of inactivity
- **Persisted tunnels:** use `--persisted-tunnel` for more stable, long-lived connections

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
- Persisted tunnel IDs are saved to `~/.termbeam/tunnel.json` and expire after 30 days

:::caution
If a persisted tunnel stops working after ~30 days, delete `~/.termbeam/tunnel.json` and restart TermBeam to create a fresh tunnel.
:::

### Tunnel died overnight / after sleep

If TermBeam is running as a long-lived service (`termbeam service`) and the tunnel stops working after a network interruption (laptop sleep, Wi-Fi drop, DHCP renewal, ISP DNS blip, etc.), the watchdog automatically enters a **network-wait** state once transient DNS / connectivity errors are detected. It probes the DevTunnel host every 60 seconds and reconnects as soon as the network is reachable again — no manual restart required.

You'll see `[WARN] Tunnel paused — waiting for network connectivity` in the logs followed by `[INFO] Network connectivity restored — resuming tunnel` when it recovers. If the logs instead show repeated `Tunnel restart returned no URL` with no final giveup, the watchdog is still cycling through its 10 restart attempts; wait a few minutes for it to settle into network-wait.

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

- **Browser clients:** visit `/login` first to get an auth cookie (httpOnly, 24h expiry)
- **API clients:** use the `Authorization: Bearer <password>` header instead of cookies
- **Expired session:** cookies expire after 24 hours — re-login to get a fresh cookie

```bash
# Example API request with Bearer auth
curl -H "Authorization: Bearer YOUR_PASSWORD" http://localhost:3456/api/sessions
```

---

## Installation Issues

### node-pty build errors

`node-pty` requires native compilation tools. Install the prerequisites for your platform:

- **macOS:** `xcode-select --install`
- **Ubuntu / Debian:** `sudo apt install build-essential python3`
- **Fedora / RHEL:** `sudo dnf groupinstall "Development Tools"`
- **Alpine (Docker):** `apk add build-base python3`
- **Windows (Admin PowerShell):** `npm install --global windows-build-tools`

Ensure your Node.js version is 20 or higher — older versions are not supported.

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
