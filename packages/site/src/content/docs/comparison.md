---
title: TermBeam vs the Traditional Way
description: >-
  Why accessing your terminal from a phone usually requires too many steps,
  and how TermBeam simplifies it to one command and a QR code.
---

TermBeam exists because accessing a terminal from your phone is surprisingly painful. There's no real equivalent tool — so instead of a competitor comparison, here's what the experience looks like with and without it.

## Without TermBeam

To get a terminal on your phone today, you'd typically:

1. Install a dedicated SSH client app (Termius, Prompt, JuiceSSH…)
2. Generate SSH keys and transfer them to your phone
3. Configure your server's firewall or set up port forwarding
4. Optionally set up a VPN or tunnel for internet access
5. Manually type your server's IP address on a tiny keyboard
6. Work in a UI designed for desktop monitors — no touch-friendly keys, no tabs, no split view

That's a lot of setup for "I just want to check something on my server."

## With TermBeam

```bash
npx termbeam
```

Scan the QR code with your phone. Done.

You get a full terminal with a touch keyboard bar (Ctrl, Tab, arrows, Esc), multi-session tabs, split view, file upload, 38 themes — all designed for mobile from the ground up.

<!-- prettier-ignore -->
:::tip[No install on the client]
TermBeam runs in any browser. Your phone doesn't need an app, SSH keys, or any configuration. The built-in DevTunnel means it works over the internet automatically — no port forwarding needed.
:::

## When SSH is Still the Right Choice

TermBeam isn't a replacement for SSH. Use SSH when you need:

- **Automated access** — CI/CD pipelines, scripts, cron jobs
- **File transfers** — SCP/SFTP for bulk file operations
- **Long-running production sessions** — pair with tmux or screen
- **Key-based authentication** — environments that require certificate-based auth

<!-- prettier-ignore -->
:::tip[They work great together]
A common setup is SSH (with tmux) for long-running production sessions and TermBeam for quick mobile access when you're away from your desk.
:::

---

## See Also

- **[Getting Started](../getting-started/)** — install and run TermBeam in under a minute
- **[Use Cases](../use-cases/)** — practical workflows TermBeam unlocks
- **[Security](../security/)** — auth, tunnels, and the threat model
