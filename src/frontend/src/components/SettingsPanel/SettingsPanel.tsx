import { useEffect, useCallback } from 'react';
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

export default function SettingsPanel() {
  const open = useUIStore((s) => s.settingsPanelOpen);
  const close = useUIStore((s) => s.closeSettingsPanel);
  const prefs = usePreferencesStore((s) => s.prefs);
  const setPreference = usePreferencesStore((s) => s.setPreference);

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

  return (
    <>
      <div className={styles.scrim} onClick={close} aria-hidden />
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Settings"
        aria-modal="false"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={close}
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

            <div>
              <span className={styles.rowLabel}>Theme</span>
              <div className={styles.themeGrid}>
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`${styles.themeOption} ${
                      t.id === prefs.themeId ? styles.themeOptionActive : ''
                    }`}
                    onClick={() => setPreference('themeId', t.id as ThemeId)}
                  >
                    <span
                      className={styles.themeSwatch}
                      style={{ background: t.bg }}
                    />
                    {t.name}
                  </button>
                ))}
              </div>
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
    </>
  );
}
