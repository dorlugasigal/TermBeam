import { useEffect, useCallback, useRef, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import {
  usePreferencesStore,
  PREF_DEFAULTS,
  type TouchBarKey,
} from '@/stores/preferencesStore';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';
import styles from './SettingsPanel.module.css';

const FONT_MIN = 8;
const FONT_MAX = 28;

function genKeyId(): string {
  return `k_${Math.random().toString(36).slice(2, 9)}`;
}

const DEFAULT_KEYS_PREVIEW: TouchBarKey[] = [
  { id: 'esc', label: 'Esc', send: '\x1b' },
  { id: 'tab', label: 'Tab', send: '\x09' },
  { id: 'ctrl-c', label: '^C', send: '\x03' },
  { id: 'home', label: 'Home', send: '\x1b[H' },
  { id: 'end', label: 'End', send: '\x1b[F' },
];

function Toggle({
  on,
  onChange,
  ariaLabel,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

/**
 * Theme picker mirroring the original ThemePicker concept:
 * a small trigger button shows the current theme; clicking it opens a
 * fixed-position popover list of themes.
 */
function ThemePickerInline({
  themeId,
  setTheme,
}: {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const currentTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]!;

  const place = useCallback(() => {
    const trig = triggerRef.current;
    if (!trig) return;
    const r = trig.getBoundingClientRect();
    const POP_W = 240;
    const POP_H = Math.min(window.innerHeight * 0.6, 420);
    let left = r.right - POP_W;
    if (left < 8) left = 8;
    if (left + POP_W > window.innerWidth - 8) left = window.innerWidth - POP_W - 8;
    let top = r.bottom + 4;
    if (top + POP_H > window.innerHeight - 8) top = r.top - POP_H - 4;
    if (top < 8) top = 8;
    setPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.themeTrigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Pick theme"
      >
        <span className={styles.themeSwatch} style={{ background: currentTheme.bg }} />
        {currentTheme.name}
      </button>
      {open && pos && (
        <div
          ref={popoverRef}
          className={styles.themePopover}
          style={{ top: pos.top, left: pos.left }}
          role="listbox"
        >
          <div className={styles.themePopoverHeader}>
            <span className={styles.themePopoverTitle}>Theme</span>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Close theme picker"
            >
              ✕
            </button>
          </div>
          <div className={styles.themeList}>
            {THEMES.map((t) => {
              const active = t.id === themeId;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`${styles.themeOption} ${active ? styles.themeOptionActive : ''}`}
                  onClick={() => {
                    setTheme(t.id as ThemeId);
                    setOpen(false);
                  }}
                >
                  <span className={styles.themeSwatch} style={{ background: t.bg }} />
                  {t.name}
                  {active && <span className={styles.themeCheck}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export default function SettingsPanel() {
  const open = useUIStore((s) => s.settingsPanelOpen);
  const close = useUIStore((s) => s.closeSettingsPanel);
  const prefs = usePreferencesStore((s) => s.prefs);
  const setPreference = usePreferencesStore((s) => s.setPreference);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  // Center panel on first open; reset if closed.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    // Defer to next frame so the panel has measured dimensions.
    const id = requestAnimationFrame(() => {
      const el = panelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = Math.max(8, (window.innerWidth - r.width) / 2);
      const y = Math.max(8, (window.innerHeight - r.height) / 3);
      setPos({ x, y });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const clamp = useCallback((x: number, y: number) => {
    const el = panelRef.current;
    if (!el) return { x, y };
    const r = el.getBoundingClientRect();
    const maxX = window.innerWidth - r.width - 8;
    const maxY = window.innerHeight - 40;
    return {
      x: Math.min(Math.max(8, x), Math.max(8, maxX)),
      y: Math.min(Math.max(8, y), Math.max(8, maxY)),
    };
  }, []);

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== undefined && e.button !== 0) return;
      const el = panelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      dragOffset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [],
  );

  const onHeaderPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const next = clamp(
        e.clientX - dragOffset.current.dx,
        e.clientY - dragOffset.current.dy,
      );
      setPos(next);
    },
    [dragging, clamp],
  );

  const onHeaderPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore — capture may have been released already
      }
      setDragging(false);
    },
    [dragging],
  );

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const setFont = useCallback(
    (n: number) => {
      const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
      setPreference('fontSize', clamped);
    },
    [setPreference],
  );

  const customKeys = prefs.touchBarKeys;
  const usingCustomKeys = customKeys !== null;

  const updateKey = useCallback(
    (idx: number, patch: Partial<TouchBarKey>) => {
      const list = customKeys ?? [];
      const next = list.map((k, i) => (i === idx ? { ...k, ...patch } : k));
      setPreference('touchBarKeys', next);
    },
    [customKeys, setPreference],
  );

  const removeKey = useCallback(
    (idx: number) => {
      const list = customKeys ?? [];
      const next = list.filter((_, i) => i !== idx);
      setPreference('touchBarKeys', next);
    },
    [customKeys, setPreference],
  );

  const addKey = useCallback(() => {
    const list = customKeys ?? [...DEFAULT_KEYS_PREVIEW];
    const next: TouchBarKey[] = [...list, { id: genKeyId(), label: 'Key', send: '' }];
    setPreference('touchBarKeys', next);
  }, [customKeys, setPreference]);

  const enableCustomKeys = useCallback(() => {
    setPreference('touchBarKeys', [...DEFAULT_KEYS_PREVIEW]);
  }, [setPreference]);

  const resetCustomKeys = useCallback(() => {
    setPreference('touchBarKeys', null);
  }, [setPreference]);

  const startup = prefs.startupWorkspace;

  const setStartupEnabled = useCallback(
    (enabled: boolean) => {
      setPreference('startupWorkspace', { ...startup, enabled });
    },
    [setPreference, startup],
  );

  const removeStartupSession = useCallback(
    (idx: number) => {
      const sessions = startup.sessions.filter((_, i) => i !== idx);
      setPreference('startupWorkspace', { ...startup, sessions });
    },
    [setPreference, startup],
  );

  if (!open) return null;

  const panelStyle: React.CSSProperties = pos
    ? { transform: `translate(${pos.x}px, ${pos.y}px)`, opacity: 1 }
    : { opacity: 0, pointerEvents: 'none' };

  return (
    <div
      ref={panelRef}
      className={`${styles.panel} ${dragging ? styles.dragging : ''}`}
      style={panelStyle}
      role="dialog"
      aria-label="Settings"
      aria-modal="false"
    >
      <div
        className={styles.header}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <span className={styles.handle}>
          <span className={styles.handleDots} aria-hidden>
            ⋮⋮
          </span>
          <span className={styles.title}>Settings</span>
        </span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={close}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>

      <div className={styles.body}>
          {/* ── Appearance ───────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Appearance</h3>

            <div className={styles.row}>
              <span className={styles.rowLabel}>
                Font size
                <span className={styles.rowHint}>{FONT_MIN}–{FONT_MAX}px</span>
              </span>
              <div className={styles.numericRow}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setFont(prefs.fontSize - 1)}
                  disabled={prefs.fontSize <= FONT_MIN}
                  aria-label="Decrease font size"
                >
                  −
                </button>
                <span className={styles.numericValue}>{prefs.fontSize}</span>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setFont(prefs.fontSize + 1)}
                  disabled={prefs.fontSize >= FONT_MAX}
                  aria-label="Increase font size"
                >
                  +
                </button>
              </div>
            </div>

            <div className={styles.row}>
              <span className={styles.rowLabel}>Theme</span>
              <ThemePickerInline
                themeId={prefs.themeId as ThemeId}
                setTheme={(id) => setPreference('themeId', id)}
              />
            </div>
          </section>

          {/* ── Notifications ────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Notifications & Feedback</h3>

            <div className={styles.row}>
              <span className={styles.rowLabel}>
                Notifications
                <span className={styles.rowHint}>
                  Sound & push when sessions need attention
                </span>
              </span>
              <Toggle
                on={prefs.notifications}
                ariaLabel="Toggle notifications"
                onChange={(v) => setPreference('notifications', v)}
              />
            </div>

            <div className={styles.row}>
              <span className={styles.rowLabel}>
                Haptics
                <span className={styles.rowHint}>
                  Vibrate on TouchBar key press (mobile)
                </span>
              </span>
              <Toggle
                on={prefs.haptics}
                ariaLabel="Toggle haptics"
                onChange={(v) => setPreference('haptics', v)}
              />
            </div>
          </section>

          {/* ── Touch Bar ─────────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Touch Bar</h3>

            <div className={styles.row}>
              <span className={styles.rowLabel}>
                Start collapsed
                <span className={styles.rowHint}>
                  Hide TouchBar by default; tap the handle to expand
                </span>
              </span>
              <Toggle
                on={prefs.touchBarCollapsed}
                ariaLabel="Toggle TouchBar collapsed by default"
                onChange={(v) => setPreference('touchBarCollapsed', v)}
              />
            </div>

            <div className={styles.row}>
              <span className={styles.rowLabel}>
                Custom keys
                <span className={styles.rowHint}>
                  {usingCustomKeys
                    ? `${customKeys.length} custom keys`
                    : 'Using built-in defaults'}
                </span>
              </span>
              {usingCustomKeys ? (
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={resetCustomKeys}
                >
                  Reset to defaults
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={enableCustomKeys}
                >
                  Customize
                </button>
              )}
            </div>

            {usingCustomKeys && (
              <div className={styles.keyEditor}>
                {(customKeys ?? []).map((k, i) => (
                  <div key={k.id} className={styles.keyEditorRow}>
                    <input
                      className={styles.keyInput}
                      type="text"
                      value={k.label}
                      maxLength={6}
                      placeholder="Label"
                      aria-label={`Key ${i + 1} label`}
                      onChange={(e) => updateKey(i, { label: e.target.value })}
                    />
                    <input
                      className={styles.keyInput}
                      type="text"
                      value={k.send}
                      placeholder="Send (e.g. \\x1b)"
                      aria-label={`Key ${i + 1} send sequence`}
                      onChange={(e) => updateKey(i, { send: e.target.value })}
                    />
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => removeKey(i)}
                      aria-label={`Remove key ${k.label}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" className={styles.linkBtn} onClick={addKey}>
                  + Add key
                </button>
              </div>
            )}
          </section>

          {/* ── Defaults ─────────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>New Session Defaults</h3>

            <div>
              <span className={styles.rowLabel}>Default folder</span>
              <input
                className={styles.keyInput}
                type="text"
                style={{ width: '100%', marginTop: 6 }}
                value={prefs.defaultFolder}
                placeholder="Leave empty for current working directory"
                onChange={(e) => setPreference('defaultFolder', e.target.value)}
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <span className={styles.rowLabel}>Default initial command</span>
              <input
                className={styles.keyInput}
                type="text"
                style={{ width: '100%', marginTop: 6 }}
                value={prefs.defaultInitialCommand}
                placeholder="e.g. npm run dev"
                onChange={(e) =>
                  setPreference('defaultInitialCommand', e.target.value)
                }
              />
            </div>
          </section>

          {/* ── Startup Workspace ────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Startup Workspace</h3>

            <div className={styles.row}>
              <span className={styles.rowLabel}>
                Auto-restore on launch
                <span className={styles.rowHint}>
                  Re-open these sessions when TermBeam starts
                </span>
              </span>
              <Toggle
                on={startup.enabled}
                ariaLabel="Toggle startup workspace"
                onChange={setStartupEnabled}
              />
            </div>

            {startup.sessions.length === 0 ? (
              <p className={styles.empty}>
                No saved sessions yet. Open the Tools menu in any session and
                use “Save to startup workspace” to add it.
              </p>
            ) : (
              <div className={styles.workspaceList}>
                {startup.sessions.map((s, i) => (
                  <div key={s.id} className={styles.workspaceItem}>
                    <div>
                      <div>{s.name}</div>
                      <div className={styles.workspaceMeta}>
                        {s.kind === 'agent' ? 'Agent' : 'Shell'} · {s.cwd || '~'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => removeStartupSession(i)}
                      aria-label={`Remove ${s.name} from startup workspace`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Reset all */}
          <section className={styles.section}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => {
                if (
                  confirm(
                    'Reset all preferences to defaults? This will sync to the server.',
                  )
                ) {
                  Object.entries(PREF_DEFAULTS).forEach(([k, v]) => {
                    setPreference(k as keyof typeof PREF_DEFAULTS, v as never);
                  });
                }
              }}
            >
              Reset all preferences to defaults
            </button>
          </section>
        </div>
    </div>
  );
}
