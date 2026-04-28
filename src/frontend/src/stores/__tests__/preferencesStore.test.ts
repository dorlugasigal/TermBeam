// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  usePreferencesStore,
  PREF_DEFAULTS,
  __resetPreferencesStoreForTests,
} from '../preferencesStore';

beforeEach(() => {
  // Stop debounced PUTs from making real fetch calls.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ prefs: PREF_DEFAULTS, version: 1 }),
      } as unknown as Response),
    ),
  );
  localStorage.clear();
  __resetPreferencesStoreForTests();
});

describe('usePreferencesStore', () => {
  it('seeds defaults when localStorage is empty', () => {
    const { prefs } = usePreferencesStore.getState();
    expect(prefs.themeId).toBe(PREF_DEFAULTS.themeId);
    expect(prefs.fontSize).toBe(PREF_DEFAULTS.fontSize);
    expect(prefs.haptics).toBe(true);
    expect(prefs.touchBarKeys).toBeNull();
    expect(prefs.startupWorkspace).toEqual({ enabled: false, sessions: [] });
  });

  it('clamps fontSize through setPreference', () => {
    const { setPreference } = usePreferencesStore.getState();
    setPreference('fontSize', 999);
    expect(usePreferencesStore.getState().prefs.fontSize).toBe(32);
    setPreference('fontSize', -10);
    expect(usePreferencesStore.getState().prefs.fontSize).toBe(2);
  });

  it('rejects invalid theme ids and falls back to default', () => {
    const { setPreference } = usePreferencesStore.getState();
    // Cast through unknown to exercise the runtime guard without a TS error.
    setPreference('themeId', 'not-a-real-theme' as unknown as never);
    expect(usePreferencesStore.getState().prefs.themeId).toBe(PREF_DEFAULTS.themeId);
  });

  it('round-trips touchBarKeys via setPreference', () => {
    const { setPreference } = usePreferencesStore.getState();
    setPreference('touchBarKeys', [
      { id: 'a', label: 'Esc', send: '\u001b' },
      { id: 'b', label: 'Tab', send: '\t' },
    ]);
    const keys = usePreferencesStore.getState().prefs.touchBarKeys;
    expect(keys).toHaveLength(2);
    expect(keys?.[0]?.send).toBe('\u001b');
  });

  it('resetTouchBarKeys clears custom keys back to null', () => {
    const { setPreference, resetTouchBarKeys } = usePreferencesStore.getState();
    setPreference('touchBarKeys', [{ id: 'a', label: 'X', send: 'x' }]);
    resetTouchBarKeys();
    expect(usePreferencesStore.getState().prefs.touchBarKeys).toBeNull();
  });

  it('writes through to localStorage cache on each change', () => {
    const { setPreference } = usePreferencesStore.getState();
    setPreference('fontSize', 18);
    const raw = localStorage.getItem('termbeam-prefs');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).fontSize).toBe(18);
  });
});
