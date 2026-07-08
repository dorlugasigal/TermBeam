const readline = require('readline');

// ── Color helpers ────────────────────────────────────────────────────────────

function color(code, text) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (t) => color('32', t);
const yellow = (t) => color('33', t);
const red = (t) => color('31', t);
const cyan = (t) => color('36', t);
const bold = (t) => color('1', t);
const dim = (t) => color('2', t);

// ── Interactive prompts ──────────────────────────────────────────────────────

/**
 * Prompt the user with a question. Returns the trimmed answer.
 * If `defaultValue` is provided, it's shown in brackets and used when the user presses Enter.
 */
function ask(rl, question, defaultValue) {
  const suffix = defaultValue != null ? ` ${dim(`[${defaultValue}]`)} ` : ' '; // eslint-disable-line eqeqeq
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}`, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed || (defaultValue != null ? String(defaultValue) : '')); // eslint-disable-line eqeqeq
    });
  });
}

/**
 * Prompt the user with a list of choices using arrow keys.
 * Each choice can be a string or { label, hint } object.
 * Up/Down to move, Enter to select. Returns the chosen value.
 */
function choose(rl, question, choices, defaultIndex = 0) {
  // Normalize choices to { label, hint } objects
  const items = choices.map((c) => (typeof c === 'string' ? { label: c, hint: '' } : c));

  return new Promise((resolve) => {
    let selected = defaultIndex;

    function lineCount() {
      return items.reduce((n, item) => n + 1 + (item.hint ? 1 : 0), 0);
    }

    function render(clear) {
      if (clear) {
        process.stdout.write(`\x1b[${lineCount()}A\r\x1b[J`);
      }
      items.forEach((item, i) => {
        const marker = i === selected ? cyan('→') : ' ';
        const label = i === selected ? bold(item.label) : item.label;
        process.stdout.write(`  ${marker} ${label}\n`);
        if (item.hint) {
          const hintText = item.danger
            ? red(item.hint)
            : item.warn
              ? yellow(item.hint)
              : dim(item.hint);
          process.stdout.write(`      ${hintText}\n`);
        }
      });
      process.stdout.write(dim('  ↑/↓ to move, Enter to select'));
    }

    rl.pause();
    console.log(`\n${question}`);
    render(false);

    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    // Bytes arrive as a raw stream: a single keypress may be split across
    // multiple 'data' events, and several keypresses may be coalesced into one
    // (common when keys are pressed quickly). Buffer the stream and consume one
    // recognized token at a time so navigation never silently drops keys.
    let pending = Buffer.alloc(0);

    function moveUp() {
      selected = (selected - 1 + items.length) % items.length;
      render(true);
    }
    function moveDown() {
      selected = (selected + 1) % items.length;
      render(true);
    }

    function onKey(buf) {
      pending = pending.length ? Buffer.concat([pending, buf]) : buf;

      while (pending.length > 0) {
        const b = pending[0];

        if (b === 0x1b) {
          // Escape sequence — need at least ESC '[' <code> to interpret.
          if (pending.length < 2) return; // wait for more bytes
          if (pending[1] === 0x5b /* [ */) {
            if (pending.length < 3) return; // wait for the final byte
            const code = pending[2];
            if (code === 0x41 /* A */) moveUp();
            else if (code === 0x42 /* B */) moveDown();
            // Ignore other CSI sequences (left/right/home/etc.)
            pending = pending.subarray(3);
          } else {
            // Lone ESC or unsupported sequence — drop the ESC and continue.
            pending = pending.subarray(1);
          }
          continue;
        }

        if (b === 0x0d /* \r */ || b === 0x0a /* \n */) {
          cleanup();
          process.stdout.write('\r\x1b[K\n');
          console.log(dim(`  Selected: ${items[selected].label}`));
          resolve({ index: selected, value: items[selected].label });
          return;
        }
        if (b === 0x03 /* Ctrl-C */) {
          cleanup();
          process.stdout.write('\x1b[?1049l');
          process.exit(0);
        }
        if (b === 0x6b /* k */) moveUp();
        else if (b === 0x6a /* j */) moveDown();
        // Any other byte is ignored.
        pending = pending.subarray(1);
      }
    }

    function cleanup() {
      process.stdin.removeListener('data', onKey);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw || false);
      }
      process.stdin.pause();
      rl.resume();
    }

    process.stdin.on('data', onKey);
  });
}

/**
 * Ask a yes/no question. Returns boolean.
 */
function confirm(rl, question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    rl.question(`${question} ${dim(`[${hint}]`)} `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

// ── readline factory ─────────────────────────────────────────────────────────

function createRL() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

module.exports = {
  color,
  green,
  yellow,
  red,
  cyan,
  bold,
  dim,
  ask,
  choose,
  confirm,
  createRL,
};
