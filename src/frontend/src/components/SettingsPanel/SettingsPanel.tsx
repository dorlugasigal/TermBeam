import { useEffect, useCallback, useRef, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import {
  usePreferencesStore,
  PREF_DEFAULTS,
  type TouchBarKey,
  type StartupSession,
} from '@/stores/preferencesStore';
import { THEMES } from '@/themes/terminalThemes';
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser';
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
  { id: 'up', label: '↑', send: '\x1b[A' },
  { id: 'enter', label: '↵', send: '\r' },
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
  const openThemePicker = useUIStore((s) => s.openThemePicker);
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

  // FIX #5: custom key editor state
  const [selectedKeyIndex, setSelectedKeyIndex] = useState<number | null>(null);
  const [draggedKeyIndex, setDraggedKeyIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Reset drag offset when closed
  useEffect(() => {
    if (!open) {
      setDragOffset(null);
      setBrowsingFolder(false);
      setSelectedKeyIndex(null);
      setDraggedKeyIndex(null);
      setDropTargetIndex(null);
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

  // FIX #4: save current workspace
  const saveWorkspace = useCallback(() => {
    const allSessions = Array.from(sessions.values()).filter((s) => !s.hidden);
    const snapshotSessions: StartupSession[] = allSessions.map((s) => ({
      id: s.id,
      name: s.name,
      kind: (s.type === 'copilot' || s.type === 'agent' ? 'agent' : 'shell') as 'shell' | 'agent',
      cwd: s.cwd || '',
      initialCommand: '',
      agentId: s.type === 'copilot' || s.type === 'agent' ? s.model : undefined,
    }));
    setPreference('startupWorkspace', { enabled: true, sessions: snapshotSessions });
    setSaveToast(`Saved (${snapshotSessions.length} sessions)`);
    setTimeout(() => setSaveToast(''), 2000);
  }, [sessions, setPreference]);

  const removeStartupSession = useCallback(
    (idx: number) => {
      const sessions = prefs.startupWorkspace.sessions.filter((_, i) => i !== idx);
      setPreference('startupWorkspace', { ...prefs.startupWorkspace, sessions });
    },
    [prefs.startupWorkspace, setPreference],
  );

  // FIX #5: custom keys helpers
  const customKeys = prefs.touchBarKeys ?? [];
  const usingCustomKeys = prefs.touchBarKeys !== null;

  const enableCustomKeys = useCallback(() => {
    setPreference('touchBarKeys', [...DEFAULT_KEYS_PREVIEW]);
  }, [setPreference]);

  const resetCustomKeys = useCallback(() => {
    setPreference('touchBarKeys', null);
    setSelectedKeyIndex(null);
  }, [setPreference]);

  const addKey = useCallback(() => {
    const list = prefs.touchBarKeys ?? [...DEFAULT_KEYS_PREVIEW];
    const next: TouchBarKey[] = [...list, { id: genKeyId(), label: 'Key', send: '', size: 1 }];
    setPreference('touchBarKeys', next);
    setSelectedKeyIndex(next.length - 1);
  }, [prefs.touchBarKeys, setPreference]);

  const updateKey = useCallback(
    (idx: number, patch: Partial<TouchBarKey>) => {
      const list = prefs.touchBarKeys ?? [];
      const next = list.map((k, i) => (i === idx ? { ...k, ...patch } : k));
      setPreference('touchBarKeys', next);
    },
    [prefs.touchBarKeys, setPreference],
  );

  const removeKey = useCallback(
    (idx: number) => {
      const list = prefs.touchBarKeys ?? [];
      const next = list.filter((_, i) => i !== idx);
      setPreference('touchBarKeys', next);
      if (selectedKeyIndex === idx) setSelectedKeyIndex(null);
      if (selectedKeyIndex != null && selectedKeyIndex > idx) setSelectedKeyIndex(selectedKeyIndex - 1);
    },
    [prefs.touchBarKeys, setPreference, selectedKeyIndex],
  );

  const onKeyPreviewPointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    setDraggedKeyIndex(idx);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onKeyPreviewPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggedKeyIndex === null) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target) return;
      const previewKey = target.closest('[data-key-index]') as HTMLElement | null;
      if (previewKey) {
        const idx = parseInt(previewKey.dataset.keyIndex ?? '-1', 10);
        if (idx >= 0 && idx !== draggedKeyIndex) setDropTargetIndex(idx);
      }
    },
    [draggedKeyIndex],
  );

  const onKeyPreviewPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (draggedKeyIndex === null) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (dropTargetIndex !== null && dropTargetIndex !== draggedKeyIndex) {
        const list = [...customKeys];
        const [dragged] = list.splice(draggedKeyIndex, 1);
        if (dragged) {
          list.splice(dropTargetIndex, 0, dragged);
          setPreference('touchBarKeys', list);
          setSelectedKeyIndex(dropTargetIndex);
        }
      }
      setDraggedKeyIndex(null);
      setDropTargetIndex(null);
    },
    [draggedKeyIndex, dropTargetIndex, customKeys, setPreference],
  );

  if (!open) return null;

  // FIX #1: panel style conditional on dragOffset
  const panelStyle: React.CSSProperties = dragOffset
    ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`, top: 0, left: 0 }
    : {}; // CSS class handles centering

  const selectedKey = selectedKeyIndex !== null ? customKeys[selectedKeyIndex] : null;

  return (
    <div
      ref={panelRef}
      className={`${styles.panel} ${dragging ? styles.dragging : ''} ${!dragOffset ? styles.panelCentered : ''}`}
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
              {usingCustomKeys ? (
                <button type="button" className={styles.linkBtn} onClick={resetCustomKeys}>
                  Reset to defaults
                </button>
              ) : (
                <button type="button" className={styles.linkBtn} onClick={enableCustomKeys}>
                  Customize
                </button>
              )}
            </div>

            {/* FIX #5: visual key editor */}
            {usingCustomKeys && (
              <div className={styles.keyboardEditor}>
                {/* Preview grid */}
                <div className={styles.keyboardPreview}>
                  {customKeys.map((k, i) => (
                    <button
                      key={k.id}
                      type="button"
                      data-key-index={i}
                      className={`${styles.previewKey} ${selectedKeyIndex === i ? styles.previewKeySelected : ''} ${draggedKeyIndex === i ? styles.previewKeyDragging : ''}`}
                      style={{
                        gridColumn: `span ${k.size ?? 1}`,
                        background: k.bg,
                        color: k.color,
                      }}
                      onClick={() => setSelectedKeyIndex(i)}
                      onPointerDown={(e) => onKeyPreviewPointerDown(e, i)}
                      onPointerMove={onKeyPreviewPointerMove}
                      onPointerUp={onKeyPreviewPointerUp}
                      onPointerCancel={onKeyPreviewPointerUp}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>

                <button type="button" className={styles.linkBtn} onClick={addKey}>
                  + Add key
                </button>

                {/* Editor for selected key */}
                {selectedKey && (
                  <div className={styles.keyEditorPanel}>
                    <div className={styles.editorRow}>
                      <label className={styles.editorLabel}>Label</label>
                      <input
                        type="text"
                        className={styles.keyInput}
                        value={selectedKey.label}
                        maxLength={8}
                        onChange={(e) => updateKey(selectedKeyIndex!, { label: e.target.value })}
                      />
                    </div>
                    <div className={styles.editorRow}>
                      <label className={styles.editorLabel}>Send</label>
                      <input
                        type="text"
                        className={styles.keyInput}
                        value={selectedKey.send}
                        placeholder="e.g. \\x1b"
                        onChange={(e) => updateKey(selectedKeyIndex!, { send: e.target.value })}
                      />
                    </div>
                    <div className={styles.editorRow}>
                      <label className={styles.editorLabel}>Size</label>
                      <div className={styles.segmentedControl}>
                        <button
                          type="button"
                          className={`${styles.segmentedBtn} ${(selectedKey.size ?? 1) === 1 ? styles.segmentedBtnActive : ''}`}
                          onClick={() => updateKey(selectedKeyIndex!, { size: 1 })}
                        >
                          Single
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentedBtn} ${selectedKey.size === 2 ? styles.segmentedBtnActive : ''}`}
                          onClick={() => updateKey(selectedKeyIndex!, { size: 2 })}
                        >
                          Double
                        </button>
                      </div>
                    </div>
                    <div className={styles.editorRow}>
                      <label className={styles.editorLabel}>Background</label>
                      <div className={styles.colorRow}>
                        <input
                          type="color"
                          className={styles.colorInput}
                          value={selectedKey.bg || '#000000'}
                          onChange={(e) => updateKey(selectedKeyIndex!, { bg: e.target.value })}
                        />
                        <span
                          className={styles.colorSwatch}
                          style={{ background: selectedKey.bg || 'var(--bg)' }}
                        />
                        <button
                          type="button"
                          className={styles.resetBtn}
                          onClick={() => updateKey(selectedKeyIndex!, { bg: undefined })}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <div className={styles.editorRow}>
                      <label className={styles.editorLabel}>Text color</label>
                      <div className={styles.colorRow}>
                        <input
                          type="color"
                          className={styles.colorInput}
                          value={selectedKey.color || '#ffffff'}
                          onChange={(e) => updateKey(selectedKeyIndex!, { color: e.target.value })}
                        />
                        <span
                          className={styles.colorSwatch}
                          style={{ background: selectedKey.color || 'var(--text)' }}
                        />
                        <button
                          type="button"
                          className={styles.resetBtn}
                          onClick={() => updateKey(selectedKeyIndex!, { color: undefined })}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.dangerBtn}
                      onClick={() => removeKey(selectedKeyIndex!)}
                    >
                      Delete key
                    </button>
                  </div>
                )}

                {customKeys.length === 0 && (
                  <p className={styles.empty}>No custom keys. Click Add key to start customizing.</p>
                )}
              </div>
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

            <button type="button" className={styles.primaryBtn} onClick={saveWorkspace}>
              Save current as workspace
            </button>

            {saveToast && <div className={styles.saveToast}>{saveToast}</div>}

            <div className={styles.row} style={{ marginTop: 12 }}>
              <span className={styles.rowLabel}>
                Restore on startup
                <span className={styles.rowHint}>Re-open these sessions when TermBeam starts</span>
              </span>
              <Toggle
                on={prefs.startupWorkspace.enabled}
                ariaLabel="Toggle startup workspace"
                onChange={(enabled) =>
                  setPreference('startupWorkspace', { ...prefs.startupWorkspace, enabled })
                }
              />
            </div>

            {prefs.startupWorkspace.sessions.length === 0 ? (
              <p className={styles.empty}>
                No sessions saved yet. Open some sessions and click Save current as workspace.
              </p>
            ) : (
              <div className={styles.workspaceTileGrid}>
                {prefs.startupWorkspace.sessions.map((s, i) => (
                  <div key={s.id} className={styles.workspaceTile}>
                    <div className={styles.workspaceTileIcon}>
                      {s.kind === 'agent' ? '🤖' : '🖥'}
                    </div>
                    <div className={styles.workspaceTileContent}>
                      <div className={styles.workspaceTileName}>{s.name}</div>
                      <div className={styles.workspaceTileCwd}>
                        {s.cwd.length > 24 ? `…${s.cwd.slice(-24)}` : s.cwd || '~'}
                      </div>
                      {s.agentId && <div className={styles.workspaceTileAgent}>{s.agentId}</div>}
                    </div>
                    <button
                      type="button"
                      className={styles.workspaceTileRemove}
                      onClick={() => removeStartupSession(i)}
                      aria-label={`Remove ${s.name} from workspace`}
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
