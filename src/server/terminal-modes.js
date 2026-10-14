/**
 * Tracks the DEC private modes (CSI ? Pm h / CSI ? Pm l) a terminal app has
 * switched on, so a client that re-attaches can be restored to the exact
 * same *input* state — even after the original escape sequences have been
 * trimmed out of the replay buffer.
 *
 * Why this matters: full-screen TUIs such as GitHub Copilot CLI enter the
 * alternate screen and enable mouse tracking (?1003h + ?1006h) once, at
 * startup. Re-attaching clients reset their xterm.js instance and replay the
 * (bounded) scrollback; on long sessions those bytes are gone, so mouse
 * tracking silently stays off. xterm.js then converts wheel/touch scrolling
 * in the alternate buffer into Up/Down arrow keys — which the app interprets
 * as prompt-history navigation instead of scrolling its transcript.
 *
 * Semantics mirror xterm.js: mouse tracking protocols (9/1000/1002/1003) are
 * mutually exclusive and resetting any of them disables tracking; mouse
 * encodings (1005/1006/1015/1016) likewise.
 */

const MOUSE_PROTOCOLS = new Set([9, 1000, 1002, 1003]);
const MOUSE_ENCODINGS = new Set([1005, 1006, 1015, 1016]);
const ALT_SCREEN_MODES = new Set([47, 1047, 1049]);

// Simple on/off modes worth restoring, with their power-on defaults:
//   1    DECCKM — application cursor keys (arrows send ESC O A vs ESC [ A)
//   7    DECAWM — auto-wrap
//   25   DECTCEM — cursor visible
//   1004 focus in/out reporting
//   2004 bracketed paste
// Deliberately NOT tracked: 2026 (synchronized output — replaying a stale
// "begin" would freeze rendering) and 12 (cursor blink, cosmetic).
const FLAG_DEFAULTS = [
  [1, false],
  [7, true],
  [25, true],
  [1004, false],
  [2004, false],
];

const DECSET_RE = /\x1b\[\?([0-9;]{1,64})([hl])/g;
// An escape sequence that may continue in the next chunk: ESC, ESC [, ESC [ ? 1 0 ...
const PARTIAL_RE = /^\x1b(?:\[\??[0-9;]*)?$/;
const MAX_TAIL = 72;

class TerminalModeTracker {
  constructor() {
    this.flags = new Map(FLAG_DEFAULTS);
    this.mouseProtocol = 0;
    this.mouseEncoding = 0;
    this.altScreenMode = null; // '1049' | '1047' | '47' | null
    this._tail = '';
  }

  get inAltScreen() {
    return this.altScreenMode !== null;
  }

  /** Feed raw PTY output (chunks may split escape sequences anywhere). */
  feed(data) {
    if (typeof data !== 'string' || data.length === 0) return;
    const buf = this._tail + data;
    DECSET_RE.lastIndex = 0;
    let lastEnd = 0;
    let m;
    while ((m = DECSET_RE.exec(buf)) !== null) {
      this._apply(m[1], m[2] === 'h');
      lastEnd = DECSET_RE.lastIndex;
    }
    const lastEsc = buf.lastIndexOf('\x1b');
    if (lastEsc >= lastEnd && buf.length - lastEsc <= MAX_TAIL) {
      const rest = buf.slice(lastEsc);
      this._tail = PARTIAL_RE.test(rest) ? rest : '';
    } else {
      this._tail = '';
    }
  }

  _apply(params, set) {
    for (const p of params.split(';')) {
      if (!p) continue;
      const mode = Number(p);
      if (MOUSE_PROTOCOLS.has(mode)) {
        this.mouseProtocol = set ? mode : 0;
      } else if (MOUSE_ENCODINGS.has(mode)) {
        if (set) this.mouseEncoding = mode;
        else if (this.mouseEncoding === mode) this.mouseEncoding = 0;
      } else if (ALT_SCREEN_MODES.has(mode)) {
        this.altScreenMode = set ? String(mode) : null;
      } else if (this.flags.has(mode)) {
        this.flags.set(mode, set);
      }
    }
  }

  /**
   * Escape sequence that re-creates the tracked input modes on a terminal
   * that was just reset and fed the replay. Resets are emitted before sets so
   * a "mouse off" can never clobber the active protocol.
   */
  restoreSequence() {
    const resets = [];
    const sets = [];
    for (const [mode, on] of this.flags) (on ? sets : resets).push(mode);
    resets.push(1000); // clears whichever mouse protocol the replay left on
    if (this.mouseProtocol) sets.push(this.mouseProtocol);
    if (this.mouseEncoding) sets.push(this.mouseEncoding);
    else resets.push(1006);
    let out = `\x1b[?${resets.join(';')}l`;
    if (sets.length) out += `\x1b[?${sets.join(';')}h`;
    return out;
  }

  /** True when any tracked mode differs from the power-on default. */
  hasNonDefaultModes() {
    if (this.mouseProtocol || this.mouseEncoding) return true;
    for (const [mode, def] of FLAG_DEFAULTS) {
      if (this.flags.get(mode) !== def) return true;
    }
    return false;
  }
}

module.exports = { TerminalModeTracker };
