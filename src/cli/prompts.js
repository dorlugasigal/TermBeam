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

    function onKey(buf) {
      const key = buf.toString();

      if (key === '\x1b[A' || key === 'k') {
        selected = (selected - 1 + items.length) % items.length;
        render(true);
      } else if (key === '\x1b[B' || key === 'j') {
        selected = (selected + 1) % items.length;
        render(true);
      } else if (key === '\r' || key === '\n') {
        cleanup();
        process.stdout.write('\r\x1b[K\n');
        console.log(dim(`  Selected: ${items[selected].label}`));
        resolve({ index: selected, value: items[selected].label });
      } else if (key === '\x03') {
        cleanup();
        process.stdout.write('\x1b[?1049l');
        process.exit(0);
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
