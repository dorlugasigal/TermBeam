const child_process = require('child_process');
const os = require('os');
const log = require('./logger');

const KNOWN_AGENTS = [
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    cmd: 'copilot',
    icon: 'copilot',
    detect: ['copilot', ['--version']],
  },
  {
    id: 'gh-copilot',
    name: 'GitHub Copilot (gh)',
    cmd: 'gh',
    args: ['copilot'],
    icon: 'copilot',
    detect: ['gh', ['copilot', '--version']],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    cmd: 'claude',
    icon: 'claude',
    detect: ['claude', ['--version']],
  },
  {
    id: 'aider',
    name: 'Aider',
    cmd: 'aider',
    icon: 'aider',
    detect: ['aider', ['--version']],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    cmd: 'codex',
    icon: 'codex',
    detect: ['codex', ['--version']],
  },
];

let cachedAgents = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 60 seconds

function tryDetectAgent(agent) {
  const [cmd, args] = agent.detect;
  const isWindows = os.platform() === 'win32';
  const candidates = isWindows ? [cmd, `${cmd}.cmd`, `${cmd}.exe`] : [cmd];

  return new Promise((resolve) => {
    let resolved = false;
    let remaining = candidates.length;

    for (const bin of candidates) {
      child_process.execFile(bin, args, { timeout: 5000, encoding: 'utf8' }, (err, stdout) => {
        remaining--;
        if (resolved) return;
        if (!err) {
          resolved = true;
          const version = (stdout || '').trim().split('\n')[0] || 'unknown';
          resolve({
            id: agent.id,
            name: agent.name,
            cmd: agent.cmd,
            args: agent.args || [],
            icon: agent.icon,
            version,
          });
        } else if (remaining === 0) {
          resolve(null);
        }
      });
    }
  });
}

async function detectAgents() {
  log.debug('Detecting available AI agents...');
  const results = await Promise.allSettled(KNOWN_AGENTS.map(tryDetectAgent));

  const agents = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      agents.push(result.value);
    }
  }

  // Deduplicate: prefer standalone copilot over gh copilot
  const hasCopilot = agents.some((a) => a.id === 'copilot');
  const deduped = hasCopilot ? agents.filter((a) => a.id !== 'gh-copilot') : agents;

  log.debug(
    `Detected ${deduped.length} AI agent(s): ${deduped.map((a) => a.name).join(', ') || 'none'}`,
  );
  return deduped;
}

async function getAvailableAgents() {
  const now = Date.now();
  if (cachedAgents && now - cacheTime < CACHE_TTL) {
    return cachedAgents;
  }
  cachedAgents = await detectAgents();
  cacheTime = Date.now();
  return cachedAgents;
}

module.exports = { detectAgents, getAvailableAgents, KNOWN_AGENTS };
