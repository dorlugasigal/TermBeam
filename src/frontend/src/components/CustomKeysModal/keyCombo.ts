/**
 * Encodes arbitrary keyboard combos (base key + Ctrl/Shift/Alt modifiers)
 * into the escape sequences a terminal expects on stdin. Supports
 * "nonsense" combos like F2+Ctrl+Y as best-effort — the generated
 * sequence may not do anything useful in your shell, but at least it's
 * a deterministic, well-formed sequence rather than nothing.
 *
 * Encoding follows the same conventions xterm uses (CSI / SS3 + the
 * `1+(shift?1:0)+(alt?2:0)+(ctrl?4:0)` modifier param).
 */

export type Modifiers = { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };

export interface BaseKeyOption {
  /** Stable identifier used in the dropdown */
  id: string;
  /** Human label */
  label: string;
  /** Group label for the optgroup */
  group: 'special' | 'function' | 'navigation' | 'letter' | 'digit' | 'symbol';
}

export const BASE_KEY_OPTIONS: BaseKeyOption[] = [
  // Special
  { id: 'Escape', label: 'Escape', group: 'special' },
  { id: 'Tab', label: 'Tab', group: 'special' },
  { id: 'Enter', label: 'Enter (↵)', group: 'special' },
  { id: 'Backspace', label: 'Backspace', group: 'special' },
  { id: 'Delete', label: 'Delete', group: 'special' },
  { id: 'Space', label: 'Space', group: 'special' },
  { id: 'Insert', label: 'Insert', group: 'special' },

  // Navigation
  { id: 'Up', label: '↑ Up', group: 'navigation' },
  { id: 'Down', label: '↓ Down', group: 'navigation' },
  { id: 'Right', label: '→ Right', group: 'navigation' },
  { id: 'Left', label: '← Left', group: 'navigation' },
  { id: 'Home', label: 'Home', group: 'navigation' },
  { id: 'End', label: 'End', group: 'navigation' },
  { id: 'PageUp', label: 'Page Up', group: 'navigation' },
  { id: 'PageDown', label: 'Page Down', group: 'navigation' },

  // Function keys
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `F${i + 1}`,
    label: `F${i + 1}`,
    group: 'function' as const,
  })),

  // Letters a-z
  ...Array.from({ length: 26 }, (_, i) => {
    const c = String.fromCharCode(97 + i);
    return { id: c, label: c.toUpperCase(), group: 'letter' as const };
  }),

  // Digits 0-9
  ...Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    label: String(i),
    group: 'digit' as const,
  })),

  // Common symbols
  ...['-', '=', '[', ']', "\\", ';', "'", ',', '.', '/', '`'].map((s) => ({
    id: s,
    label: s,
    group: 'symbol' as const,
  })),
];

const CSI_TILDE: Record<string, string> = {
  Insert: '2',
  Delete: '3',
  PageUp: '5',
  PageDown: '6',
  F5: '15',
  F6: '17',
  F7: '18',
  F8: '19',
  F9: '20',
  F10: '21',
  F11: '23',
  F12: '24',
};

const SS3_LETTER: Record<string, string> = {
  F1: 'P',
  F2: 'Q',
  F3: 'R',
  F4: 'S',
};

const CSI_LETTER: Record<string, string> = {
  Up: 'A',
  Down: 'B',
  Right: 'C',
  Left: 'D',
  Home: 'H',
  End: 'F',
};

/** Modifier parameter as defined in DEC PM 23 (xterm extension).
 *  Bit 0 = shift, bit 1 = alt, bit 2 = ctrl, bit 3 = meta/cmd. */
function modParam(m: Modifiers): number {
  return (
    1 + (m.shift ? 1 : 0) + (m.alt ? 2 : 0) + (m.ctrl ? 4 : 0) + (m.meta ? 8 : 0)
  );
}

/**
 * Encode a combo (base key + modifier set) into the escape sequence the
 * terminal will receive. Always returns *something* — even nonsense
 * combos produce well-formed CSI sequences.
 */
export function encodeCombo(baseKey: string, m: Modifiers): string {
  if (!baseKey) return '';

  const mod = modParam(m);

  // Tab special-cases Shift → CSI Z
  if (baseKey === 'Tab') {
    if (m.shift && !m.ctrl && !m.alt) return '\x1b[Z';
    return '\x09';
  }

  if (baseKey === 'Enter') return '\r';
  if (baseKey === 'Escape') return '\x1b';
  if (baseKey === 'Backspace') return '\x7f';
  if (baseKey === 'Space') return ' ';

  // CSI ~ form
  if (CSI_TILDE[baseKey]) {
    return mod === 1 ? `\x1b[${CSI_TILDE[baseKey]}~` : `\x1b[${CSI_TILDE[baseKey]};${mod}~`;
  }

  // SS3 form (F1-F4)
  if (SS3_LETTER[baseKey]) {
    return mod === 1 ? `\x1bO${SS3_LETTER[baseKey]}` : `\x1b[1;${mod}${SS3_LETTER[baseKey]}`;
  }

  // CSI letter form (arrows, Home, End)
  if (CSI_LETTER[baseKey]) {
    return mod === 1 ? `\x1b[${CSI_LETTER[baseKey]}` : `\x1b[1;${mod}${CSI_LETTER[baseKey]}`;
  }

  // Letter (single char a-z, A-Z)
  if (/^[a-zA-Z]$/.test(baseKey)) {
    const lower = baseKey.toLowerCase();
    if (m.ctrl) {
      const ctrlChar = String.fromCharCode(lower.charCodeAt(0) - 96);
      return m.alt ? '\x1b' + ctrlChar : ctrlChar;
    }
    const out = m.shift ? baseKey.toUpperCase() : lower;
    return m.alt ? '\x1b' + out : out;
  }

  // Digit / symbol — Ctrl on these is non-standard but we still emit
  // something deterministic for "nonsense" combos.
  if (m.alt) return '\x1b' + baseKey;
  return baseKey;
}

/** Try to recover the (baseKey, modifiers) tuple from an existing send
 * string. Returns null if the send doesn't match any known encoding —
 * in that case the UI keeps the raw `send` and the user can rebuild.
 */
export function decodeCombo(
  send: string,
): { baseKey: string; modifiers: Modifiers } | null {
  if (!send) return null;
  const empty: Modifiers = { ctrl: false, shift: false, alt: false, meta: false };

  // Direct matches
  if (send === '\r') return { baseKey: 'Enter', modifiers: empty };
  if (send === '\x1b') return { baseKey: 'Escape', modifiers: empty };
  if (send === '\x09') return { baseKey: 'Tab', modifiers: empty };
  if (send === '\x1b[Z') return { baseKey: 'Tab', modifiers: { ...empty, shift: true } };
  if (send === '\x7f') return { baseKey: 'Backspace', modifiers: empty };
  if (send === ' ') return { baseKey: 'Space', modifiers: empty };

  // CSI ~ form (with or without modifier)
  let match = send.match(/^\x1b\[(\d+)(?:;(\d+))?~$/);
  if (match) {
    const code = match[1];
    const modCode = match[2] ? parseInt(match[2], 10) : 1;
    const baseKey = Object.keys(CSI_TILDE).find((k) => CSI_TILDE[k] === code);
    if (baseKey) return { baseKey, modifiers: paramToMods(modCode) };
  }

  // SS3 form (F1-F4)
  match = send.match(/^\x1bO([PQRS])$/);
  if (match && match[1]) {
    const baseKey = Object.keys(SS3_LETTER).find((k) => SS3_LETTER[k] === match![1]);
    if (baseKey) return { baseKey, modifiers: empty };
  }
  match = send.match(/^\x1b\[1;(\d+)([PQRS])$/);
  if (match && match[1] && match[2]) {
    const baseKey = Object.keys(SS3_LETTER).find((k) => SS3_LETTER[k] === match![2]);
    if (baseKey) return { baseKey, modifiers: paramToMods(parseInt(match[1], 10)) };
  }

  // CSI letter form (arrows, Home, End)
  match = send.match(/^\x1b\[([ABCDHF])$/);
  if (match && match[1]) {
    const baseKey = Object.keys(CSI_LETTER).find((k) => CSI_LETTER[k] === match![1]);
    if (baseKey) return { baseKey, modifiers: empty };
  }
  match = send.match(/^\x1b\[1;(\d+)([ABCDHF])$/);
  if (match && match[1] && match[2]) {
    const baseKey = Object.keys(CSI_LETTER).find((k) => CSI_LETTER[k] === match![2]);
    if (baseKey) return { baseKey, modifiers: paramToMods(parseInt(match[1], 10)) };
  }

  // Single ASCII control char (Ctrl+letter)
  if (send.length === 1) {
    const code = send.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      return {
        baseKey: String.fromCharCode(code + 96),
        modifiers: { ctrl: true, shift: false, alt: false, meta: false },
      };
    }
    if (/^[a-zA-Z0-9\-=[\]\\;',./`]$/.test(send)) {
      return {
        baseKey: send.toLowerCase(),
        modifiers: {
          ctrl: false,
          shift: send !== send.toLowerCase(),
          alt: false,
          meta: false,
        },
      };
    }
  }

  // Alt+letter (\x1b + char)
  if (send.length === 2 && send[0] === '\x1b') {
    const c = send[1];
    if (!c) return null;
    const code = c.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      return {
        baseKey: String.fromCharCode(code + 96),
        modifiers: { ctrl: true, shift: false, alt: true, meta: false },
      };
    }
    if (/^[a-zA-Z0-9]$/.test(c)) {
      return {
        baseKey: c.toLowerCase(),
        modifiers: { ctrl: false, shift: c !== c.toLowerCase(), alt: true, meta: false },
      };
    }
  }

  return null;
}

function paramToMods(p: number): Modifiers {
  // Convention: param value − 1 packs shift|alt|ctrl|meta as bits 0|1|2|3
  const bits = p - 1;
  return {
    shift: (bits & 1) !== 0,
    alt: (bits & 2) !== 0,
    ctrl: (bits & 4) !== 0,
    meta: (bits & 8) !== 0,
  };
}

/** Render a send string as a human-readable preview (e.g. "ESC[1;5A"). */
export function describeSend(send: string): string {
  if (!send) return '∅';
  return send
    .replace(/\x1b/g, 'ESC')
    .replace(/\x09/g, 'TAB')
    .replace(/\r/g, 'CR')
    .replace(/\n/g, 'LF')
    .replace(/\x7f/g, 'DEL')
    .replace(/[\x00-\x1f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) + 64)}`);
}

/** Build a friendly human label like "Ctrl+Shift+F2" or "^C" or "Esc". */
export function describeCombo(baseKey: string, m: Modifiers): string {
  if (!baseKey) return '';
  const parts: string[] = [];
  if (m.ctrl) parts.push('Ctrl');
  if (m.alt) parts.push('Alt');
  if (m.shift) parts.push('Shift');
  if (m.meta) parts.push('Cmd');
  const niceBase = (() => {
    if (baseKey === 'Up') return '↑';
    if (baseKey === 'Down') return '↓';
    if (baseKey === 'Left') return '←';
    if (baseKey === 'Right') return '→';
    if (baseKey === 'Enter') return '↵';
    if (baseKey === 'Escape') return 'Esc';
    if (baseKey === 'Space') return '␣';
    if (baseKey === 'Backspace') return '⌫';
    if (baseKey === 'Delete') return '⌦';
    if (baseKey.length === 1) return baseKey.toUpperCase();
    return baseKey;
  })();
  parts.push(niceBase);
  return parts.join('+');
}
