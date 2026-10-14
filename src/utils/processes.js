'use strict';

// Process inspection for terminal sessions: a shell's live working directory
// and its direct children. PIDs are validated as positive integers and every
// tool runs through execFile — no shell parses anything. On Linux /proc is
// read directly, so this also works in slim containers without procps.

const fs = require('fs');
const childProcess = require('child_process');

const TIMEOUT_MS = 2000;

/** The value as a process id (positive safe integer), or null. */
function toPid(value) {
  const pid = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function run(execFile, file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: TIMEOUT_MS }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout || '')),
    );
  });
}

/** Working directory of a running process, or null when it can't be read. */
async function getProcessCwd(
  value,
  {
    platform = process.platform,
    readlink = fs.promises.readlink,
    execFile = childProcess.execFile,
  } = {},
) {
  const pid = toPid(value);
  if (!pid) return null;
  try {
    if (platform === 'linux') return await readlink(`/proc/${pid}/cwd`);
    if (platform === 'darwin') {
      // lsof -F output is one field per line: p<pid>, f<fd>, n<name>
      const out = await run(execFile, 'lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
      const match = out.match(/^n(.+)$/m);
      return match ? match[1].trim() : null;
    }
  } catch {
    // The process exited, or the tool is unavailable
  }
  return null;
}

/**
 * PIDs (strings) of a process's direct children, or null when they can't be
 * listed. Linux unions /proc/<pid>/task/<tid>/children over every thread (a
 * multithreaded program such as pwsh can spawn from any of them) and falls
 * back to ps when those files aren't available; other platforms use ps.
 */
async function getChildPids(
  value,
  {
    platform = process.platform,
    readdir = fs.promises.readdir,
    readFile = fs.promises.readFile,
    execFile = childProcess.execFile,
  } = {},
) {
  const pid = toPid(value);
  if (!pid || platform === 'win32') return null;
  if (platform === 'linux') {
    try {
      const tids = (await readdir(`/proc/${pid}/task`)).filter((tid) => /^\d+$/.test(tid));
      // A thread may exit mid-scan; only when no thread could be read at all
      // (e.g. no CONFIG_PROC_CHILDREN) is it worth asking ps instead.
      const lists = await Promise.allSettled(
        tids.map((tid) => readFile(`/proc/${pid}/task/${tid}/children`, 'utf8')),
      );
      const read = lists.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (read.length > 0) return [...new Set(read.join(' ').split(/\s+/).filter(Boolean))];
    } catch {
      // The process exited, or /proc is unavailable — use ps below
    }
  }
  try {
    const out = await run(execFile, 'ps', ['-A', '-o', 'pid=,ppid=']);
    const parent = String(pid);
    const children = [];
    for (const line of out.split('\n')) {
      const [child, ppid] = line.trim().split(/\s+/);
      if (child && ppid === parent) children.push(child);
    }
    return children;
  } catch {
    return null;
  }
}

module.exports = { toPid, getProcessCwd, getChildPids };
