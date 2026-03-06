const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {
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
} = require('./prompts');

const TERMBEAM_DIR = path.join(os.homedir(), '.termbeam');
const ECOSYSTEM_FILE = path.join(TERMBEAM_DIR, 'ecosystem.config.js');
const DEFAULT_SERVICE_NAME = 'termbeam';

// ── PM2 Detection ────────────────────────────────────────────────────────────

function findPm2() {
  try {
    const cmd = os.platform() === 'win32' ? 'where' : 'which';
    const result = execFileSync(cmd, ['pm2'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return result.trim().split('\n')[0].trim();
  } catch {
    return null;
  }
}

function installPm2Global() {
  console.log(yellow('\nInstalling PM2 globally...'));
  try {
    execFileSync('npm', ['install', '-g', 'pm2'], {
      stdio: 'inherit',
      timeout: 120000,
    });
    console.log(green('✓ PM2 installed successfully.\n'));
    return true;
  } catch (err) {
    console.error(red(`✗ Failed to install PM2: ${err.message}`));
    console.error(dim('  Try running: sudo npm install -g pm2'));
    return false;
  }
}

// ── Ecosystem Config ─────────────────────────────────────────────────────────

function buildArgs(config) {
  const args = [];
  if (config.password === false) {
    args.push('--no-password');
  } else if (config.password) {
    args.push('--password', config.password);
  }
  if (config.port && config.port !== 3456) {
    args.push('--port', String(config.port));
  }
  if (config.host && config.host !== '127.0.0.1') {
    args.push('--host', config.host);
  }
  if (config.lan) {
    args.push('--lan');
  }
  if (config.noTunnel) {
    args.push('--no-tunnel');
  }
  if (config.persistedTunnel) {
    args.push('--persisted-tunnel');
  }
  if (config.publicTunnel) {
    args.push('--public');
  }
  if (config.logLevel && config.logLevel !== 'info') {
    args.push('--log-level', config.logLevel);
  }
  if (config.shell) {
    args.push(config.shell);
  }
  return args;
}

function generateEcosystem(config) {
  const entry = require.resolve('../bin/termbeam.js');
  const args = buildArgs(config);
  const env = {};
  if (config.cwd) env.TERMBEAM_CWD = config.cwd;

  const ecosystem = {
    apps: [
      {
        name: config.name || DEFAULT_SERVICE_NAME,
        script: entry,
        args: args,
        cwd: config.cwd || os.homedir(),
        env,
        autorestart: true,
        max_restarts: 10,
        restart_delay: 1000,
      },
    ],
  };

  return `module.exports = ${JSON.stringify(ecosystem, null, 2)};\n`;
}

function writeEcosystem(content) {
  fs.mkdirSync(TERMBEAM_DIR, { recursive: true });
  fs.writeFileSync(ECOSYSTEM_FILE, content, 'utf8');
}

// ── PM2 Commands ─────────────────────────────────────────────────────────────

function pm2Exec(args, opts = {}) {
  try {
    return execFileSync('pm2', args, {
      encoding: 'utf8',
      stdio: opts.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      ...opts,
    });
  } catch (err) {
    if (opts.silent) return null;
    console.error(red(`✗ PM2 command failed: pm2 ${args.join(' ')}`));
    if (err.stderr) console.error(dim(err.stderr.trim()));
    return null;
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function actionInstall() {
  console.log(dim('\nChecking PM2...\n'));

  // Step 1: Check PM2
  let pm2Path = findPm2();
  if (!pm2Path) {
    console.log(yellow('⚠ PM2 is not installed.'));
    console.log(dim('  PM2 is a process manager for Node.js that keeps TermBeam running'));
    console.log(dim('  in the background and can auto-restart it on boot.\n'));

    const rl = createRL();
    const shouldInstall = await confirm(rl, 'Install PM2 globally now?', true);
    rl.close();

    if (!shouldInstall) {
      console.log(dim('\nYou can install PM2 manually: npm install -g pm2'));
      console.log(dim('Then run: termbeam service install\n'));
      process.exit(1);
    }
    if (!installPm2Global()) process.exit(1);
    pm2Path = findPm2();
    if (!pm2Path) {
      console.error(red('✗ PM2 still not found after installation.'));
      process.exit(1);
    }
  } else {
    console.log(green(`✓ PM2 found: ${pm2Path}`));
  }

  // Enter alternate screen buffer for a clean wizard (like vim/htop)
  process.stdout.write('\x1b[?1049h');
  // Ensure we exit alternate screen on any exit
  const exitAltScreen = () => process.stdout.write('\x1b[?1049l');
  process.on('exit', exitAltScreen);

  // Step 2: Interactive config
  const rl = createRL();
  const config = {};

  const steps = [
    'Service name',
    'Password',
    'Port',
    'Access',
    'Directory',
    'Log level',
    'Boot',
    'Confirm',
  ];

  const decisions = [];

  function showProgress(stepIndex) {
    // Clear alternate screen and move to top
    process.stdout.write('\x1b[2J\x1b[H');

    console.log(bold('🚀 TermBeam Service Setup'));
    console.log('');
    const total = steps.length;
    const filled = stepIndex + 1;
    const bar = steps
      .map((s, i) => {
        if (i < stepIndex) return green('●');
        if (i === stepIndex) return cyan('●');
        return dim('○');
      })
      .join(dim(' ─ '));
    console.log(`${dim(`Step ${filled}/${total}`)}  ${bar}  ${cyan(steps[stepIndex])}`);

    // Show decisions so far
    if (decisions.length > 0) {
      console.log('');
      for (const { label, value } of decisions) {
        console.log(`  ${dim(label + ':')} ${value}`);
      }
    }
  }

  // Service name
  showProgress(0);
  config.name = await ask(rl, 'Service name:', DEFAULT_SERVICE_NAME);
  decisions.push({ label: 'Service name', value: config.name });

  // Password
  showProgress(1);
  const pwChoice = await choose(rl, 'Password authentication:', [
    {
      label: 'Auto-generate a secure password',
      hint: 'A random password will be created and displayed for you',
    },
    { label: 'Enter a custom password', hint: 'You choose the password for accessing TermBeam' },
    {
      label: 'No password',
      hint: '⚠ Not recommended — anyone on the network can access your terminal',
      warn: true,
    },
  ]);
  if (pwChoice.index === 0) {
    config.password = crypto.randomBytes(16).toString('base64url');
    process.stdout.write(dim(`  Generated password: ${config.password}`) + '\n');
  } else if (pwChoice.index === 1) {
    config.password = await ask(rl, 'Enter password:');
    while (!config.password) {
      console.log(red('  Password cannot be empty.'));
      config.password = await ask(rl, 'Enter password:');
    }
  } else {
    config.password = false;
  }
  decisions.push({
    label: 'Password',
    value: config.password === false ? yellow('disabled') : '••••••••',
  });

  // Port
  showProgress(2);
  const portStr = await ask(rl, 'Port:', '3456');
  config.port = parseInt(portStr, 10) || 3456;
  decisions.push({ label: 'Port', value: String(config.port) });

  // Access mode (combines host binding + tunnel into one clear question)
  showProgress(3);
  const accessChoice = await choose(rl, 'How will you connect to TermBeam?', [
    {
      label: 'From anywhere (DevTunnel)',
      hint: 'Creates a secure tunnel URL — access from phone, other networks, anywhere',
    },
    {
      label: 'Local network (LAN)',
      hint: 'Accessible from devices on the same Wi-Fi/network (e.g. phone on same Wi-Fi)',
    },
    {
      label: 'This machine only',
      hint: 'Localhost only — most secure, no external access',
    },
  ]);

  if (accessChoice.index === 0) {
    // DevTunnel mode: localhost binding, tunnel enabled, persisted by default for services
    config.host = '127.0.0.1';
    config.noTunnel = false;
    config.persistedTunnel = true;
    // Re-render step to clear the previous menu before showing sub-question
    showProgress(3);
    const publicChoice = await choose(rl, 'Tunnel access:', [
      {
        label: 'Private (requires Microsoft login)',
        hint: 'Only you can access the tunnel — secured via your Microsoft account',
      },
      {
        label: 'Public (anyone with the link)',
        hint: '🚨 Anyone with the URL can reach your terminal — password is the only protection',
        danger: true,
      },
    ]);
    config.publicTunnel = publicChoice.index === 1;
    if (config.publicTunnel && config.password === false) {
      console.log(yellow('  ⚠ Public tunnels require password authentication.'));
      config.password = crypto.randomBytes(16).toString('base64url');
      process.stdout.write(dim(`  Auto-generated password: ${config.password}`) + '\n');
    }
  } else if (accessChoice.index === 1) {
    // LAN mode: bind to all interfaces, no tunnel
    config.lan = true;
    config.noTunnel = true;
  } else {
    // Localhost only: no tunnel
    config.host = '127.0.0.1';
    config.noTunnel = true;
  }
  const accessLabel = config.noTunnel
    ? config.lan
      ? 'LAN (0.0.0.0)'
      : 'Localhost only'
    : config.publicTunnel
      ? 'DevTunnel (public)'
      : 'DevTunnel (private)';
  decisions.push({ label: 'Access', value: accessLabel });

  // Working directory
  showProgress(4);
  config.cwd = await ask(rl, 'Working directory:', process.cwd());
  decisions.push({ label: 'Directory', value: config.cwd });

  // Shell — use current shell automatically
  config.shell = process.env.SHELL || (os.platform() === 'win32' ? process.env.COMSPEC : '/bin/sh');
  decisions.push({ label: 'Shell', value: config.shell });

  // Log level
  showProgress(5);
  const logChoice = await choose(
    rl,
    'Log level:',
    [
      { label: 'info', hint: 'Standard logging — startup, connections, errors (recommended)' },
      { label: 'debug', hint: 'Verbose output — useful for troubleshooting issues' },
      { label: 'warn', hint: 'Only warnings and errors' },
      { label: 'error', hint: 'Only critical errors — minimal output' },
    ],
    0,
  );
  config.logLevel = logChoice.value;
  decisions.push({ label: 'Log level', value: config.logLevel });

  // Boot
  showProgress(6);
  config.startup = await confirm(rl, 'Auto-start TermBeam on system boot?', true);
  decisions.push({ label: 'Boot', value: config.startup ? 'yes' : 'no' });

  // Confirm
  showProgress(7);
  console.log(bold('\n── Configuration Summary ──────────────────'));
  console.log(`  Service name:  ${cyan(config.name)}`);
  console.log(
    `  Password:      ${config.password === false ? yellow('disabled') : cyan('••••••••')}`,
  );
  console.log(`  Port:          ${cyan(String(config.port))}`);
  console.log(
    `  Host:          ${cyan(config.lan ? '0.0.0.0 (LAN)' : config.host || '127.0.0.1')}`,
  );
  console.log(`  Tunnel:        ${config.noTunnel ? yellow('disabled') : cyan('enabled')}`);
  if (!config.noTunnel) {
    console.log(`  Persisted:     ${config.persistedTunnel ? cyan('yes') : dim('no')}`);
    console.log(`  Public:        ${config.publicTunnel ? yellow('yes') : dim('no')}`);
  }
  console.log(`  Directory:     ${cyan(config.cwd)}`);
  console.log(`  Shell:         ${cyan(config.shell || 'default')}`);
  console.log(`  Log level:     ${cyan(config.logLevel)}`);
  console.log(`  Boot:          ${config.startup ? cyan('yes') : dim('no')}`);
  console.log(dim('─'.repeat(44)));

  const proceed = await confirm(rl, '\nProceed with installation?', true);
  rl.close();

  // Exit alternate screen — return to normal terminal
  exitAltScreen();
  process.removeListener('exit', exitAltScreen);

  if (!proceed) {
    console.log(dim('Cancelled.'));
    process.exit(0);
  }

  // Step 3: Create working directory if needed, write ecosystem & start
  if (!fs.existsSync(config.cwd)) {
    fs.mkdirSync(config.cwd, { recursive: true });
    console.log(green(`✓ Created directory ${config.cwd}`));
  }
  const ecosystemContent = generateEcosystem(config);
  writeEcosystem(ecosystemContent);
  console.log(green(`\n✓ Config written to ${ECOSYSTEM_FILE}`));

  // Stop existing instance if running
  pm2Exec(['delete', config.name], { silent: true });

  // Truncate old log files for a clean start
  const outLog = path.join(os.homedir(), '.pm2', 'logs', `${config.name}-out.log`);
  const errLog = path.join(os.homedir(), '.pm2', 'logs', `${config.name}-error.log`);
  try {
    fs.writeFileSync(outLog, '', 'utf8');
  } catch {}
  try {
    fs.writeFileSync(errLog, '', 'utf8');
  } catch {}

  // Start
  const started = pm2Exec(['start', ECOSYSTEM_FILE], { inherit: true });
  if (started === null && !fs.existsSync(ECOSYSTEM_FILE)) {
    console.error(red('✗ Failed to start TermBeam service.'));
    process.exit(1);
  }

  pm2Exec(['save'], { inherit: true });
  console.log(green('\n✓ TermBeam is now running as a PM2 service!'));

  // Run pm2 startup if chosen during wizard
  if (config.startup) {
    console.log('');
    // pm2 startup outputs a sudo command to copy/paste — capture it and run it
    const startupOutput = pm2Exec(['startup'], { silent: true }) || '';
    const sudoMatch = startupOutput.match(/^(sudo .+)$/m);
    if (sudoMatch) {
      console.log(dim('Setting up boot persistence (may ask for your password)...\n'));
      const { spawn } = require('child_process');
      const child = spawn('sh', ['-c', sudoMatch[1]], { stdio: 'inherit' });
      await new Promise((resolve) => child.on('close', resolve));
      pm2Exec(['save'], { inherit: true });
      console.log(green('✓ TermBeam will start automatically on boot.'));
    } else {
      // Fallback: just show what pm2 said
      console.log(startupOutput);
    }
  }

  // Wait for server to start and show connection info
  console.log(dim('\nWaiting for TermBeam to start...'));
  const maxWait = 15;
  let logContent = '';
  for (let i = 0; i < maxWait; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      logContent = fs.readFileSync(outLog, 'utf8');
    } catch {
      continue;
    }
    if (logContent.includes('Scan the QR code') || logContent.includes('Local:')) break;
  }
  if (logContent) {
    // Extract from last "Shell:" to last "Scan the QR code" line
    const lines = logContent.split('\n');
    const startIdx = lines.findLastIndex((l) => l.includes('Shell:'));
    const endIdx = lines.findLastIndex((l) => l.includes('Scan the QR code'));
    if (startIdx >= 0 && endIdx >= startIdx) {
      console.log('');
      for (let i = startIdx; i <= endIdx; i++) {
        console.log(lines[i]);
      }
      console.log('');
    }
  }

  console.log(dim('\nUseful commands:'));
  console.log(`  ${cyan('termbeam list')}              — List active sessions`);
  console.log(
    `  ${cyan('termbeam resume')}            — Attach to a session (or: termbeam attach)`,
  );
  console.log(`  ${cyan('termbeam service status')}    — Check service status`);
  console.log(`  ${cyan('termbeam service logs')}      — View logs`);
  console.log(`  ${cyan('termbeam service restart')}   — Restart service`);
  console.log(`  ${cyan('termbeam service uninstall')} — Remove service\n`);
}

async function actionUninstall() {
  const pm2Path = findPm2();
  if (!pm2Path) {
    console.error(red('✗ PM2 is not installed.'));
    process.exit(1);
  }

  // Find running termbeam services
  const list = pm2Exec(['jlist'], { silent: true });
  let services = [];
  if (list) {
    try {
      services = JSON.parse(list).filter(
        (p) => p.name === DEFAULT_SERVICE_NAME || p.name.startsWith('termbeam'),
      );
    } catch {
      // ignore parse errors
    }
  }

  const name = services.length > 0 ? services[0].name : DEFAULT_SERVICE_NAME;

  const rl = createRL();
  const sure = await confirm(rl, `Remove TermBeam service "${name}" from PM2?`, true);
  rl.close();

  if (!sure) {
    console.log(dim('Cancelled.'));
    process.exit(0);
  }

  pm2Exec(['stop', name], { inherit: true });
  pm2Exec(['delete', name], { inherit: true });
  pm2Exec(['save'], { inherit: true });

  // Clean up ecosystem file
  if (fs.existsSync(ECOSYSTEM_FILE)) {
    fs.unlinkSync(ECOSYSTEM_FILE);
    console.log(dim(`Removed ${ECOSYSTEM_FILE}`));
  }

  console.log(green(`\n✓ TermBeam service "${name}" removed.\n`));
}

function actionStatus() {
  const pm2Path = findPm2();
  if (!pm2Path) {
    console.error(red('✗ PM2 is not installed. Run: npm install -g pm2'));
    process.exit(1);
  }
  pm2Exec(['describe', DEFAULT_SERVICE_NAME], { inherit: true });
}

function actionLogs() {
  const pm2Path = findPm2();
  if (!pm2Path) {
    console.error(red('✗ PM2 is not installed. Run: npm install -g pm2'));
    process.exit(1);
  }
  const { spawn } = require('child_process');
  const child = spawn('pm2', ['logs', DEFAULT_SERVICE_NAME, '--lines', '200'], {
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    console.error(red(`✗ Failed to stream logs: ${err.message}`));
  });
}

function actionRestart() {
  const pm2Path = findPm2();
  if (!pm2Path) {
    console.error(red('✗ PM2 is not installed. Run: npm install -g pm2'));
    process.exit(1);
  }
  pm2Exec(['restart', DEFAULT_SERVICE_NAME], { inherit: true });
  console.log(green('\n✓ TermBeam service restarted.\n'));
}

// ── Entrypoint ───────────────────────────────────────────────────────────────

function printServiceHelp() {
  console.log(`
${bold('termbeam service')} — Manage TermBeam as a background service (PM2)

${bold('Usage:')}
  termbeam service install     Interactive setup & start
  termbeam service uninstall   Stop & remove from PM2
  termbeam service status      Show service status
  termbeam service logs        Tail service logs
  termbeam service restart     Restart the service

${dim('PM2 will be installed globally if not already present.')}
`);
}

async function run(args) {
  const action = (args[0] || '').toLowerCase();

  switch (action) {
    case 'install':
      await actionInstall();
      break;
    case 'uninstall':
    case 'remove':
      await actionUninstall();
      break;
    case 'status':
      actionStatus();
      break;
    case 'logs':
    case 'log':
      actionLogs();
      break;
    case 'restart':
      actionRestart();
      break;
    default:
      printServiceHelp();
      break;
  }
}

module.exports = {
  run,
  findPm2,
  buildArgs,
  generateEcosystem,
  writeEcosystem,
  pm2Exec,
  actionStatus,
  actionRestart,
  actionLogs,
  printServiceHelp,
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
  TERMBEAM_DIR,
  ECOSYSTEM_FILE,
  DEFAULT_SERVICE_NAME,
};
