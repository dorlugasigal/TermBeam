import { useCallback, useEffect, useRef, useState } from 'react';
import {
  usePreferencesStore,
  type TouchBarKey,
  type KeyAction,
} from '@/stores/preferencesStore';
import touchBarStyles from '../TouchBar/TouchBar.module.css';
import { DEFAULT_TOUCHBAR_KEYS, KEY_LOOK_OPTIONS } from '../TouchBar/defaultKeys';
import {
  BASE_KEY_OPTIONS,
  decodeCombo,
  describeCombo,
  describeSend,
  encodeCombo,
  type Modifiers,
} from './keyCombo';
import styles from './CustomKeysModal.module.css';

interface CustomKeysModalProps {
  open: boolean;
  onClose: () => void;
}

type SendTab = 'text' | 'key' | 'action';

const ACTION_OPTIONS: { value: KeyAction; label: string; description: string }[] = [
  { value: 'mic', label: 'Microphone', description: 'Voice-to-text dictation' },
  { value: 'copy', label: 'Copy', description: 'Open select-to-copy overlay' },
  { value: 'paste', label: 'Paste', description: 'Paste clipboard contents' },
  { value: 'cancel', label: 'Cancel chat', description: 'Cancel running agent message' },
  { value: 'newline', label: 'Newline (chat)', description: 'Insert newline in chat input' },
];

function genKeyId(): string {
  return `k_${Math.random().toString(36).slice(2, 9)}`;
}

/** Collapse any empty rows and renumber the remaining ones to 1..N so the
 *  touchbar never has gaps (e.g. row 2 existing without row 1). Called after
 *  every mutation to keep the layout normalised — prevents phantom rows
 *  appearing in the live preview after drag/drop or delete. */
function pruneAndRenumberRows(keys: TouchBarKey[]): TouchBarKey[] {
  const usedRows = Array.from(new Set(keys.map((k) => k.row ?? 1))).sort(
    (a, b) => a - b,
  );
  const rowMap = new Map<number, number>();
  usedRows.forEach((r, i) => rowMap.set(r, i + 1));
  return keys.map((k) => {
    const oldRow = k.row ?? 1;
    const newRow = rowMap.get(oldRow) ?? 1;
    return newRow === oldRow ? k : { ...k, row: newRow };
  });
}

function lookClass(style: TouchBarKey['style']): string {
  switch (style) {
    case 'accent':
      return touchBarStyles.keyEnter ?? '';
    case 'danger':
      return touchBarStyles.keyDanger ?? '';
    case 'custom':
    case 'plain':
    default:
      return '';
  }
}

/** Inline preview style for swatches/active borders. For `custom`, fall
 *  back to the live key's bg/color or the default custom palette. */
function lookSwatchStyle(
  style: TouchBarKey['style'],
  key?: TouchBarKey | null,
): React.CSSProperties {
  if (style === 'custom') {
    return {
      background: key?.bg || '#3a3a3a',
      color: key?.color || '#ffffff',
    };
  }
  return {};
}

/** Border color for the *active* look pill so it visually echoes the
 *  preset's signature color. Returns undefined to keep the CSS default
 *  (used by `plain`). */
function lookActiveBorder(
  style: TouchBarKey['style'],
  key?: TouchBarKey | null,
): string | undefined {
  switch (style) {
    case 'accent':
      return 'var(--accent, #0078d4)';
    case 'danger':
      return '#f87171';
    case 'custom':
      return key?.bg || '#3a3a3a';
    case 'plain':
    default:
      return undefined;
  }
}

function detectSendTab(k: TouchBarKey): SendTab {
  if (k.action) return 'action';
  if (k.send && decodeCombo(k.send)) return 'key';
  return 'text';
}

function MicGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

export default function CustomKeysModal({ open, onClose }: CustomKeysModalProps) {
  const prefs = usePreferencesStore((s) => s.prefs);
  const setPreference = usePreferencesStore((s) => s.setPreference);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const [selectedKeyIndex, setSelectedKeyIndex] = useState<number | null>(null);
  const [draggedKeyIndex, setDraggedKeyIndex] = useState<number | null>(null);
  // Drop target can be either an existing key (its array index) OR a
  // specific empty slot identified by row + position within the row.
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [dropTargetRow, setDropTargetRow] = useState<number | null>(null);
  const [dropTargetSlotInRow, setDropTargetSlotInRow] = useState<number | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [sendTab, setSendTab] = useState<SendTab>('text');

  // Seed defaults when opening if user has no custom keys yet — mirrors the
  // exact live touchbar layout (14 grid keys + mic) so the customizer always
  // shows what the user actually sees today.
  useEffect(() => {
    if (open && prefs.touchBarKeys === null) {
      setPreference(
        'touchBarKeys',
        pruneAndRenumberRows(DEFAULT_TOUCHBAR_KEYS.map((k) => ({ ...k }))),
      );
    }
  }, [open, prefs.touchBarKeys, setPreference]);

  useEffect(() => {
    if (!open) {
      setSelectedKeyIndex(null);
      setDraggedKeyIndex(null);
      setDropTargetIndex(null);
      setDropTargetRow(null);
      setDropTargetSlotInRow(null);
      setGhostPos(null);
    } else {
      closeBtnRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouse);
    };
  }, [open, onClose]);

  const customKeys = prefs.touchBarKeys ?? [];
  const selectedKey = selectedKeyIndex !== null ? customKeys[selectedKeyIndex] : null;
  const isMicKey = selectedKey?.action === 'mic';

  // Auto-pick the right tab when selecting a key
  useEffect(() => {
    if (selectedKey) setSendTab(detectSendTab(selectedKey));
  }, [selectedKey?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const updateKey = useCallback(
    (idx: number, patch: Partial<TouchBarKey>) => {
      const list = prefs.touchBarKeys ?? [];
      const next = list.map((k, i) => (i === idx ? { ...k, ...patch } : k));
      setPreference('touchBarKeys', pruneAndRenumberRows(next));
    },
    [prefs.touchBarKeys, setPreference],
  );

  const addKey = useCallback(() => {
    const list = prefs.touchBarKeys ?? DEFAULT_TOUCHBAR_KEYS.map((k) => ({ ...k }));
    const COLS = 8;
    const MAX_ROWS = 3;

    // Find the first (row, col) slot that's not currently occupied by any
    // existing key (mic counted as occupying its declared col). Prefer
    // slot in an existing row before creating a new one. If all rows are
    // full and we're below MAX_ROWS, create a new row.
    const occupied: Record<number, Set<number>> = {};
    for (const k of list) {
      const r = Math.max(1, Math.min(MAX_ROWS, k.row ?? 1));
      const c = Math.max(1, Math.min(COLS, k.col ?? 1));
      const span = Math.max(1, Math.min(COLS, k.size ?? 1));
      if (!occupied[r]) occupied[r] = new Set();
      for (let cc = c; cc < c + span && cc <= COLS; cc += 1) {
        occupied[r].add(cc);
      }
    }

    let chosenRow: number | null = null;
    let chosenCol: number | null = null;
    for (let r = 1; r <= MAX_ROWS; r += 1) {
      const usedCols = occupied[r] ?? new Set<number>();
      if (usedCols.size === 0 && r > 1) {
        // empty row that doesn't exist yet — create here
        chosenRow = r;
        chosenCol = 1;
        break;
      }
      for (let c = 1; c <= COLS; c += 1) {
        if (!usedCols.has(c)) {
          chosenRow = r;
          chosenCol = c;
          break;
        }
      }
      if (chosenRow !== null) break;
    }

    if (chosenRow === null) {
      // All 3 rows × 8 cols are full — silently no-op (or could toast).
      return;
    }

    const newKey: TouchBarKey = {
      id: genKeyId(),
      label: 'Key',
      send: '',
      size: 1,
      style: 'plain',
      row: chosenRow,
      col: chosenCol ?? 1,
    };

    // Insert in array right before mic (if any) so mic stays last in the
    // serialized order; visual position is driven by row/col.
    const micIdx = list.findIndex((k) => k.action === 'mic');
    const next = [...list];
    if (micIdx >= 0) {
      next.splice(micIdx, 0, newKey);
      setPreference('touchBarKeys', pruneAndRenumberRows(next));
      setSelectedKeyIndex(micIdx);
    } else {
      next.push(newKey);
      setPreference('touchBarKeys', pruneAndRenumberRows(next));
      setSelectedKeyIndex(next.length - 1);
    }
  }, [prefs.touchBarKeys, setPreference]);

  const removeKey = useCallback(
    (idx: number) => {
      const list = prefs.touchBarKeys ?? [];
      const next = list.filter((_, i) => i !== idx);
      setPreference('touchBarKeys', pruneAndRenumberRows(next));
      if (selectedKeyIndex === idx) setSelectedKeyIndex(null);
      else if (selectedKeyIndex != null && selectedKeyIndex > idx)
        setSelectedKeyIndex(selectedKeyIndex - 1);
    },
    [prefs.touchBarKeys, setPreference, selectedKeyIndex],
  );

  const resetToDefaults = useCallback(() => {
    setPreference('touchBarKeys', null);
    setSelectedKeyIndex(null);
  }, [setPreference]);

  const onKeyPreviewPointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    setDraggedKeyIndex(idx);
    setGhostPos({ x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onKeyPreviewPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggedKeyIndex === null) return;
      setGhostPos({ x: e.clientX, y: e.clientY });
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target) return;
      // 1) Hovering directly on another key — swap target
      const previewKey = target.closest('[data-key-index]') as HTMLElement | null;
      if (previewKey) {
        const idx = parseInt(previewKey.dataset.keyIndex ?? '-1', 10);
        if (idx >= 0 && idx !== draggedKeyIndex) {
          setDropTargetIndex(idx);
          setDropTargetRow(null);
          return;
        }
      }
      // 2) Hovering on an empty placeholder slot — set the target row + col
      const slot = target.closest('[data-empty-slot-row]') as HTMLElement | null;
      if (slot) {
        const row = parseInt(slot.dataset.emptySlotRow ?? '-1', 10);
        const col = parseInt(slot.dataset.emptySlotCol ?? '-1', 10);
        if (row >= 1 && col >= 1) {
          setDropTargetIndex(null);
          setDropTargetRow(row);
          setDropTargetSlotInRow(col);
          return;
        }
      }
      // 3) Otherwise clear so a release here is a no-op
      setDropTargetIndex(null);
      setDropTargetRow(null);
      setDropTargetSlotInRow(null);
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
      const list = [...customKeys];
      const dragged = list[draggedKeyIndex];
      // Drop on another key — swap row + col so visually the keys swap
      // positions while keeping all other keys exactly where they were.
      if (dragged && dropTargetIndex !== null && dropTargetIndex !== draggedKeyIndex) {
        const target = list[dropTargetIndex];
        if (target) {
          const draggedRow = dragged.row ?? 1;
          const draggedCol = dragged.col ?? 1;
          const targetRow = target.row ?? 1;
          const targetCol = target.col ?? 1;
          list[draggedKeyIndex] = { ...dragged, row: targetRow, col: targetCol };
          list[dropTargetIndex] = { ...target, row: draggedRow, col: draggedCol };
          setPreference('touchBarKeys', pruneAndRenumberRows(list));
          setSelectedKeyIndex(draggedKeyIndex);
        }
      }
      // Drop on an empty slot — set the dragged key's row + col to that
      // exact slot, but clamp the target row so we never create a row that
      // sits beyond (currentMaxRow + 1) or pushes total rows past 3.
      // pruneAndRenumberRows then collapses any newly-empty source row.
      else if (dragged && dropTargetRow !== null && dropTargetSlotInRow !== null) {
        const otherRows = list
          .filter((_, i) => i !== draggedKeyIndex)
          .map((k) => k.row ?? 1);
        const currentMaxRow = otherRows.length > 0 ? Math.max(...otherRows) : 0;
        const maxAllowedRow = Math.min(currentMaxRow + 1, 3);
        let targetRow = dropTargetRow;
        if (targetRow > maxAllowedRow) targetRow = maxAllowedRow;
        if (targetRow < 1) targetRow = 1;
        let targetCol = dropTargetSlotInRow;
        if (targetCol < 1) targetCol = 1;
        if (targetCol > 8) targetCol = 8;
        list[draggedKeyIndex] = {
          ...dragged,
          row: targetRow,
          col: targetCol,
        };
        setPreference('touchBarKeys', pruneAndRenumberRows(list));
        setSelectedKeyIndex(draggedKeyIndex);
      }
      setDraggedKeyIndex(null);
      setDropTargetIndex(null);
      setDropTargetRow(null);
      setDropTargetSlotInRow(null);
      setGhostPos(null);
    },
    [
      draggedKeyIndex,
      dropTargetIndex,
      dropTargetRow,
      dropTargetSlotInRow,
      customKeys,
      setPreference,
    ],
  );

  // Combo-builder state for the "Key combo" tab. Modifiers + base key are
  // tracked locally and re-encoded into the key's `send` field whenever
  // either changes. We seed from the current key's send when a key is
  // selected so editing an existing combo round-trips.
  const [comboBase, setComboBase] = useState<string>('');
  const [comboMods, setComboMods] = useState<Modifiers>({
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  });

  useEffect(() => {
    if (!selectedKey) return;
    const decoded = decodeCombo(selectedKey.send);
    if (decoded) {
      setComboBase(decoded.baseKey);
      setComboMods(decoded.modifiers);
    } else {
      setComboBase('');
      setComboMods({ ctrl: false, shift: false, alt: false, meta: false });
    }
  }, [selectedKey?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyCombo = useCallback(
    (base: string, mods: Modifiers) => {
      if (selectedKeyIndex === null) return;
      setComboBase(base);
      setComboMods(mods);
      const send = encodeCombo(base, mods);
      // Label is purely user-controlled — never auto-overwrite it from
      // the combo builder.
      updateKey(selectedKeyIndex, {
        send,
        action: undefined,
      });
    },
    [selectedKeyIndex, updateKey],
  );

  if (!open) return null;

  const draggedKey = draggedKeyIndex !== null ? customKeys[draggedKeyIndex] : null;

  // Split for preview — group keys by their explicit `row` field so the
  // preview only ever shows rows that contain at least one key. Empty
  // rows are intentionally not rendered (even during drag) — that used to
  // create phantom rows where the dragged key would visually appear in
  // the wrong row. Use "+ Add key" to create a new row instead.
  const micPreviewIndex = customKeys.findIndex((k) => k.action === 'mic');
  const rowsForPreview: Array<{ row: number; entries: { k: TouchBarKey; i: number }[] }> = [];
  for (const r of [1, 2, 3] as const) {
    const entries: { k: TouchBarKey; i: number }[] = [];
    customKeys.forEach((k, i) => {
      if ((k.row ?? 1) !== r) return;
      entries.push({ k, i });
    });
    if (entries.length > 0) rowsForPreview.push({ row: r, entries });
  }
  // Sort by row number.
  rowsForPreview.sort((a, b) => a.row - b.row);

  return (
    <>
      <div className={styles.backdrop} aria-hidden="true" />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-label="Customize Touch Bar"
        aria-modal="true"
      >
        <div className={styles.header}>
          <span className={styles.title}>Customize Touch Bar</span>
          <button
            ref={closeBtnRef}
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {selectedKey ? (
            <div className={styles.editorPanel}>
              <div className={styles.editorHeader}>
                <span className={styles.editorTitle}>
                  Edit key{' '}
                  {isMicKey && <span className={styles.micEditBadge}>microphone</span>}
                </span>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setSelectedKeyIndex(null)}
                >
                  Done
                </button>
              </div>

              <div className={styles.editorRow}>
                <label className={styles.editorLabel}>Label</label>
                <input
                  type="text"
                  className={styles.input}
                  value={selectedKey.label}
                  maxLength={8}
                  disabled={isMicKey}
                  onChange={(e) => updateKey(selectedKeyIndex!, { label: e.target.value })}
                />
              </div>

              {!isMicKey && (
                <div className={styles.editorRow}>
                  <label className={styles.editorLabel}>Sends</label>
                  <div className={styles.sendPicker}>
                    <div className={styles.tabBar} role="tablist">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={sendTab === 'text'}
                        className={`${styles.tab} ${sendTab === 'text' ? styles.tabActive : ''}`}
                        onClick={() => setSendTab('text')}
                      >
                        Text
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={sendTab === 'key'}
                        className={`${styles.tab} ${sendTab === 'key' ? styles.tabActive : ''}`}
                        onClick={() => setSendTab('key')}
                      >
                        Key combo
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={sendTab === 'action'}
                        className={`${styles.tab} ${sendTab === 'action' ? styles.tabActive : ''}`}
                        onClick={() => setSendTab('action')}
                      >
                        Action
                      </button>
                    </div>

                    {sendTab === 'text' && (
                      <div className={styles.tabPanel}>
                        <input
                          type="text"
                          className={styles.input}
                          value={selectedKey.action ? '' : selectedKey.send}
                          placeholder="e.g. git status"
                          onChange={(e) =>
                            updateKey(selectedKeyIndex!, {
                              send: e.target.value,
                              action: undefined,
                            })
                          }
                        />
                        <p className={styles.hint}>
                          Sent as plain text. Add <code>\r</code> at the end to press Enter
                          automatically.
                        </p>
                      </div>
                    )}

                    {sendTab === 'key' && (
                      <div className={styles.tabPanel}>
                        <div className={styles.modRow}>
                          <ModCheck
                            label="Ctrl"
                            checked={comboMods.ctrl}
                            onChange={(v) =>
                              applyCombo(comboBase, { ...comboMods, ctrl: v })
                            }
                          />
                          <ModCheck
                            label="Shift"
                            checked={comboMods.shift}
                            onChange={(v) =>
                              applyCombo(comboBase, { ...comboMods, shift: v })
                            }
                          />
                          <ModCheck
                            label="Alt"
                            checked={comboMods.alt}
                            onChange={(v) =>
                              applyCombo(comboBase, { ...comboMods, alt: v })
                            }
                          />
                          <ModCheck
                            label="Cmd"
                            checked={comboMods.meta}
                            onChange={(v) =>
                              applyCombo(comboBase, { ...comboMods, meta: v })
                            }
                          />
                        </div>
                        <select
                          className={styles.input}
                          value={comboBase}
                          onChange={(e) => applyCombo(e.target.value, comboMods)}
                        >
                          <option value="">— Pick a key —</option>
                          <BaseKeyGroup label="Special" group="special" />
                          <BaseKeyGroup label="Navigation" group="navigation" />
                          <BaseKeyGroup label="Function keys" group="function" />
                          <BaseKeyGroup label="Letters" group="letter" />
                          <BaseKeyGroup label="Digits" group="digit" />
                          <BaseKeyGroup label="Symbols" group="symbol" />
                        </select>
                        {comboBase ? (
                          <div className={styles.comboPreview}>
                            <div className={styles.comboHuman}>
                              {describeCombo(comboBase, comboMods)}
                            </div>
                            <div className={styles.comboSeq}>
                              <span className={styles.comboSeqLabel}>sends</span>
                              <code>{describeSend(encodeCombo(comboBase, comboMods))}</code>
                            </div>
                          </div>
                        ) : (
                          <p className={styles.hint}>
                            Combine any base key with Ctrl / Shift / Alt — even nonsense
                            combos like F2+Ctrl+Y produce a deterministic CSI sequence.
                          </p>
                        )}
                      </div>
                    )}

                    {sendTab === 'action' && (
                      <div className={styles.tabPanel}>
                        <select
                          className={styles.input}
                          value={selectedKey.action ?? ''}
                          onChange={(e) =>
                            updateKey(selectedKeyIndex!, {
                              action: (e.target.value || undefined) as KeyAction | undefined,
                              send: '',
                            })
                          }
                        >
                          <option value="">— Choose an action —</option>
                          {ACTION_OPTIONS.map((a) => (
                            <option key={a.value} value={a.value}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                        {selectedKey.action && (
                          <p className={styles.hint}>
                            {ACTION_OPTIONS.find((a) => a.value === selectedKey.action)
                              ?.description ?? ''}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.editorRow}>
                <label className={styles.editorLabel}>Look</label>
                <div className={styles.styleGrid}>
                  {KEY_LOOK_OPTIONS.map((opt) => {
                    const active = (selectedKey.style ?? 'plain') === opt.value;
                    const activeBorder = active
                      ? lookActiveBorder(opt.value, selectedKey)
                      : undefined;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        title={opt.description}
                        aria-pressed={active}
                        className={`${styles.stylePill} ${active ? styles.stylePillActive : ''}`}
                        style={activeBorder ? { borderColor: activeBorder } : undefined}
                        onClick={() => {
                          if (opt.value === 'custom') {
                            const patch: Partial<TouchBarKey> = { style: 'custom' };
                            if (!selectedKey.bg) patch.bg = '#3a3a3a';
                            if (!selectedKey.color) patch.color = '#ffffff';
                            updateKey(selectedKeyIndex!, patch);
                          } else {
                            updateKey(selectedKeyIndex!, {
                              style: opt.value,
                              bg: undefined,
                              color: undefined,
                            });
                          }
                        }}
                      >
                        <span
                          className={`${touchBarStyles.keyBtn} ${lookClass(opt.value)} ${styles.styleSwatch}`}
                          style={lookSwatchStyle(opt.value, selectedKey)}
                          aria-hidden="true"
                        >
                          A
                        </span>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.editorRow}>
                <label className={styles.editorLabel}>Width</label>
                <div className={styles.segmentedControl}>
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`${styles.segmentedBtn} ${
                        (selectedKey.size ?? 1) === n ? styles.segmentedBtnActive : ''
                      }`}
                      onClick={() =>
                        updateKey(selectedKeyIndex!, { size: n as 1 | 2 | 3 | 4 })
                      }
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              </div>

              {selectedKey.style === 'custom' && (
                <>
                  <div className={styles.editorRow}>
                    <label className={styles.editorLabel}>Background</label>
                    <div className={styles.colorRow}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={selectedKey.bg || '#3a3a3a'}
                        onChange={(e) =>
                          updateKey(selectedKeyIndex!, { bg: e.target.value })
                        }
                        aria-label="Background color"
                      />
                      <button
                        type="button"
                        className={styles.resetBtn}
                        onClick={() => updateKey(selectedKeyIndex!, { bg: '#3a3a3a' })}
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
                        onChange={(e) =>
                          updateKey(selectedKeyIndex!, { color: e.target.value })
                        }
                        aria-label="Text color"
                      />
                      <button
                        type="button"
                        className={styles.resetBtn}
                        onClick={() => updateKey(selectedKeyIndex!, { color: '#ffffff' })}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </>
              )}

              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => removeKey(selectedKeyIndex!)}
              >
                Delete this key
              </button>
            </div>
          ) : (
            <div className={styles.hintPanel}>
              <p className={styles.hint}>
                This is your live Touch Bar. Tap any key to edit it, drag to reorder, or click
                <strong> + Add key </strong>to insert a new one. The microphone is included so
                you can recolor or remove it like any other key.
              </p>
            </div>
          )}

          {customKeys.length === 0 && (
            <p className={styles.empty}>No keys configured. Click + Add key or Reset to defaults.</p>
          )}
        </div>

        <div className={styles.previewSection}>
          <div className={styles.previewHeader}>
            <span className={styles.previewLabel}>Live preview</span>
            <span className={styles.previewCount}>
              {customKeys.length} {customKeys.length === 1 ? 'key' : 'keys'}
            </span>
          </div>
          <div className={styles.previewStack}>
            {rowsForPreview.map(({ row, entries }) => {
              const rowMicIndex =
                row === (customKeys[micPreviewIndex]?.row ?? 2) ? micPreviewIndex : -1;
              return (
                <PreviewRow
                  key={`row-${row}`}
                  row={row}
                  keys={entries}
                  hasMicSlot={rowMicIndex >= 0}
                  micKey={rowMicIndex >= 0 ? customKeys[rowMicIndex] : undefined}
                  micIndex={rowMicIndex >= 0 ? rowMicIndex : undefined}
                  selectedKeyIndex={selectedKeyIndex}
                  draggedKeyIndex={draggedKeyIndex}
                  dropTargetIndex={dropTargetIndex}
                  dropTargetRow={dropTargetRow}
                  dropTargetSlotInRow={dropTargetSlotInRow}
                  onSelect={setSelectedKeyIndex}
                  onPointerDown={onKeyPreviewPointerDown}
                  onPointerMove={onKeyPreviewPointerMove}
                  onPointerUp={onKeyPreviewPointerUp}
                />
              );
            })}
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.secondaryBtn} onClick={addKey}>
            + Add key
          </button>
          <button type="button" className={styles.linkBtn} onClick={resetToDefaults}>
            Reset to defaults
          </button>
        </div>
      </div>
      {draggedKey && ghostPos && (
        <div
          className={`${touchBarStyles.keyBtn} ${lookClass(draggedKey.style)} ${styles.dragGhost}`}
          style={{
            left: ghostPos.x,
            top: ghostPos.y,
            background: draggedKey.bg,
            color: draggedKey.color,
          }}
          aria-hidden="true"
        >
          {draggedKey.action === 'mic' ? <MicGlyph /> : draggedKey.label}
        </div>
      )}
    </>
  );
}

interface PreviewRowProps {
  /** Row number this row represents (1 or 2). Used for empty-slot drop targets. */
  row: number;
  keys: { k: TouchBarKey; i: number }[];
  hasMicSlot: boolean;
  micKey?: TouchBarKey;
  micIndex?: number;
  selectedKeyIndex: number | null;
  draggedKeyIndex: number | null;
  dropTargetIndex: number | null;
  dropTargetRow: number | null;
  dropTargetSlotInRow: number | null;
  onSelect: (idx: number) => void;
  onPointerDown: (e: React.PointerEvent, idx: number) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

function PreviewRow({
  row,
  keys,
  hasMicSlot,
  micKey,
  micIndex,
  selectedKeyIndex,
  draggedKeyIndex,
  dropTargetIndex,
  dropTargetRow,
  dropTargetSlotInRow,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: PreviewRowProps) {
  const COLS = 8;
  // Build a per-col map: which key/mic occupies each col (and how many
  // cols it spans). Empty cols become drop slots.
  type Cell =
    | { kind: 'key'; idx: number; k: TouchBarKey; spanStart: number }
    | { kind: 'mic'; idx: number; k: TouchBarKey }
    | { kind: 'slot'; col: number };
  const cells: Cell[] = [];
  const occupied = new Array<boolean>(COLS + 1).fill(false);
  // Place keys
  for (const { k, i } of keys) {
    const col = Math.max(1, Math.min(COLS, k.col ?? 1));
    const span = Math.max(1, Math.min(COLS, k.size ?? 1));
    if (occupied[col]) continue; // collision — skip silently
    for (let c = col; c < col + span && c <= COLS; c += 1) occupied[c] = true;
    cells.push({ kind: 'key', idx: i, k, spanStart: col });
  }
  // Place mic at its declared col (default 8)
  if (hasMicSlot && micKey && typeof micIndex === 'number') {
    const col = Math.max(1, Math.min(COLS, micKey.col ?? 8));
    if (!occupied[col]) {
      occupied[col] = true;
      cells.push({ kind: 'mic', idx: micIndex, k: micKey });
    }
  }
  // Fill remaining cols with slot drop targets
  for (let c = 1; c <= COLS; c += 1) {
    if (!occupied[c]) cells.push({ kind: 'slot', col: c });
  }

  return (
    <div className={styles.previewRow}>
      {cells.map((cell) => {
        if (cell.kind === 'slot') {
          const isActiveDrop =
            dropTargetRow === row && dropTargetSlotInRow === cell.col;
          return (
            <div
              key={`slot-${cell.col}`}
              className={`${styles.previewSlot} ${isActiveDrop ? styles.previewSlotActive : ''}`}
              data-empty-slot-row={row}
              data-empty-slot-col={cell.col}
              style={{ gridColumn: `${cell.col} / span 1` }}
              aria-hidden="true"
            />
          );
        }
        if (cell.kind === 'mic') {
          const k = cell.k;
          const col = Math.max(1, Math.min(COLS, k.col ?? 8));
          return (
            <button
              key={k.id}
              type="button"
              data-key-index={cell.idx}
              className={[
                touchBarStyles.keyBtn,
                touchBarStyles.special ?? '',
                styles.previewKey,
                styles.previewMic,
                selectedKeyIndex === cell.idx ? styles.previewKeySelected : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                gridColumn: `${col} / span 1`,
                background: k.bg,
                color: k.color,
              }}
              onClick={() => onSelect(cell.idx)}
              onPointerDown={(e) => onPointerDown(e, cell.idx)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <MicGlyph />
            </button>
          );
        }
        // kind === 'key'
        const k = cell.k;
        const isDragged = draggedKeyIndex === cell.idx;
        const isDropTarget =
          dropTargetIndex === cell.idx && draggedKeyIndex !== null;
        return (
          <button
            key={k.id}
            type="button"
            data-key-index={cell.idx}
            className={[
              touchBarStyles.keyBtn,
              lookClass(k.style),
              styles.previewKey,
              selectedKeyIndex === cell.idx ? styles.previewKeySelected : '',
              isDragged ? styles.previewKeyDragging : '',
              isDropTarget ? styles.previewKeyDropTarget : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              gridColumn: `${cell.spanStart} / span ${k.size ?? 1}`,
              background: k.bg,
              color: k.color,
            }}
            onClick={() => onSelect(cell.idx)}
            onPointerDown={(e) => onPointerDown(e, cell.idx)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {k.label || '\u00A0'}
          </button>
        );
      })}
    </div>
  );
}

function ModCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`${styles.modPill} ${checked ? styles.modPillActive : ''}`}
      onClick={() => onChange(!checked)}
    >
      {label}
    </button>
  );
}

function BaseKeyGroup({
  label,
  group,
}: {
  label: string;
  group: 'special' | 'function' | 'navigation' | 'letter' | 'digit' | 'symbol';
}) {
  const opts = BASE_KEY_OPTIONS.filter((o) => o.group === group);
  return (
    <optgroup label={label}>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </optgroup>
  );
}
