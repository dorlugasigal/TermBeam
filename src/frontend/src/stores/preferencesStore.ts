import { create } from 'zustand';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';

// ---------------------------------------------------------------------------
// Schema — must match the sanitizer in src/server/preferences.js.
// Unknown fields from the server are silently dropped on read.
// ---------------------------------------------------------------------------

export type KeyAction = 'mic' | 'copy' | 'paste' | 'cancel' | 'newline';
/** Visual preset. `custom` means use the user-supplied bg/color. */
export type KeyLook = 'plain' | 'accent' | 'danger' | 'custom';

export interface TouchBarKey {
  id: string;
  label: string;
  send: string;
  modifier?: 'ctrl' | 'alt' | 'shift' | 'meta';
  /** Built-in action this key dispatches. Takes precedence over `send`. */
  action?: KeyAction;
  /** Grid column span (1-8, default 1). */
  size?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Which row this key belongs to (1-3; default 1). Capped at 3 — the
   *  touchbar UI doesn't render row 4+ keys to keep the bar compact. */
  row?: number;
  /** Starting column within the row (1-based, 1-8; default = leftmost
   *  free position). Lets users drop keys onto specific empty slots. */
  col?: number;
  bg?: string;
  color?: string;
  style?: KeyLook;
}

/** Map legacy style values from older prefs to the simplified vocabulary. */
const LEGACY_LOOK_MAP: Record<string, KeyLook> = {
  default: 'plain',
  special: 'plain',
  modifier: 'plain',
  icon: 'plain',
  enter: 'accent',
  danger: 'danger',
  plain: 'plain',
  accent: 'accent',
  custom: 'custom',
};

function migrateTouchBarKey(k: TouchBarKey): TouchBarKey {
  const next: TouchBarKey = { ...k };
  if (next.style && LEGACY_LOOK_MAP[next.style]) {
    next.style = LEGACY_LOOK_MAP[next.style];
  }
  // If user has bg or color set but style isn't 'custom', upgrade to custom
  // so the color shows in the new render path.
  if ((next.bg || next.color) && next.style !== 'custom') {
    next.style = 'custom';
  }
  return next;
}

/** Auto-assign `row` and `col` to legacy keys that don't have them.
 *  Packs left-to-right into 8-col rows in array order, capped at 3 rows.
 *  Mic action keys always belong to the same row as the last grid key. */
function assignDefaultRows(keys: TouchBarKey[]): TouchBarKey[] {
  const COLS = 8;
  const MAX_ROWS = 3;
  if (keys.length === 0) return keys;
  const allHaveRowCol = keys.every(
    (k) =>
      typeof k.row === 'number' &&
      k.row >= 1 &&
      k.row <= MAX_ROWS &&
      typeof k.col === 'number' &&
      k.col >= 1,
  );
  if (allHaveRowCol) return keys;

  const out: TouchBarKey[] = [];
  let currentRow = 1;
  let currentCol = 1;
  for (const k of keys) {
    if (k.action === 'mic') {
      out.push({ ...k, row: Math.min(currentRow, MAX_ROWS), col: 8 });
      continue;
    }
    if (
      typeof k.row === 'number' &&
      k.row >= 1 &&
      k.row <= MAX_ROWS &&
      typeof k.col === 'number'
    ) {
      out.push(k);
      if (k.row > currentRow) {
        currentRow = k.row;
        currentCol = (k.col ?? 1) + (k.size ?? 1);
      }
      continue;
    }
    const span = k.size ?? 1;
    if (currentCol + span - 1 > COLS) {
      currentRow += 1;
      currentCol = 1;
      if (currentRow > MAX_ROWS) {
        // Drop overflow keys silently rather than render off-screen.
        continue;
      }
    }
    out.push({
      ...k,
      row: currentRow,
      col: currentCol,
    });
    currentCol += span;
  }
  return out;
}

export interface StartupSession {
  id: string;
  name: string;
  kind: 'shell' | 'agent';
  cwd: string;
  initialCommand: string;
  agentId?: string;
  shell?: string;
  color?: string;
}

export interface Workspace {
  id: string;
  name: string;
  sessions: StartupSession[];
  /** When true, this workspace auto-launches at startup. Only one default
   *  expected; the first one wins on load. */
  default?: boolean;
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
  /** Legacy single-workspace pointer kept for backwards compat. New UI
   *  manages `workspaces` instead but this still drives auto-startup
   *  when no `workspaces[*].default` is set. */
  startupWorkspace: { enabled: boolean; sessions: StartupSession[] };
  /** User-saved named workspaces. Multiple allowed. */
  workspaces: Workspace[];
}

export const PREF_DEFAULTS: Preferences = Object.freeze({
  themeId: 'dark' as ThemeId,
  fontSize: 14,
  // Match server default in src/server/preferences.js — keeps first-paint
  // (cached/legacy) state aligned with the authoritative server value so
  // the Notifications toggle doesn't flip on first hydrate.
  notifications: false,
  haptics: true,
  defaultFolder: '',
  defaultInitialCommand: '',
  touchBarCollapsed: false,
  touchBarKeys: null,
  startupWorkspace: { enabled: false, sessions: [] },
  workspaces: [],
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
    touchBarKeys: Array.isArray(p.touchBarKeys)
      ? assignDefaultRows((p.touchBarKeys as TouchBarKey[]).map(migrateTouchBarKey))
      : null,
    startupWorkspace:
      p.startupWorkspace && typeof p.startupWorkspace === 'object'
        ? {
            enabled: !!p.startupWorkspace.enabled,
            sessions: Array.isArray(p.startupWorkspace.sessions)
              ? (p.startupWorkspace.sessions as StartupSession[])
              : [],
          }
        : { enabled: false, sessions: [] },
    workspaces: Array.isArray(p.workspaces) ? (p.workspaces as Workspace[]) : [],
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
      usePreferencesStore.setState({ prefs: next, version: body.version });
    }
  } catch {
    // Offline or transient — keep local state; we'll retry on next change or
    // on the next visibility/focus refetch.
  } finally {
    // Always clear `syncing` even when the PUT failed (network drop, 401,
    // 5xx). Otherwise the store can stay stuck in `syncing: true` and
    // refetch() permanently early-returns, leaving the UI desynced.
    usePreferencesStore.setState({ syncing: false });
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
