const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const LABELS = { error: 'ERROR', warn: 'WARN', info: 'INFO', debug: 'DEBUG' };

let currentLevel = LEVELS.info;

function timestamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

const log = {
  setLevel(level) {
    const l = LEVELS[level];
    if (l !== undefined) currentLevel = l;
  },
  getLevel() {
    return Object.keys(LEVELS).find(k => LEVELS[k] === currentLevel);
  },
  error(...args) {
    if (currentLevel >= LEVELS.error) console.error(`[${timestamp()}]`, `[${LABELS.error}]`, ...args);
  },
  warn(...args) {
    if (currentLevel >= LEVELS.warn) console.warn(`[${timestamp()}]`, `[${LABELS.warn}]`, ...args);
  },
  info(...args) {
    if (currentLevel >= LEVELS.info) console.log(`[${timestamp()}]`, `[${LABELS.info}]`, ...args);
  },
  debug(...args) {
    if (currentLevel >= LEVELS.debug) console.log(`[${timestamp()}]`, `[${LABELS.debug}]`, ...args);
  },
};

module.exports = log;
