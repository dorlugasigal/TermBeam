import { create } from 'zustand';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';

// ---------------------------------------------------------------------------
// Schema — must match the sanitizer in src/server/preferences.js.
// Unknown fields from the server are silently dropped on read.
// ---------------------------------------------------------------------------

export interface TouchBarKey {
  id: string;
  label: string;
  send: string;
  modifier?: 'ctrl' | 'alt' | 'shift';
}

export interface StartupSession {
  id: string;
  name: string;
  kind: 'shell' | 'agent';
  cwd: string;
  initialCommand: string;
  agentId?: string;
}

export interface Preferences {
  themeId: ThemeId;
  fontSize: number;
  notifications: boolean;
  haptics: boolean;
  defaultFolder: string;
  defaultInitialCommand: string;
  touchBarCollapsed: boolean;
  /** null means "use built-in defaults" */
  touchBarKeys: TouchBarKey[] | null;
  startupWorkspace: { enabled: boolean; sessions: StartupSession[] };
}

export const PREF_DEFAULTS: Preferences = Object.freeze({
  themeId: 'dark' as ThemeId,
  fontSize: 14,
  notifications: true,
  haptics: true,
  defaultFolder: '',
  defaultInitialCommand: '',
  touchBarCollapsed: false,
  touchBarKeys: null,
  startupWorkspace: { enabled: false, sessions: [] },
}) as Preferences;

// ---------------------------------------------------------------------------
// localStorage cache + legacy migration
// ---------------------------------------------------------------------------

const CACHE_KEY = 'termbeam-prefs';
const LEGACY_THEME_KEY = 'termbeam-theme';
const LEGACY_FONT_KEY = 'termbeam-font-size';
const LEGACY_NOTIFY_KEY = 'termbeam-notifications';
const MIGRATION_FLAG = 'termbeam-prefs-migrated';

const FONT_MIN = 2;
const FONT_MAX = 32;

function clampFont(n: number): number {
  if (!Number.isFinite(n)) return PREF_DEFAULTS.fontSize;
  return Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
}

function isValidThemeId(id: unknown): id is ThemeId {
  return typeof id === 'string' && THEMES.some((t) => t.id === id);
}

/** Coerce an arbitrary partial input into a valid Preferences object. */
function normalize(input: unknown): Preferences {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<Preferences>;
  return {
    themeId: isValidThemeId(p.themeId) ? p.themeId : PREF_DEFAULTS.themeId,
    fontSize: clampFont(typeof p.fontSize === 'number' ? p.fontSize : PREF_DEFAULTS.fontSize),
    notifications: typeof p.notifications === 'boolean' ? p.notifications : PREF_DEFAULTS.notifications,
    haptics: typeof p.haptics === 'boolean' ? p.haptics : PREF_DEFAULTS.haptics,
    defaultFolder: typeof p.defaultFolder === 'string' ? p.defaultFolder : '',
    defaultInitialCommand:
      typeof p.defaultInitialCommand === 'string' ? p.defaultInitialCommand : '',
    touchBarCollapsed:
      typeof p.touchBarCollapsed === 'boolean'
        ? p.touchBarCollapsed
        : PREF_DEFAULTS.touchBarCollapsed,
    touchBarKeys: Array.isArray(p.touchBarKeys) ? (p.touchBarKeys as TouchBarKey[]) : null,
    startupWorkspace:
      p.startupWorkspace && typeof p.startupWorkspace === 'object'
        ? {
            enabled: !!p.startupWorkspace.enabled,
            sessions: Array.isArray(p.startupWorkspace.sessions)
              ? (p.startupWorkspace.sessions as StartupSession[])
              : [],
          }
        : { enabled: false, sessions: [] },
  };
}

function readCache(): Preferences {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    // ignore — corrupt or unavailable
  }
  return { ...PREF_DEFAULTS };
}

function writeCache(prefs: Preferences): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore — quota or private mode
  }
}

/**
 * Read legacy single-purpose keys (theme/font/notifications) into a partial
 * Preferences object so we can seed the unified store on first run after
 * upgrade. Returns null if the migration has already happened.
 */
function readLegacyAsSeed(): Partial<Preferences> | null {
  try {
    if (localStorage.getItem(MIGRATION_FLAG) === '1') return null;
  } catch {
    return null;
  }
  const seed: Partial<Preferences> = {};
  try {
    const t = localStorage.getItem(LEGACY_THEME_KEY);
    if (isValidThemeId(t)) seed.themeId = t;
    const f = localStorage.getItem(LEGACY_FONT_KEY);
    if (f) {
      const n = Number(f);
      if (Number.isFinite(n)) seed.fontSize = clampFont(n);
    }
    const n = localStorage.getItem(LEGACY_NOTIFY_KEY);
    if (n !== null) seed.notifications = n !== 'false';
  } catch {
    // ignore
  }
  return Object.keys(seed).length > 0 ? seed : null;
}

function markMigrated(): void {
  try {
    localStorage.setItem(MIGRATION_FLAG, '1');
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Side effects — keep DOM and dependent stores in sync
// ---------------------------------------------------------------------------

function applySideEffects(prefs: Preferences, prev: Preferences | null): void {
  if (!prev || prev.themeId !== prefs.themeId) {
    try {
      document.documentElement.setAttribute('data-theme', prefs.themeId);
    } catch {
      // SSR / no DOM
    }
  }
}

// ---------------------------------------------------------------------------
// Server sync
// ---------------------------------------------------------------------------

const PUT_DEBOUNCE_MS = 300;
let putTimer: ReturnType<typeof setTimeout> | null = null;
let putInFlight = false;
let pendingPut: Preferences | null = null;

async function flushPut(prefs: Preferences): Promise<void> {
  putInFlight = true;
  try {
    const res = await fetch('/api/preferences', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs }),
    });
    if (res.ok) {
      const body = (await res.json()) as { prefs: Preferences; version: number };
      // Use server-sanitized echo as authoritative — drops stale fields and
      // reflects any clamps we missed client-side.
      const next = normalize(body.prefs);
      writeCache(next);
      usePreferencesStore.setState({ prefs: next, version: body.version, syncing: false });
    }
  } catch {
    // Offline or transient — keep local state; we'll retry on next change or
    // on the next visibility/focus refetch.
  } finally {
    putInFlight = false;
    if (pendingPut) {
      const next = pendingPut;
      pendingPut = null;
      void flushPut(next);
    }
  }
}

function schedulePut(prefs: Preferences): void {
  if (putTimer) clearTimeout(putTimer);
  putTimer = setTimeout(() => {
    putTimer = null;
    if (putInFlight) {
      pendingPut = prefs;
    } else {
      void flushPut(prefs);
    }
  }, PUT_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface PreferencesState {
  prefs: Preferences;
  version: number;
  hydrated: boolean;
  syncing: boolean;

  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  setPreferences: (patch: Partial<Preferences>) => void;
  resetTouchBarKeys: () => void;
  hydrate: () => Promise<void>;
  refetch: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  prefs: readCache(),
  version: 0,
  hydrated: false,
  syncing: false,

  setPreference: (key, value) => {
    const prev = get().prefs;
    const next = { ...prev, [key]: value } as Preferences;
    const normalized = normalize(next);
    applySideEffects(normalized, prev);
    writeCache(normalized);
    set({ prefs: normalized, syncing: true });
    schedulePut(normalized);
  },

  setPreferences: (patch) => {
    const prev = get().prefs;
    const normalized = normalize({ ...prev, ...patch });
    applySideEffects(normalized, prev);
    writeCache(normalized);
    set({ prefs: normalized, syncing: true });
    schedulePut(normalized);
  },

  resetTouchBarKeys: () => {
    get().setPreference('touchBarKeys', null);
  },

  hydrate: async () => {
    if (get().hydrated) return;
    // Apply cached side effects immediately for first-paint correctness.
    applySideEffects(get().prefs, null);

    const seed = readLegacyAsSeed();
    try {
      const res = await fetch('/api/preferences', { credentials: 'include' });
      if (res.ok) {
        const body = (await res.json()) as { prefs: Preferences; version: number };
        const serverPrefs = normalize(body.prefs);
        // First-run migration: server is at version 0 (defaults) and the
        // user has legacy keys. Push their legacy values up once.
        if (body.version === 0 && seed) {
          const merged = normalize({ ...serverPrefs, ...seed });
          applySideEffects(merged, get().prefs);
          writeCache(merged);
          set({ prefs: merged, version: 0, hydrated: true });
          markMigrated();
          schedulePut(merged);
          return;
        }
        applySideEffects(serverPrefs, get().prefs);
        writeCache(serverPrefs);
        set({ prefs: serverPrefs, version: body.version, hydrated: true });
        if (seed) markMigrated();
        return;
      }
    } catch {
      // Offline or unauthenticated — fall through to local-only mode.
    }
    set({ hydrated: true });
  },

  refetch: async () => {
    try {
      const res = await fetch('/api/preferences', { credentials: 'include' });
      if (!res.ok) return;
      const body = (await res.json()) as { prefs: Preferences; version: number };
      // Don't clobber unsynced local edits.
      if (get().syncing || putInFlight || pendingPut) return;
      const next = normalize(body.prefs);
      if (body.version <= get().version) return;
      applySideEffects(next, get().prefs);
      writeCache(next);
      set({ prefs: next, version: body.version });
    } catch {
      // ignore
    }
  },
}));

// Refetch on focus/visibility change so other devices/tabs pick up edits.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    void usePreferencesStore.getState().refetch();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void usePreferencesStore.getState().refetch();
    }
  });
}

// Convenience selector hooks.
export const usePreference = <K extends keyof Preferences>(key: K): Preferences[K] =>
  usePreferencesStore((s) => s.prefs[key]);

// Test-only: reset internal module state. Not exported through the public API.
export function __resetPreferencesStoreForTests(): void {
  if (putTimer) clearTimeout(putTimer);
  putTimer = null;
  putInFlight = false;
  pendingPut = null;
  usePreferencesStore.setState({
    prefs: { ...PREF_DEFAULTS },
    version: 0,
    hydrated: false,
    syncing: false,
  });
}
