---
title: Running In Background
description: Run TermBeam as a long-lived service with PM2, systemd, launchd, nohup, or Windows Task Scheduler.
---

TermBeam is designed as a lightweight, on-demand tool — start it when you need terminal access, stop it when you're done. But if you want it **always available** (e.g., on a home server or dev machine), here's how to keep it running reliably using standard process managers.

<!-- prettier-ignore -->
:::caution[Avoid passwords in command arguments]
Command-line arguments are visible to all local users via `ps aux`. Prefer the `TERMBEAM_PASSWORD` environment variable over `--password` for background services. The systemd and launchd examples below use the environment variable for this reason.
:::

## Quick & Simple

### Using `nohup` (Linux/macOS) 🐧🍎

The simplest way to keep TermBeam running after you close your terminal:

```bash
nohup termbeam --no-tunnel --password mysecret > ~/.termbeam.log 2>&1 &
echo $! > ~/.termbeam.pid
```

To stop it:

```bash
kill $(cat ~/.termbeam.pid)
```

<!-- prettier-ignore -->
:::caution
`nohup` won't restart TermBeam if it crashes. For production use, prefer PM2 or a system service.
:::

## PM2 (Recommended) 🚀

[PM2](https://pm2.keymetrics.io/) is the most popular Node.js process manager. It handles restarts, logging, and monitoring out of the box.

### Interactive Setup (Easiest)

TermBeam includes a built-in interactive installer that configures PM2 for you:

```bash
termbeam service install
```

The wizard checks if PM2 is installed (and offers to install it globally if not), then walks you through 8 configuration steps:

| Step                     | Question                   | Options / Default                                                 |
| ------------------------ | -------------------------- | ----------------------------------------------------------------- |
| 1. **Service name**      | Name for the PM2 process   | Default: `termbeam`                                               |
| 2. **Password**          | How to protect the service | Auto-generate (recommended), enter custom, or no password         |
| 3. **Port**              | Server port                | Default: `3456`                                                   |
| 4. **Access mode**       | How to reach the service   | DevTunnel (from anywhere), LAN (local network), or Localhost only |
| 5. **Working directory** | Default terminal directory | Default: current directory                                        |
| 6. **Log level**         | Logging verbosity          | `info` (default), `debug`, `warn`, or `error`                     |
| 7. **Boot auto-start**   | Start on system boot?      | Default: Yes — runs `pm2 startup`                                 |
| 8. **Confirm**           | Review and proceed         | Proceed or cancel                                                 |

If you choose **DevTunnel** access, a follow-up question asks whether the tunnel should be **private** (Microsoft login required) or **public** (anyone with the link). Choosing public with no password will auto-generate one for safety.

After confirming, the wizard generates an ecosystem config file, starts the PM2 process, and saves the process list.

<!-- prettier-ignore -->
:::tip[Ecosystem config location]
The wizard saves the PM2 ecosystem file to `~/.termbeam/ecosystem.config.js`. This file contains all the CLI flags and environment variables for your service. You can edit it manually and run `termbeam service restart` to apply changes.
:::

### Service Subcommands

After installation, manage the service with these subcommands:

#### `termbeam service status`

Shows detailed PM2 process information (equivalent to `pm2 describe <name>`), including uptime, restarts, memory usage, and log file paths.

```bash
termbeam service status
```

#### `termbeam service logs`

Tails the PM2 log output, showing the last 200 lines and streaming new output in real time. Press `Ctrl+C` to stop.

```bash
termbeam service logs
```

#### `termbeam service restart`

Restarts the PM2 process. Useful after editing the ecosystem config file or updating TermBeam.

```bash
termbeam service restart
```

#### `termbeam service uninstall`

Stops the PM2 process, removes it from PM2, and deletes the ecosystem config file. Prompts for confirmation before proceeding.

```bash
termbeam service uninstall
```

<!-- prettier-ignore -->
:::caution
`uninstall` removes the service from PM2 and deletes the ecosystem config at `~/.termbeam/ecosystem.config.js`. If you've customized the config, back it up first.
:::

### Manual Setup

```bash
# Install PM2 globally
npm install -g pm2

# Start TermBeam
pm2 start termbeam -- --no-tunnel --password mysecret

# Or with specific options
pm2 start termbeam -- --port 8080 --password mysecret --tunnel
```

### Useful Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs termbeam

# Restart
pm2 restart termbeam

# Stop
pm2 stop termbeam

# Remove from PM2
pm2 delete termbeam
```

### Start on Boot

```bash
# Generate startup script (run the command it outputs)
pm2 startup

# Save current process list
pm2 save
```

This ensures TermBeam starts automatically after a system reboot. 🎉

## System Services

### systemd (Linux) 🐧

Create a service file at `/etc/systemd/system/termbeam.service`:

```ini
[Unit]
Description=TermBeam - Web Terminal
After=network.target

[Service]
Type=simple
User=your-username
Environment=TERMBEAM_PASSWORD=your-secret
ExecStart=/usr/bin/env termbeam --host 0.0.0.0
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable termbeam
sudo systemctl start termbeam

# Check status
sudo systemctl status termbeam

# View logs
journalctl -u termbeam -f
```

### launchd (macOS) 🍎

Create a plist at `~/Library/LaunchAgents/com.termbeam.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.termbeam</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/termbeam</string>
        <string>--host</string>
        <string>0.0.0.0</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>TERMBEAM_PASSWORD</key>
        <string>your-secret</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/you/Library/Logs/termbeam.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/you/Library/Logs/termbeam.err</string>
</dict>
</plist>
```

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.termbeam.plist

# To stop
launchctl unload ~/Library/LaunchAgents/com.termbeam.plist
```

### Windows Task Scheduler 🪟

1. Open **Task Scheduler** → **Create Task**
2. **General**: Name it "TermBeam", check "Run whether user is logged on or not"
3. **Triggers**: "At startup" (or "At log on" for user-level)
4. **Actions**: Start a program
   - Program: `node`
   - Arguments: `C:\Users\you\AppData\Roaming\npm\node_modules\termbeam\bin\termbeam.js --no-tunnel --password mysecret`
5. **Settings**: Check "Restart on failure", set retry to 1 minute

<!-- prettier-ignore -->
:::tip
On Windows, [NSSM](https://nssm.cc/) (Non-Sucking Service Manager) is a great alternative for running Node.js apps as proper Windows services:

```powershell
nssm install TermBeam node "C:\path\to\termbeam\bin\termbeam.js" --no-tunnel --password mysecret
nssm start TermBeam
```

:::

## Keeping the Host Awake 💤

A background service is only useful if the machine stays reachable. If your computer sleeps, the network adapter powers down, or the lid closes, your tunnel and LAN connection drop — even though TermBeam itself is configured to restart.

Pick the lightest-touch option for your OS:

### macOS 🍎

**Recommended: Amphetamine (free, App Store)** — pair it with a **process trigger** so your Mac only stays awake while TermBeam is actually running.

1. Install [Amphetamine](https://apps.apple.com/app/amphetamine/id937984704) → enable **Triggers** in Preferences.
2. Add trigger: **"While a specific process is running"** → select `node` (or the full path to your `termbeam` binary — find it with `which termbeam`).
3. In the trigger's session options:
   - ✅ **Allow display sleep** (saves power; the screen doesn't need to be on)
   - ❌ **Allow system sleep when display is closed** — keep this **off** for MacBooks (clamshell-mode safe)
   - ✅ **Prevent system sleep when on battery** (only if you need it unplugged)

**Alternative: built-in `caffeinate`** — no app needed. Bake it straight into your launchd plist or PM2 ecosystem config:

```bash
# Wrap termbeam so the system stays awake only while termbeam runs
caffeinate -dims termbeam --tunnel --persisted-tunnel
```

For the **launchd** example above, replace the `ProgramArguments` with `caffeinate -dims /usr/local/bin/termbeam ...`. Flags: `-d` display, `-i` idle, `-m` disk, `-s` system (AC only).

**TCP keepalive across brief sleeps** — recommended for tunnel stability:

```bash
sudo pmset -a tcpkeepalive 1
pmset -g | grep -E 'sleep|womp|tcpkeepalive'   # verify
```

### Windows 🪟

**Recommended: PowerToys Awake (free, Microsoft)** — official, integrates cleanly with the system tray, no third-party trust required.

1. Install [PowerToys](https://learn.microsoft.com/windows/powertoys/) → enable the **Awake** module.
2. Set mode to **Keep awake indefinitely** with **Keep screen on: off**.
3. Optionally configure Awake to launch at startup so it pairs with your Task Scheduler / NSSM service.

**Also disable network adapter power saving** (otherwise Wi-Fi sleeps even when the system doesn't):

- Device Manager → Network adapters → your adapter → Properties → **Power Management** → uncheck **"Allow the computer to turn off this device to save power"**.
- Settings → System → Power → Screen and sleep → **"When plugged in, put my device to sleep after"** → **Never**.

**Alternative: built-in power plan only** — Control Panel → Power Options → choose **High performance** → set sleep to "Never" on AC. No extra software.

### Linux 🐧

For a dedicated server, mask the sleep targets entirely:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

For laptops where you only want to inhibit sleep while TermBeam is running, use `systemd-inhibit` in your unit file's `ExecStart`:

```ini
ExecStart=/usr/bin/systemd-inhibit --what=sleep:idle --why="TermBeam is running" /usr/bin/env termbeam --host 0.0.0.0
```

For lid-close behavior, edit `/etc/systemd/logind.conf`:

```ini
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
```

Then `sudo systemctl restart systemd-logind`.

<!-- prettier-ignore -->
:::tip[Why not just disable sleep globally?]
Process-scoped tools (Amphetamine triggers, `caffeinate`-wrapped service, `systemd-inhibit`) only keep the system awake while TermBeam is actually running. If you uninstall the service or stop it, the machine sleeps normally — no leftover battery drain.
:::

## Tips

<!-- prettier-ignore -->
:::tip[Password Management]
Since TermBeam auto-generates a password by default, background services **must** use `--password` or the `TERMBEAM_PASSWORD` environment variable to set a known password — otherwise the generated password is lost in the service logs.
:::

<!-- prettier-ignore -->
:::tip[Pairing with DevTunnel]
If you use `--tunnel` with a background service, pass `--persisted-tunnel` so the same tunnel URL is reused across restarts. Without it, every restart produces a new public URL.
:::

<!-- prettier-ignore -->
:::tip[Node.js Requirement]
TermBeam requires Node.js 20 or higher. Verify with `node --version` before setting up a background service.
:::

<!-- prettier-ignore -->
:::tip[Which method should I use?]

- **Quick test?** → `nohup`
- **Dev machine?** → PM2 (easiest setup, great logs)
- **Server/always-on?** → systemd or launchd (OS-native, starts on boot)
- **Windows?** → Task Scheduler or NSSM
  :::

---

## See Also

- **[Configuration](../configuration/)** — CLI flags, environment variables, and defaults
- **[Resume & List](../resume/)** — reconnect to running sessions from your terminal
