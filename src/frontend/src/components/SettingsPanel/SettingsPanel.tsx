import { useEffect, useCallback, useRef, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import {
  usePreferencesStore,
  PREF_DEFAULTS,
  type StartupSession,
  type Workspace,
} from '@/stores/preferencesStore';
import { THEMES } from '@/themes/terminalThemes';
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser';
import styles from './SettingsPanel.module.css';

const FONT_MIN = 8;
const FONT_MAX = 28;

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
  const openThemePicker = useUIStore((s) => s.openThemePicker);
  const openCustomKeysModal = useUIStore((s) => s.openCustomKeysModal);
  const prefs = usePreferencesStore((s) => s.prefs);
  const setPreference = usePreferencesStore((s) => s.setPreference);
  const sessions = useSessionStore((s) => s.sessions);

  const panelRef = useRef<HTMLDivElement | null>(null);
  // FIX #1: dragOffset tracks JS-controlled position after first drag.
  // When null, panel is CSS-centered. When set, panel uses inline transform.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  // FIX #3: browsing folder state
  const [browsingFolder, setBrowsingFolder] = useState(false);

  // FIX #4: workspace save toast
  const [saveToast, setSaveToast] = useState('');

  // Animate-on-close: keep mounted briefly with a `closing` class so the
  // exit transition can play before unmounting.
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => setMounted(false), 220);
      return () => clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset drag offset when closed
  useEffect(() => {
    if (!open) {
      setDragOffset(null);
      setBrowsingFolder(false);
    }
  }, [open]);

  const clamp = useCallback((x: number, y: number) => {
    const el = panelRef.current;
    if (!el) return { x, y };
    const r = el.getBoundingClientRect();
    const maxX = window.innerWidth - r.width - 8;
    const maxY = window.innerHeight - 40; // keep 40px header visible at bottom
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

      if (dragOffset == null) {
        // First drag: capture current rect and switch from CSS-center to JS-controlled
        const r = el.getBoundingClientRect();
        const newOffset = { x: r.left, y: r.top };
        setDragOffset(newOffset);
        dragStartRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      } else {
        dragStartRef.current = { dx: e.clientX - dragOffset.x, dy: e.clientY - dragOffset.y };
      }

      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [dragOffset],
  );

  const onHeaderPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || dragOffset == null) return;
      const next = clamp(e.clientX - dragStartRef.current.dx, e.clientY - dragStartRef.current.dy);
      setDragOffset(next);
    },
    [dragging, dragOffset, clamp],
  );

  const onHeaderPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setDragging(false);
    },
    [dragging],
  );

  // Esc to close
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

  // FIX #2: open standalone theme picker
  const currentTheme = THEMES.find((t) => t.id === prefs.themeId) ?? THEMES[0]!;

  // Snapshot the current live sessions into a `StartupSession[]` for saving.
  const snapshotCurrentSessions = useCallback((): StartupSession[] => {
    return Array.from(sessions.values())
      .filter((s) => !s.hidden)
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: (s.type === 'copilot' || s.type === 'agent' ? 'agent' : 'shell') as
          | 'shell'
          | 'agent',
        cwd: s.cwd || '',
        initialCommand: s.initialCommand || '',
        agentId: s.type === 'copilot' || s.type === 'agent' ? s.model : undefined,
        shell: s.shell || undefined,
        color: s.color || undefined,
      }));
  }, [sessions]);

  // FIX #4: save current as a NEW named workspace (multi-workspace support).
  const saveAsNewWorkspace = useCallback(() => {
    const snap = snapshotCurrentSessions();
    if (snap.length === 0) {
      setSaveToast('No open sessions to save');
      setTimeout(() => setSaveToast(''), 2000);
      return;
    }
    const defaultName = `Workspace ${prefs.workspaces.length + 1}`;
    const name = (prompt('Name this workspace:', defaultName) ?? '').trim();
    if (!name) return;
    const newWorkspace: Workspace = {
      id: `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      sessions: snap,
    };
    setPreference('workspaces', [...prefs.workspaces, newWorkspace]);
    setSaveToast(`Saved "${name}" (${snap.length} session${snap.length === 1 ? '' : 's'})`);
    setTimeout(() => setSaveToast(''), 2200);
  }, [snapshotCurrentSessions, prefs.workspaces, setPreference]);

  const renameWorkspace = useCallback(
    (id: string) => {
      const ws = prefs.workspaces.find((w) => w.id === id);
      if (!ws) return;
      const next = (prompt('Rename workspace:', ws.name) ?? '').trim();
      if (!next || next === ws.name) return;
      setPreference(
        'workspaces',
        prefs.workspaces.map((w) => (w.id === id ? { ...w, name: next } : w)),
      );
    },
    [prefs.workspaces, setPreference],
  );

  const deleteWorkspace = useCallback(
    (id: string) => {
      const ws = prefs.workspaces.find((w) => w.id === id);
      if (!ws) return;
      if (!confirm(`Delete workspace "${ws.name}"?`)) return;
      setPreference(
        'workspaces',
        prefs.workspaces.filter((w) => w.id !== id),
      );
    },
    [prefs.workspaces, setPreference],
  );

  const setDefaultWorkspace = useCallback(
    (id: string | null) => {
      setPreference(
        'workspaces',
        prefs.workspaces.map((w) => ({ ...w, default: w.id === id })),
      );
    },
    [prefs.workspaces, setPreference],
  );

  const updateWorkspaceFromCurrent = useCallback(
    (id: string) => {
      const snap = snapshotCurrentSessions();
      if (snap.length === 0) {
        setSaveToast('No open sessions to update with');
        setTimeout(() => setSaveToast(''), 2000);
        return;
      }
      setPreference(
        'workspaces',
        prefs.workspaces.map((w) => (w.id === id ? { ...w, sessions: snap } : w)),
      );
      setSaveToast(`Updated (${snap.length} session${snap.length === 1 ? '' : 's'})`);
      setTimeout(() => setSaveToast(''), 2000);
    },
    [snapshotCurrentSessions, prefs.workspaces, setPreference],
  );

  const removeSessionFromWorkspace = useCallback(
    (workspaceId: string, sessionId: string) => {
      setPreference(
        'workspaces',
        prefs.workspaces.map((w) =>
          w.id === workspaceId
            ? { ...w, sessions: w.sessions.filter((s) => s.id !== sessionId) }
            : w,
        ),
      );
    },
    [prefs.workspaces, setPreference],
  );

  // ── Legacy single-startup-workspace bridge (kept for backwards compat) ──
  const saveWorkspace = useCallback(() => {
    const snap = snapshotCurrentSessions();
    setPreference('startupWorkspace', { enabled: true, sessions: snap });
    setSaveToast(`Saved (${snap.length} sessions)`);
    setTimeout(() => setSaveToast(''), 2000);
  }, [snapshotCurrentSessions, setPreference]);

  // FIX #5: custom keys helpers
  const customKeys = prefs.touchBarKeys ?? [];
  const usingCustomKeys = prefs.touchBarKeys !== null;

  const enableCustomKeys = useCallback(() => {
    openCustomKeysModal();
  }, [openCustomKeysModal]);

  const resetCustomKeys = useCallback(() => {
    setPreference('touchBarKeys', null);
  }, [setPreference]);

  if (!mounted) return null;

  // FIX #1: panel style conditional on dragOffset
  const panelStyle: React.CSSProperties = dragOffset
    ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`, top: 0, left: 0 }
    : {}; // CSS class handles centering

  return (
    <div
      ref={panelRef}
      className={`${styles.panel} ${dragging ? styles.dragging : ''} ${!dragOffset ? styles.panelCentered : ''} ${closing ? styles.panelClosing : ''}`}
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

      {browsingFolder ? (
        /* FIX #3: folder browser mode */
        <div className={styles.body}>
          <FolderBrowser
            currentDir={prefs.defaultFolder || '/'}
            onSelect={(dir) => {
              setPreference('defaultFolder', dir);
              setBrowsingFolder(false);
            }}
            onCancel={() => setBrowsingFolder(false)}
          />
        </div>
      ) : (
        <div className={styles.body}>
          {/* ── Appearance ───────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Appearance</h3>

            <div className={styles.row}>
              <span className={styles.rowLabel}>
                Font size
                <span className={styles.rowHint}>
                  {FONT_MIN}–{FONT_MAX}px
                </span>
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

            {/* FIX #2: theme button opens standalone picker */}
            <div className={styles.row}>
              <span className={styles.rowLabel}>Theme</span>
              <button
                type="button"
                className={styles.themeButton}
                onClick={() => {
                  close();
                  openThemePicker();
                }}
              >
                <span className={styles.themeSwatch} style={{ background: currentTheme.bg }} />
                <span>{currentTheme.name}</span>
                <span className={styles.themeChevron}>›</span>
              </button>
            </div>
          </section>

          {/* ── Notifications ────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Notifications & Feedback</h3>

            <div className={styles.row}>
              <span className={styles.rowLabel}>
                Notifications
                <span className={styles.rowHint}>Sound & push when sessions need attention</span>
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
                <span className={styles.rowHint}>Vibrate on TouchBar key press (mobile)</span>
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
                <span className={styles.rowHint}>Hide TouchBar by default; tap the handle to expand</span>
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
                  {usingCustomKeys ? `${customKeys.length} custom keys` : 'Using built-in defaults'}
                </span>
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {usingCustomKeys && (
                  <button type="button" className={styles.linkBtn} onClick={resetCustomKeys}>
                    Reset
                  </button>
                )}
                <button type="button" className={styles.linkBtn} onClick={enableCustomKeys}>
                  Customize keys…
                </button>
              </div>
            </div>

            {usingCustomKeys && customKeys.length > 0 && (
              <button
                type="button"
                className={styles.keyboardPreview}
                onClick={openCustomKeysModal}
                aria-label="Open custom keys editor"
                style={{
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  width: '100%',
                  marginTop: 8,
                }}
              >
                {customKeys.map((k) => (
                  <span
                    key={k.id}
                    className={styles.previewKey}
                    style={{
                      gridColumn: `span ${k.size ?? 1}`,
                      background: k.bg,
                      color: k.color,
                      pointerEvents: 'none',
                    }}
                  >
                    {k.label}
                  </span>
                ))}
              </button>
            )}
          </section>

          {/* ── Defaults ─────────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>New Session Defaults</h3>

            {/* FIX #3: default folder with browse button */}
            <div>
              <span className={styles.rowLabel}>Default folder</span>
              <div className={styles.folderRow}>
                <span className={styles.folderPath}>
                  {prefs.defaultFolder ? (
                    prefs.defaultFolder.length > 40 ? (
                      <>
                        {prefs.defaultFolder.slice(0, 18)}…{prefs.defaultFolder.slice(-18)}
                      </>
                    ) : (
                      prefs.defaultFolder
                    )
                  ) : (
                    <em className={styles.folderPlaceholder}>Current working directory</em>
                  )}
                </span>
                <button
                  type="button"
                  className={styles.browseBtn}
                  onClick={() => setBrowsingFolder(true)}
                >
                  Browse…
                </button>
                {prefs.defaultFolder && (
                  <button
                    type="button"
                    className={styles.clearBtn}
                    onClick={() => setPreference('defaultFolder', '')}
                    aria-label="Clear default folder"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <span className={styles.rowLabel}>Default initial command</span>
              <input
                className={styles.keyInput}
                type="text"
                style={{ width: '100%', marginTop: 6 }}
                value={prefs.defaultInitialCommand}
                placeholder="e.g. npm run dev"
                onChange={(e) => setPreference('defaultInitialCommand', e.target.value)}
              />
            </div>
          </section>

          {/* ── Workspaces ────────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Workspaces</h3>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className={styles.primaryBtn} onClick={saveAsNewWorkspace}>
                Save current as new workspace
              </button>
              <button type="button" className={styles.linkBtn} onClick={saveWorkspace}>
                Update default startup
              </button>
            </div>

            {saveToast && <div className={styles.saveToast}>{saveToast}</div>}

            {prefs.workspaces.length === 0 ? (
              <p className={styles.empty} style={{ marginTop: 10 }}>
                No saved workspaces yet. Open some sessions then click <strong>Save current as new workspace</strong>.
              </p>
            ) : (
              <div className={styles.workspaceList} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                {prefs.workspaces.map((ws) => (
                  <div key={ws.id} className={styles.workspaceCard}>
                    <div className={styles.workspaceCardHeader}>
                      <div className={styles.workspaceCardTitle}>
                        <span className={styles.workspaceCardName}>{ws.name}</span>
                        <span className={styles.workspaceCardCount}>
                          {ws.sessions.length} session{ws.sessions.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className={styles.workspaceCardActions}>
                        <label className={styles.workspaceDefaultToggle}>
                          <input
                            type="checkbox"
                            checked={!!ws.default}
                            onChange={(e) =>
                              setDefaultWorkspace(e.target.checked ? ws.id : null)
                            }
                          />
                          <span>Auto-start</span>
                        </label>
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => updateWorkspaceFromCurrent(ws.id)}
                          title="Replace this workspace with the currently open sessions"
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => renameWorkspace(ws.id)}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className={styles.linkBtnDanger}
                          onClick={() => deleteWorkspace(ws.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className={styles.workspaceTileGrid}>
                      {ws.sessions.length === 0 ? (
                        <p className={styles.empty}>Empty workspace.</p>
                      ) : (
                        ws.sessions.map((s, i) => (
                          <div key={s.id} className={styles.workspaceTile}>
                            <div className={styles.workspaceTileIndex}>{`#${i + 1}`}</div>
                            <div className={styles.workspaceTileHeader}>
                              <span
                                className={styles.workspaceTileColor}
                                style={{ background: s.color || 'var(--accent)' }}
                                aria-hidden="true"
                              />
                              <div className={styles.workspaceTileContent}>
                                <div className={styles.workspaceTileName}>{s.name}</div>
                                <span
                                  className={`${styles.workspaceTileBadge} ${
                                    s.kind === 'agent'
                                      ? styles.workspaceTileBadgeAgent
                                      : styles.workspaceTileBadgeTerminal
                                  }`}
                                >
                                  {s.kind === 'agent' ? 'Agent' : 'Terminal'}
                                </span>
                              </div>
                            </div>
                            <div className={styles.workspaceTileCwd} title={s.cwd || '~'}>
                              {s.cwd || '~'}
                            </div>
                            {s.initialCommand && (
                              <div
                                className={styles.workspaceTileCommand}
                                title={s.initialCommand}
                              >
                                <span className={styles.workspaceTileMetaLabel}>cmd</span>
                                <code>{s.initialCommand}</code>
                              </div>
                            )}
                            {s.shell && (
                              <div className={styles.workspaceTileMeta}>
                                <span className={styles.workspaceTileMetaLabel}>shell</span>
                                <code>{s.shell}</code>
                              </div>
                            )}
                            {s.kind === 'agent' && s.agentId && (
                              <div className={styles.workspaceTileAgent}>{s.agentId}</div>
                            )}
                            <button
                              type="button"
                              className={styles.workspaceTileRemove}
                              onClick={() => removeSessionFromWorkspace(ws.id, s.id)}
                              aria-label={`Remove ${s.name} from ${ws.name}`}
                            >
                              ✕
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Legacy single-workspace startup toggle, kept for users who already
                set it up. The new "Auto-start" toggle on each named workspace is
                the preferred path. */}
            {prefs.startupWorkspace.sessions.length > 0 && (
              <div className={styles.row} style={{ marginTop: 16 }}>
                <span className={styles.rowLabel}>
                  Restore default startup
                  <span className={styles.rowHint}>
                    {prefs.startupWorkspace.sessions.length} session
                    {prefs.startupWorkspace.sessions.length === 1 ? '' : 's'} (legacy)
                  </span>
                </span>
                <Toggle
                  on={prefs.startupWorkspace.enabled}
                  ariaLabel="Toggle startup workspace"
                  onChange={(enabled) =>
                    setPreference('startupWorkspace', { ...prefs.startupWorkspace, enabled })
                  }
                />
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
                  confirm('Reset all preferences to defaults? This will sync to the server.')
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
      )}
    </div>
  );
}
