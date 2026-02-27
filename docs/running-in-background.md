# Running in Background

TermBeam is designed as a lightweight, on-demand tool — start it when you need terminal access, stop it when you're done. But if you want it **always available** (e.g., on a home server or dev machine), here's how to keep it running reliably using standard process managers.

## Quick & Simple

### Using `nohup` (Linux/macOS) 🐧🍎

The simplest way to keep TermBeam running after you close your terminal:

```bash
nohup termbeam --generate-password > ~/.termbeam.log 2>&1 &
echo $! > ~/.termbeam.pid
```

To stop it:

```bash
kill $(cat ~/.termbeam.pid)
```

!!! warning
    `nohup` won't restart TermBeam if it crashes. For production use, prefer PM2 or a system service.

## PM2 (Recommended) 🚀

[PM2](https://pm2.keymetrics.io/) is the most popular Node.js process manager. It handles restarts, logging, and monitoring out of the box.

### Setup

```bash
# Install PM2 globally
npm install -g pm2

# Start TermBeam
pm2 start termbeam -- --generate-password

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
    <string>/tmp/termbeam.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/termbeam.err</string>
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
      - Arguments: `C:\Users\you\AppData\Roaming\npm\node_modules\termbeam\bin\termbeam.js --generate-password`
5. **Settings**: Check "Restart on failure", set retry to 1 minute

!!! tip
    On Windows, [NSSM](https://nssm.cc/) (Non-Sucking Service Manager) is a great alternative for running Node.js apps as proper Windows services:
    ```powershell
    nssm install TermBeam node "C:\path\to\termbeam\bin\termbeam.js" --generate-password
    nssm start TermBeam
    ```

## Tips

!!! info "Password Management"
    When running as a background service, use `--password` or the `TERMBEAM_PASSWORD` environment variable instead of `--generate-password`, since you won't see the generated password in the console output.

!!! info "Pairing with DevTunnel"
    If you use `--tunnel` with a background service, consider the persistent tunnel feature (when available) so your tunnel URL stays the same across restarts.

!!! tip "Which method should I use?"
    - **Quick test?** → `nohup`
    - **Dev machine?** → PM2 (easiest setup, great logs)
    - **Server/always-on?** → systemd or launchd (OS-native, starts on boot)
    - **Windows?** → Task Scheduler or NSSM
