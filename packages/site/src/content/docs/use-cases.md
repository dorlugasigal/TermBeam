---
title: Use Cases
description: >-
  Practical scenarios for TermBeam — server management from your phone, pair
  programming, teaching, on-call incident response, and IoT device access.
---

# Use Cases

TermBeam is built for situations where you need terminal access fast, from any device, without installing anything on the client side. Here are the most common scenarios.

---

## Remote Server Management

Access your server terminal from your phone while commuting, traveling, or away from your desk.

Start TermBeam on the server, scan the QR code with your phone, and you're in — no SSH client needed. The touch keyboard bar gives you quick access to arrow keys, Ctrl, Tab, and other keys that are awkward to type on a phone keyboard.

```bash
termbeam --port 3000
```

:::tip
:::
Use `termbeam service install` to run TermBeam as a background service so it's always available when you need it. See [Running in Background](/running-in-background/) for details.

---

## Pair Programming

Share a terminal session with a colleague via QR code or URL — no screen-sharing software required.

Start TermBeam with `--lan` to make it accessible on your local network, or use the default tunnel for internet access. Your colleague opens the link, authenticates with the shared password, and you're both looking at the same terminal. Multiple people can attach to the same session simultaneously.

**Local network:**

```bash
termbeam --lan
```

**Over the internet (via built-in tunnel):**

```bash
termbeam
```

:::tip
:::
All connected clients see the same output in real time. Input from any client is sent to the same PTY, so coordinate who's typing — or use separate sessions via tabs.

---

## Teaching & Workshops

Let students connect to an instructor's terminal from their own devices — laptops, tablets, or phones.

The instructor starts TermBeam with a known password and shares the QR code on a projector or via chat. Students scan it and watch the terminal live. This is useful for live coding demos, command-line workshops, and debugging walkthroughs where screen-sharing introduces lag or resolution issues.

```bash
termbeam --password workshop2025
```

:::caution
:::
When sharing with a group, everyone who has the password can send input to the terminal. For read-only demos, ask participants not to type — there's no built-in read-only mode yet.

---

## DevOps On-Call

Respond to incidents from your mobile device — check logs, restart services, and run diagnostics without opening a laptop.

TermBeam's tunnel support means you can reach your terminal from anywhere, even on cellular data. Combined with `termbeam service`, you can have a persistent TermBeam instance ready on your jump host or bastion server, waiting for when you need it.

```bash
termbeam service install --password "$ONCALL_PASSWORD" --port 4000
```

:::tip
:::
Pair TermBeam with a process manager like PM2 or systemd so the service restarts automatically if the host reboots. See [Running in Background](/running-in-background/).

---

## IoT & Raspberry Pi

Access headless devices from any browser — no monitor, keyboard, or SSH client required.

Install Node.js on your Raspberry Pi (or similar device), run `npx termbeam --lan`, and connect from your phone or laptop on the same network. This is especially useful during initial setup when you haven't configured SSH keys or don't have a spare monitor.

```bash
npx termbeam --lan --port 3000
```

:::tip
:::
For devices behind NAT or on a different network, omit `--lan` to use the built-in tunnel and access the device over the internet.
