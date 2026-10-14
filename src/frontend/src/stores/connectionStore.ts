import { create } from 'zustand';
import { probeServer, type ProbeResult } from '@/services/api';

/**
 * One authority for "can I reach my terminal right now, and if not, why?".
 *
 * Sockets and pollers REPORT facts (attached, lost, unauthorized, HTTP ok /
 * failed); this store DIAGNOSES (via an un-redirected probe of
 * /api/auth/status) and DECIDES whether sockets may reconnect. The UI
 * (ConnectionPill / ConnectionSheet / UnlockSheet) only renders it.
 *
 * Why a probe: a WebSocket failure carries no reason. Behind a private Dev
 * Tunnel an expired relay sign-in answers with a cross-origin 302 that a
 * normal fetch turns into an opaque CORS error — indistinguishable from
 * "offline" unless we fetch with redirect:'manual'.
 */

export type LinkKind =
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'offline'
  | 'host-unreachable'
  | 'tunnel-auth'
  | 'auth-expired'
  | 'updating';

export interface TunnelStatus {
  state: string;
  url?: string;
  urlChanged?: boolean;
  attempt?: number;
  since?: number;
}

interface ConnectionState {
  kind: LinkKind;
  attempt: number;
  nextRetryAt: number | null;
  rttMs: number | null;
  lostAt: number | null;
  restoredAt: number | null;
  updatingPhase: string | null;
  updatingSince: number | null;
  tunnel: TunnelStatus | null;
  sheetOpen: boolean;
  unlockOpen: boolean;
  /** Bumped to tell paused sockets to reconnect immediately. */
  resumeNonce: number;
  diagnosing: boolean;

  registerSocket: () => () => void;
  canConnect: () => boolean;
  reportAttached: () => void;
  reportSocketLost: () => void;
  reportAuthExpired: () => void;
  reportHttpSuccess: () => void;
  reportHttpFailure: () => void;
  reportRtt: (ms: number) => void;
  setUpdating: (phase: string | null) => void;
  setTunnelStatus: (status: TunnelStatus | null) => void;
  diagnose: () => Promise<ProbeResult | null>;
  retryNow: () => void;
  unlocked: () => void;
  openSheet: () => void;
  closeSheet: () => void;
  openUnlock: () => void;
  closeUnlock: () => void;
}

const BLOCKING: ReadonlySet<LinkKind> = new Set([
  'auth-expired',
  'tunnel-auth',
  'offline',
  'host-unreachable',
]);
const PROBE_BACKOFF_MS = [2000, 4000, 8000, 15000, 20000, 30000];
const UPDATE_GRACE_MS = 90_000;
const LOSS_DIAGNOSE_DELAY_MS = 1500;
const HTTP_FAILURES_BEFORE_DIAGNOSE = 2;

let socketCount = 0;
let httpFailures = 0;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let lossTimer: ReturnType<typeof setTimeout> | null = null;
let probeAttempt = 0;

function clearTimers() {
  if (probeTimer) clearTimeout(probeTimer);
  if (lossTimer) clearTimeout(lossTimer);
  probeTimer = null;
  lossTimer = null;
}

export const useConnectionStore = create<ConnectionState>((set, get) => {
  function goOnline() {
    const s = get();
    clearTimers();
    probeAttempt = 0;
    httpFailures = 0;
    if (s.kind === 'online') return;
    const wasLost = s.lostAt !== null || s.kind !== 'connecting';
    set({
      kind: 'online',
      attempt: 0,
      nextRetryAt: null,
      lostAt: null,
      restoredAt: wasLost ? Date.now() : s.restoredAt,
      updatingPhase: null,
      updatingSince: null,
      unlockOpen: false,
      sheetOpen: s.sheetOpen,
    });
  }

  function scheduleProbe() {
    if (probeTimer) clearTimeout(probeTimer);
    const delay = PROBE_BACKOFF_MS[Math.min(probeAttempt, PROBE_BACKOFF_MS.length - 1)]!;
    probeAttempt++;
    set({ nextRetryAt: Date.now() + delay });
    probeTimer = setTimeout(() => {
      probeTimer = null;
      void get().diagnose();
    }, delay);
  }

  function isUpdating() {
    const s = get();
    return s.updatingSince !== null && Date.now() - s.updatingSince < UPDATE_GRACE_MS;
  }

  return {
    kind: 'connecting',
    attempt: 0,
    nextRetryAt: null,
    rttMs: null,
    lostAt: null,
    restoredAt: null,
    updatingPhase: null,
    updatingSince: null,
    tunnel: null,
    sheetOpen: false,
    unlockOpen: false,
    resumeNonce: 0,
    diagnosing: false,

    registerSocket: () => {
      socketCount++;
      return () => {
        socketCount = Math.max(0, socketCount - 1);
      };
    },

    canConnect: () => !BLOCKING.has(get().kind),

    reportAttached: () => goOnline(),

    reportSocketLost: () => {
      const s = get();
      if (s.kind === 'auth-expired' || s.kind === 'tunnel-auth') return;
      if (s.kind === 'online' || s.kind === 'connecting') {
        set({
          kind: isUpdating() ? 'updating' : 'reconnecting',
          attempt: 1,
          lostAt: Date.now(),
          rttMs: null,
        });
      } else if (s.kind === 'reconnecting') {
        set({ attempt: s.attempt + 1 });
      }
      // Brief drops (mobile app switch) usually heal on their own — only
      // diagnose if we're still not attached shortly after.
      if (!lossTimer) {
        lossTimer = setTimeout(() => {
          lossTimer = null;
          if (get().kind !== 'online') void get().diagnose();
        }, LOSS_DIAGNOSE_DELAY_MS);
      }
    },

    reportAuthExpired: () => {
      clearTimers();
      set((s) => ({
        kind: 'auth-expired',
        lostAt: s.lostAt ?? Date.now(),
        nextRetryAt: null,
        unlockOpen: true,
        sheetOpen: false,
        rttMs: null,
      }));
    },

    reportHttpSuccess: () => {
      httpFailures = 0;
      const s = get();
      if (s.kind === 'online') return;
      if (socketCount === 0) {
        goOnline();
      } else if (BLOCKING.has(s.kind) && s.kind !== 'auth-expired') {
        // The server answers again — let paused sockets retry right away.
        set({ kind: 'reconnecting', resumeNonce: s.resumeNonce + 1, nextRetryAt: null });
      }
    },

    reportHttpFailure: () => {
      httpFailures++;
      if (httpFailures >= HTTP_FAILURES_BEFORE_DIAGNOSE && !get().diagnosing) {
        const s = get();
        if (s.kind === 'online' || s.kind === 'connecting') {
          set({ kind: 'reconnecting', attempt: 1, lostAt: Date.now(), rttMs: null });
        }
        void get().diagnose();
      }
    },

    reportRtt: (ms) => {
      if (Number.isFinite(ms) && ms >= 0) set({ rttMs: Math.round(ms) });
    },

    setUpdating: (phase) => {
      if (phase === null) {
        set({ updatingPhase: null, updatingSince: null });
        return;
      }
      set((s) => ({ updatingPhase: phase, updatingSince: s.updatingSince ?? Date.now() }));
    },

    setTunnelStatus: (status) => set({ tunnel: status }),

    diagnose: async () => {
      if (get().diagnosing) return null;
      set({ diagnosing: true });
      let result: ProbeResult;
      try {
        result = await probeServer();
      } finally {
        set({ diagnosing: false });
      }
      const s = get();
      switch (result) {
        case 'ok':
          probeAttempt = 0;
          if (socketCount === 0) {
            goOnline();
          } else {
            set({
              kind: s.kind === 'online' ? 'online' : isUpdating() ? 'updating' : 'reconnecting',
              resumeNonce: s.resumeNonce + 1,
              nextRetryAt: null,
            });
          }
          break;
        case 'auth-expired':
          get().reportAuthExpired();
          break;
        case 'tunnel-auth':
          clearTimers();
          set({ kind: 'tunnel-auth', nextRetryAt: null, sheetOpen: true, rttMs: null });
          break;
        case 'offline':
          set({ kind: 'offline', rttMs: null });
          // The 'online' event resumes us; keep a slow probe as a backstop.
          scheduleProbe();
          break;
        case 'host-unreachable':
          set({ kind: isUpdating() ? 'updating' : 'host-unreachable', rttMs: null });
          scheduleProbe();
          break;
      }
      return result;
    },

    retryNow: () => {
      clearTimers();
      probeAttempt = 0;
      set((s) => ({ resumeNonce: s.resumeNonce + 1, nextRetryAt: null }));
      void get().diagnose();
    },

    unlocked: () => {
      clearTimers();
      probeAttempt = 0;
      set((s) => ({
        kind: socketCount === 0 ? 'online' : 'reconnecting',
        unlockOpen: false,
        resumeNonce: s.resumeNonce + 1,
        restoredAt: socketCount === 0 ? Date.now() : s.restoredAt,
        lostAt: socketCount === 0 ? null : s.lostAt,
      }));
    },

    openSheet: () => {
      const s = get();
      if (s.kind === 'auth-expired') set({ unlockOpen: true });
      else set({ sheetOpen: true });
    },
    closeSheet: () => set({ sheetOpen: false }),
    openUnlock: () => set({ unlockOpen: true, sheetOpen: false }),
    closeUnlock: () => set({ unlockOpen: false }),
  };
});

// --- Environment signals (installed once) ----------------------------------

let envInstalled = false;
export function installConnectionListeners(): void {
  if (envInstalled || typeof window === 'undefined') return;
  envInstalled = true;
  const store = () => useConnectionStore.getState();

  window.addEventListener('online', () => {
    if (store().kind !== 'online') store().retryNow();
  });
  window.addEventListener('offline', () => {
    useConnectionStore.setState({ kind: 'offline', rttMs: null });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const k = store().kind;
    if (k !== 'online' && k !== 'auth-expired' && k !== 'connecting') store().retryNow();
  });
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted && store().kind !== 'online') store().retryNow();
  });
}
