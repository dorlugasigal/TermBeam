// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

vi.mock('@/services/api', () => ({
  probeServer: vi.fn(),
}));

import { probeServer } from '@/services/api';
import { useConnectionStore } from '../connectionStore';

const probe = probeServer as unknown as ReturnType<typeof vi.fn>;

function store() {
  return useConnectionStore.getState();
}

describe('connectionStore', () => {
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    probe.mockReset();
    useConnectionStore.setState({
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
    });
  });

  afterEach(() => {
    unregister?.();
    unregister = null;
    vi.useRealTimers();
  });

  it('goes online on first attach without a restore beat', () => {
    unregister = store().registerSocket();
    store().reportAttached();
    expect(store().kind).toBe('online');
    expect(store().restoredAt).toBeNull();
  });

  it('records a restore beat when the link comes back after a loss', () => {
    unregister = store().registerSocket();
    store().reportAttached();
    store().reportSocketLost();
    expect(store().kind).toBe('reconnecting');
    expect(store().lostAt).not.toBeNull();
    store().reportAttached();
    expect(store().kind).toBe('online');
    expect(store().restoredAt).not.toBeNull();
  });

  it('diagnoses a sustained loss and pauses sockets when the host is unreachable', async () => {
    unregister = store().registerSocket();
    store().reportAttached();
    probe.mockResolvedValue('host-unreachable');
    store().reportSocketLost();
    await vi.advanceTimersByTimeAsync(1600);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(store().kind).toBe('host-unreachable');
    expect(store().canConnect()).toBe(false);
    expect(store().nextRetryAt).not.toBeNull();
  });

  it('resumes sockets (nonce bump) once the probe succeeds again', async () => {
    unregister = store().registerSocket();
    useConnectionStore.setState({ kind: 'host-unreachable' });
    probe.mockResolvedValue('ok');
    const before = store().resumeNonce;
    await store().diagnose();
    expect(store().kind).toBe('reconnecting');
    expect(store().resumeNonce).toBe(before + 1);
    expect(store().canConnect()).toBe(true);
  });

  it('opens the unlock sheet when the session expired', async () => {
    unregister = store().registerSocket();
    probe.mockResolvedValue('auth-expired');
    await store().diagnose();
    expect(store().kind).toBe('auth-expired');
    expect(store().unlockOpen).toBe(true);
    expect(store().canConnect()).toBe(false);
  });

  it('surfaces tunnel sign-in with the sheet open', async () => {
    probe.mockResolvedValue('tunnel-auth');
    await store().diagnose();
    expect(store().kind).toBe('tunnel-auth');
    expect(store().sheetOpen).toBe(true);
  });

  it('ignores socket loss while locked (no reconnect storm)', () => {
    unregister = store().registerSocket();
    store().reportAuthExpired();
    store().reportSocketLost();
    expect(store().kind).toBe('auth-expired');
  });

  it('unlocking resumes paused sockets', () => {
    unregister = store().registerSocket();
    store().reportAuthExpired();
    const before = store().resumeNonce;
    store().unlocked();
    expect(store().unlockOpen).toBe(false);
    expect(store().kind).toBe('reconnecting');
    expect(store().resumeNonce).toBe(before + 1);
  });

  it('treats a restart during an update as updating, not unreachable', async () => {
    unregister = store().registerSocket();
    store().reportAttached();
    store().setUpdating('Restarting with the new version');
    probe.mockResolvedValue('host-unreachable');
    store().reportSocketLost();
    expect(store().kind).toBe('updating');
    await vi.advanceTimersByTimeAsync(1600);
    expect(store().kind).toBe('updating');
  });

  it('pages without sockets go online on HTTP success', () => {
    useConnectionStore.setState({ kind: 'host-unreachable', lostAt: Date.now() });
    store().reportHttpSuccess();
    expect(store().kind).toBe('online');
    expect(store().restoredAt).not.toBeNull();
  });

  it('two failed polls trigger a diagnosis', async () => {
    probe.mockResolvedValue('offline');
    store().reportHttpFailure();
    expect(probe).not.toHaveBeenCalled();
    store().reportHttpFailure();
    await vi.runOnlyPendingTimersAsync();
    expect(probe).toHaveBeenCalled();
    expect(store().kind).toBe('offline');
  });

  it('records RTT', () => {
    store().reportRtt(42.4);
    expect(store().rttMs).toBe(42);
    store().reportRtt(Number.NaN);
    expect(store().rttMs).toBe(42);
  });

  it('openSheet routes to the unlock sheet when locked', () => {
    useConnectionStore.setState({ kind: 'auth-expired' });
    store().openSheet();
    expect(store().unlockOpen).toBe(true);
    expect(store().sheetOpen).toBe(false);
  });
});
