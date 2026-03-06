# Running in Background

TermBeam is designed as a lightweight, on-demand tool — start it when you need terminal access, stop it when you're done. But if you want it **always available** (e.g., on a home server or dev machine), here's how to keep it running reliably using standard process managers.

<!-- prettier-ignore -->
!!! warning "Avoid passwords in command arguments"
    Command-line arguments are visible to all local users via `ps aux`. Prefer the `TERMBEAM_PASSWORD` environment variable over `--password` for background services. The systemd and launchd examples below use the environment variable for this reason.

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
!!! warning
    `nohup` won't restart TermBeam if it crashes. For production use, prefer PM2 or a system service.

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
!!! tip "Ecosystem config location"
    The wizard saves the PM2 ecosystem file to `~/.termbeam/ecosystem.config.js`. This file contains all the CLI flags and environment variables for your service. You can edit it manually and run `termbeam service restart` to apply changes.

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
!!! warning
    `uninstall` removes the service from PM2 and deletes the ecosystem config at `~/.termbeam/ecosystem.config.js`. If you've customized the config, back it up first.

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
!!! tip
    On Windows, [NSSM](https://nssm.cc/) (Non-Sucking Service Manager) is a great alternative for running Node.js apps as proper Windows services:

    ```powershell
    nssm install TermBeam node "C:\path\to\termbeam\bin\termbeam.js" --no-tunnel --password mysecret
    nssm start TermBeam
    ```

## Tips

<!-- prettier-ignore -->
!!! info "Password Management"
    Since TermBeam auto-generates a password by default, background services **must** use `--password` or the `TERMBEAM_PASSWORD` environment variable to set a known password — otherwise the generated password is lost in the service logs.

<!-- prettier-ignore -->
!!! info "Pairing with DevTunnel"
    If you use `--tunnel` with a background service, consider the persistent tunnel feature (when available) so your tunnel URL stays the same across restarts.

<!-- prettier-ignore -->
!!! info "Node.js Requirement"
    TermBeam requires Node.js 18 or higher. Verify with `node --version` before setting up a background service.

<!-- prettier-ignore -->
!!! tip "Which method should I use?"
    - **Quick test?** → `nohup`
    - **Dev machine?** → PM2 (easiest setup, great logs)
    - **Server/always-on?** → systemd or launchd (OS-native, starts on boot)
    - **Windows?** → Task Scheduler or NSSM

---

## See Also

- **[Configuration](configuration.md)** — CLI flags, environment variables, and defaults
- **[Resume & List](resume.md)** — reconnect to running sessions from your terminal
