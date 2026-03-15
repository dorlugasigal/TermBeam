const crypto = require('crypto');
const log = require('../utils/logger');
const {
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

// ── Interactive Setup Wizard ─────────────────────────────────────────────────

async function runInteractiveSetup(baseConfig) {
  log.info('Interactive setup started');
  // Enter alternate screen buffer for a clean wizard (like vim/htop)
  process.stdout.write('\x1b[?1049h');
  const exitAltScreen = () => process.stdout.write('\x1b[?1049l');
  process.on('exit', exitAltScreen);

  const rl = createRL();

  const steps = ['Password', 'Port', 'Access', 'Log level', 'Confirm'];
  const decisions = [];

  function showProgress(stepIndex) {
    process.stdout.write('\x1b[2J\x1b[H');

    console.log(bold('🚀 TermBeam Interactive Setup'));
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

    if (decisions.length > 0) {
      console.log('');
      for (const { label, value } of decisions) {
        console.log(`  ${dim(label + ':')} ${value}`);
      }
    }
  }

  // Build config from base
  const config = {
    port: baseConfig.port,
    host: baseConfig.host,
    password: baseConfig.password,
    useTunnel: baseConfig.useTunnel,
    persistedTunnel: baseConfig.persistedTunnel,
    publicTunnel: baseConfig.publicTunnel,
    shell: baseConfig.shell,
    shellArgs: baseConfig.shellArgs,
    cwd: baseConfig.cwd,
    defaultShell: baseConfig.defaultShell,
    version: baseConfig.version,
    logLevel: baseConfig.logLevel,
  };

  // Step 1: Password
  showProgress(0);
  const pwChoice = await choose(rl, 'Password authentication:', [
    {
      label: 'Auto-generate',
      hint: 'Random password, shown on screen and embedded in the QR code',
    },
    {
      label: 'Custom password',
      hint: 'You type a password to use for this session',
    },
    {
      label: 'No password',
      hint: '⚠ No authentication — anyone who can reach the server gets shell access',
      warn: true,
    },
  ]);
  let passwordMode = 'auto';
  if (pwChoice.index === 0) {
    config.password = crypto.randomBytes(16).toString('base64url');
    process.stdout.write(dim(`  Generated password: ${config.password}`) + '\n');
  } else if (pwChoice.index === 1) {
    passwordMode = 'custom';
    config.password = await ask(rl, 'Enter password:');
    while (!config.password) {
      console.log(red('  Password cannot be empty.'));
      config.password = await ask(rl, 'Enter password:');
    }
  } else {
    passwordMode = 'none';
    config.password = null;
  }
  log.debug(`Password mode selected: ${passwordMode}`);
  decisions.push({
    label: 'Password',
    value: config.password === null ? yellow('disabled') : '••••••••',
  });

  // Step 2: Port
  showProgress(1);
  const portStr = await ask(rl, 'Port:', String(config.port));
  const portNum = parseInt(portStr, 10);
  config.port = portNum >= 1 && portNum <= 65535 ? portNum : 3456;
  log.debug(`Port selected: ${config.port}`);
  decisions.push({ label: 'Port', value: String(config.port) });

  // Step 3: Access mode
  showProgress(2);
  const accessChoice = await choose(rl, 'How will you connect to TermBeam?', [
    {
      label: 'DevTunnel (internet)',
      hint: 'HTTPS tunnel — accessible from any network, secured with your Microsoft account',
    },
    {
      label: 'LAN',
      hint: 'Binds to 0.0.0.0 — accessible from devices on the same network',
    },
    {
      label: 'Localhost only',
      hint: 'Binds to 127.0.0.1 — only this machine can connect',
    },
  ]);

  if (accessChoice.index === 0) {
    // DevTunnel mode
    config.host = '127.0.0.1';
    config.useTunnel = true;

    // Sub-question: tunnel persistence
    showProgress(2);
    const persistChoice = await choose(rl, 'Tunnel persistence:', [
      {
        label: 'Ephemeral',
        hint: 'New URL each run, automatically deleted when TermBeam exits',
      },
      {
        label: 'Persisted',
        hint: 'Stable URL that survives restarts (expires after 30 days idle)',
      },
    ]);
    config.persistedTunnel = persistChoice.index === 1;

    // Sub-question: access level
    showProgress(2);
    const publicChoice = await choose(rl, 'Tunnel access:', [
      {
        label: 'Private (owner-only)',
        hint: 'Only the Microsoft account that created the tunnel can access it',
      },
      {
        label: 'Public',
        hint: '🚨 No Microsoft login — anyone with the URL can reach your terminal',
        danger: true,
      },
    ]);
    config.publicTunnel = publicChoice.index === 1;

    // Auto-generate password if public tunnel with no password
    if (config.publicTunnel && !config.password) {
      console.log(yellow('  ⚠ Public tunnels require password authentication.'));
      config.password = crypto.randomBytes(16).toString('base64url');
      process.stdout.write(dim(`  Auto-generated password: ${config.password}`) + '\n');
      passwordMode = 'auto';
      // Update the password decision
      decisions[0] = { label: 'Password', value: '••••••••' };
    }
  } else if (accessChoice.index === 1) {
    // LAN mode
    config.host = '0.0.0.0';
    config.useTunnel = false;
    config.persistedTunnel = false;
    config.publicTunnel = false;
  } else {
    // Localhost only
    config.host = '127.0.0.1';
    config.useTunnel = false;
    config.persistedTunnel = false;
    config.publicTunnel = false;
  }

  const accessLabel = !config.useTunnel
    ? config.host === '0.0.0.0'
      ? 'LAN (0.0.0.0)'
      : 'Localhost only'
    : config.publicTunnel
      ? 'DevTunnel (public)'
      : 'DevTunnel (private)';
  log.debug(`Access mode selected: ${accessLabel}`);
  decisions.push({ label: 'Access', value: accessLabel });

  // Step 4: Log level
  showProgress(3);
  const logChoice = await choose(
    rl,
    'Log level:',
    [
      { label: 'info', hint: 'Logs startup, connections, sessions, and errors (default)' },
      { label: 'debug', hint: 'Includes all info logs plus WebSocket frames and internal state' },
      { label: 'warn', hint: 'Only logs warnings and errors' },
      { label: 'error', hint: 'Only logs critical errors' },
    ],
    0,
  );
  config.logLevel = logChoice.value;
  decisions.push({ label: 'Log level', value: config.logLevel });

  // Step 5: Confirmation
  showProgress(4);
  console.log(bold('\n── Configuration Summary ──────────────────'));
  console.log(
    `  Password:      ${config.password === null ? yellow('disabled') : cyan('••••••••')}`,
  );
  console.log(`  Port:          ${cyan(String(config.port))}`);
  console.log(
    `  Host:          ${cyan(config.host === '0.0.0.0' ? '0.0.0.0 (LAN)' : config.host)}`,
  );
  console.log(`  Tunnel:        ${config.useTunnel ? cyan('enabled') : yellow('disabled')}`);
  if (config.useTunnel) {
    console.log(`  Persisted:     ${config.persistedTunnel ? cyan('yes') : dim('no')}`);
    console.log(`  Public:        ${config.publicTunnel ? yellow('yes') : dim('no')}`);
  }
  console.log(`  Shell:         ${cyan(config.shell || 'default')}`);
  console.log(`  Directory:     ${cyan(config.cwd)}`);
  console.log(`  Log level:     ${cyan(config.logLevel)}`);
  console.log(dim('─'.repeat(44)));

  // Build the equivalent CLI command
  const cmdParts = ['termbeam'];
  if (passwordMode === 'none') {
    cmdParts.push('--no-password');
  } else if (passwordMode === 'custom') {
    cmdParts.push('--password', '"<your-password>"');
  }
  // auto-generate is the default — no flag needed
  if (config.port !== 3456) cmdParts.push('--port', String(config.port));
  if (!config.useTunnel) {
    cmdParts.push('--no-tunnel');
    if (config.host === '0.0.0.0') cmdParts.push('--lan');
  } else {
    if (config.persistedTunnel) cmdParts.push('--persisted-tunnel');
    if (config.publicTunnel) cmdParts.push('--public');
  }
  if (config.logLevel !== 'info') cmdParts.push('--log-level', config.logLevel);
  const cliCommand = cmdParts.join(' ');

  console.log('');
  console.log(dim('  To reuse this configuration without the wizard:'));
  console.log(`  ${cyan(cliCommand)}`);

  const proceed = await confirm(rl, '\nStart TermBeam with this configuration?', true);
  rl.close();

  // Exit alternate screen — return to normal terminal
  exitAltScreen();
  process.removeListener('exit', exitAltScreen);

  if (!proceed) {
    log.info('Interactive setup cancelled');
    console.log(dim('Cancelled.'));
    process.exit(0);
  }

  log.info('Interactive setup completed');
  return config;
}

module.exports = { runInteractiveSetup };
