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

function lookClass(style: TouchBarKey['style']): string {
  switch (style) {
    case 'special':
      return touchBarStyles.special ?? '';
    case 'modifier':
      return touchBarStyles.modifier ?? '';
    case 'icon':
      return touchBarStyles.iconBtn ?? '';
    case 'enter':
      return touchBarStyles.keyEnter ?? '';
    case 'danger':
      return touchBarStyles.keyDanger ?? '';
    default:
      return '';
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
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [sendTab, setSendTab] = useState<SendTab>('text');

  // Seed defaults when opening if user has no custom keys yet — mirrors the
  // exact live touchbar layout (14 grid keys + mic) so the customizer always
  // shows what the user actually sees today.
  useEffect(() => {
    if (open && prefs.touchBarKeys === null) {
      setPreference(
        'touchBarKeys',
        DEFAULT_TOUCHBAR_KEYS.map((k) => ({ ...k })),
      );
    }
  }, [open, prefs.touchBarKeys, setPreference]);

  useEffect(() => {
    if (!open) {
      setSelectedKeyIndex(null);
      setDraggedKeyIndex(null);
      setDropTargetIndex(null);
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
      setPreference('touchBarKeys', next);
    },
    [prefs.touchBarKeys, setPreference],
  );

  const addKey = useCallback(() => {
    const list = prefs.touchBarKeys ?? DEFAULT_TOUCHBAR_KEYS.map((k) => ({ ...k }));
    // Insert before the mic key if it exists (so mic stays at the end)
    const micIdx = list.findIndex((k) => k.action === 'mic');
    const newKey: TouchBarKey = {
      id: genKeyId(),
      label: 'Key',
      send: '',
      size: 1,
      style: 'default',
    };
    const next = [...list];
    if (micIdx >= 0) {
      next.splice(micIdx, 0, newKey);
      setPreference('touchBarKeys', next);
      setSelectedKeyIndex(micIdx);
    } else {
      next.push(newKey);
      setPreference('touchBarKeys', next);
      setSelectedKeyIndex(next.length - 1);
    }
  }, [prefs.touchBarKeys, setPreference]);

  const removeKey = useCallback(
    (idx: number) => {
      const list = prefs.touchBarKeys ?? [];
      const next = list.filter((_, i) => i !== idx);
      setPreference('touchBarKeys', next);
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
      setGhostPos(null);
    },
    [draggedKeyIndex, dropTargetIndex, customKeys, setPreference],
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
  });

  useEffect(() => {
    if (!selectedKey) return;
    const decoded = decodeCombo(selectedKey.send);
    if (decoded) {
      setComboBase(decoded.baseKey);
      setComboMods(decoded.modifiers);
    } else {
      setComboBase('');
      setComboMods({ ctrl: false, shift: false, alt: false });
    }
  }, [selectedKey?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyCombo = useCallback(
    (base: string, mods: Modifiers) => {
      if (selectedKeyIndex === null) return;
      setComboBase(base);
      setComboMods(mods);
      const send = encodeCombo(base, mods);
      const label = base ? describeCombo(base, mods) : selectedKey?.label ?? 'Key';
      updateKey(selectedKeyIndex, {
        send,
        action: undefined,
        // Auto-update the label to reflect the combo when the user is
        // building one — they can still override it in the Label field.
        ...(base ? { label: label.length > 8 ? label.slice(0, 8) : label } : {}),
      });
    },
    [selectedKeyIndex, selectedKey, updateKey],
  );

  if (!open) return null;

  const draggedKey = draggedKeyIndex !== null ? customKeys[draggedKeyIndex] : null;

  // Split for preview — same logic the live TouchBar uses
  const micPreviewIndex = customKeys.findIndex((k) => k.action === 'mic');
  const gridPreviewKeys = customKeys
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => k.action !== 'mic')
    .slice(0, 14);
  const row1 = gridPreviewKeys.slice(0, 7);
  const row2 = gridPreviewKeys.slice(7, 14);

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
                    const active = (selectedKey.style ?? 'default') === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className={`${styles.stylePill} ${active ? styles.stylePillActive : ''}`}
                        onClick={() => updateKey(selectedKeyIndex!, { style: opt.value })}
                      >
                        <span
                          className={`${touchBarStyles.keyBtn} ${lookClass(opt.value)} ${styles.styleSwatch}`}
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
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`${styles.segmentedBtn} ${
                        (selectedKey.size ?? 1) === n ? styles.segmentedBtnActive : ''
                      }`}
                      onClick={() => updateKey(selectedKeyIndex!, { size: n as 1 | 2 | 3 })}
                    >
                      {n === 1 ? '1×' : n === 2 ? '2×' : '3×'}
                    </button>
                  ))}
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
                    aria-label="Background color"
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
                    aria-label="Text color"
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
            <PreviewRow
              keys={row1}
              hasMicSlot={false}
              selectedKeyIndex={selectedKeyIndex}
              draggedKeyIndex={draggedKeyIndex}
              dropTargetIndex={dropTargetIndex}
              onSelect={setSelectedKeyIndex}
              onPointerDown={onKeyPreviewPointerDown}
              onPointerMove={onKeyPreviewPointerMove}
              onPointerUp={onKeyPreviewPointerUp}
            />
            <PreviewRow
              keys={row2}
              hasMicSlot={micPreviewIndex >= 0}
              micKey={micPreviewIndex >= 0 ? customKeys[micPreviewIndex] : undefined}
              micIndex={micPreviewIndex}
              selectedKeyIndex={selectedKeyIndex}
              draggedKeyIndex={draggedKeyIndex}
              dropTargetIndex={dropTargetIndex}
              onSelect={setSelectedKeyIndex}
              onPointerDown={onKeyPreviewPointerDown}
              onPointerMove={onKeyPreviewPointerMove}
              onPointerUp={onKeyPreviewPointerUp}
            />
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
  keys: { k: TouchBarKey; i: number }[];
  hasMicSlot: boolean;
  micKey?: TouchBarKey;
  micIndex?: number;
  selectedKeyIndex: number | null;
  draggedKeyIndex: number | null;
  dropTargetIndex: number | null;
  onSelect: (idx: number) => void;
  onPointerDown: (e: React.PointerEvent, idx: number) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

function PreviewRow({
  keys,
  hasMicSlot,
  micKey,
  micIndex,
  selectedKeyIndex,
  draggedKeyIndex,
  dropTargetIndex,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: PreviewRowProps) {
  return (
    <div className={`${styles.previewRow} ${hasMicSlot ? styles.previewRowWithMic : ''}`}>
      {keys.map(({ k, i }) => {
        const isDragged = draggedKeyIndex === i;
        const isDropTarget = dropTargetIndex === i && draggedKeyIndex !== null;
        return (
          <button
            key={k.id}
            type="button"
            data-key-index={i}
            className={[
              touchBarStyles.keyBtn,
              lookClass(k.style),
              styles.previewKey,
              selectedKeyIndex === i ? styles.previewKeySelected : '',
              isDragged ? styles.previewKeyDragging : '',
              isDropTarget ? styles.previewKeyDropTarget : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              gridColumn: `span ${k.size ?? 1}`,
              background: k.bg,
              color: k.color,
            }}
            onClick={() => onSelect(i)}
            onPointerDown={(e) => onPointerDown(e, i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {k.label}
          </button>
        );
      })}
      {hasMicSlot && micKey && typeof micIndex === 'number' && (
        <button
          type="button"
          data-key-index={micIndex}
          className={[
            touchBarStyles.keyBtn,
            touchBarStyles.special ?? '',
            styles.previewKey,
            styles.previewMic,
            selectedKeyIndex === micIndex ? styles.previewKeySelected : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            background: micKey.bg,
            color: micKey.color,
          }}
          onClick={() => onSelect(micIndex)}
        >
          <MicGlyph />
        </button>
      )}
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
