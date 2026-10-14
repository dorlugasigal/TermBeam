import type { LinkKind } from '@/stores/connectionStore';

export interface StateCopy {
  pill: string;
  title: string;
  body: string;
  tone: 'ok' | 'busy' | 'warn' | 'err' | 'lock';
}

export function hostLabel(): string {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return 'this computer';
  if (h.endsWith('.devtunnels.ms')) return 'your computer (secure tunnel)';
  return h;
}

export function describeLink(
  kind: LinkKind,
  ctx: { rttMs: number | null; attempt: number; secondsLeft: number | null; phase: string | null },
): StateCopy {
  switch (kind) {
    case 'connecting':
      return {
        pill: 'Linking',
        title: 'Connecting to your computer…',
        body: 'Opening a live link to your terminal.',
        tone: 'busy',
      };
    case 'online':
      return {
        pill: ctx.rttMs !== null ? `${ctx.rttMs} ms` : 'Live',
        title: 'Connected',
        body: `Live link to ${hostLabel()}.`,
        tone: 'ok',
      };
    case 'reconnecting':
      return {
        pill: ctx.secondsLeft ? `Retry · ${ctx.secondsLeft}s` : 'Retrying',
        title: 'Reconnecting',
        body: `Link interrupted${ctx.attempt > 1 ? ` — attempt ${ctx.attempt}` : ''}. Your shells keep running.`,
        tone: 'warn',
      };
    case 'offline':
      return {
        pill: 'Offline',
        title: 'This device is offline',
        body: 'Waiting for Wi‑Fi or cellular. TermBeam reconnects on its own.',
        tone: 'err',
      };
    case 'host-unreachable':
      return {
        pill: 'Host offline',
        title: "Can't reach your computer",
        body: 'It may be asleep, offline, or its tunnel is restarting. Retrying automatically.',
        tone: 'err',
      };
    case 'tunnel-auth':
      return {
        pill: 'Sign in',
        title: 'Tunnel sign-in expired',
        body: 'Dev Tunnels needs you to sign in again with the account that owns this tunnel.',
        tone: 'lock',
      };
    case 'auth-expired':
      return {
        pill: 'Locked',
        title: 'Unlock TermBeam',
        body: 'Your session expired. Your terminals are still running.',
        tone: 'lock',
      };
    case 'updating':
      return {
        pill: 'Updating',
        title: 'Updating TermBeam',
        body: `${ctx.phase || 'Installing the new version'}. Tabs re-attach automatically after restart.`,
        tone: 'busy',
      };
  }
}
