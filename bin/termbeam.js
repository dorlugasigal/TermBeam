#!/usr/bin/env node

// Dispatch subcommands before loading the server
const subcommand = (process.argv[2] || '').toLowerCase();
if (subcommand === 'service') {
  const { run } = require('../src/service');
  run(process.argv.slice(3)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else if (subcommand === 'resume') {
  const { resume } = require('../src/resume');
  resume(process.argv.slice(3)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else if (subcommand === 'sessions') {
  const { list } = require('../src/resume');
  list().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  // Reject any non-flag positional arg — it's not a known subcommand
  if (subcommand && !subcommand.startsWith('-')) {
    const { printHelp } = require('../src/cli');
    console.error(`Unknown command: ${subcommand}\n`);
    printHelp();
    process.exit(1);
  }

  const { createTermBeamServer } = require('../src/server.js');
  const { parseArgs } = require('../src/cli');
  const { runInteractiveSetup } = require('../src/interactive');
  const { readConnectionConfig } = require('../src/resume');
  const http = require('http');

  function httpPost(url, headers) {
    return new Promise((resolve) => {
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: 'POST',
          headers,
          timeout: 2000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  }

  function checkExistingServer(config) {
    if (!config) return Promise.resolve(false);
    const host = config.host === 'localhost' ? '127.0.0.1' : config.host;
    return new Promise((resolve) => {
      const req = http.get(
        `http://${host}:${config.port}/api/sessions`,
        {
          timeout: 2000,
          headers: config.password ? { Authorization: `Bearer ${config.password}` } : {},
        },
        (res) => {
          res.resume();
          resolve(res.statusCode < 500);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  async function stopExistingServer(config, fallbackPassword) {
    const host = config.host === 'localhost' ? '127.0.0.1' : config.host;
    const url = `http://${host}:${config.port}/api/shutdown`;
    console.log(`Stopping existing server on port ${config.port}...`);

    // Try with config password, then fallback password, then no password
    const passwords = [config.password, fallbackPassword, null].filter(
      (v, i, a) => a.indexOf(v) === i,
    );
    let stopped = false;
    for (const pw of passwords) {
      const headers = pw ? { Authorization: `Bearer ${pw}` } : {};
      const status = await httpPost(url, headers);
      if (status && status !== 401) {
        stopped = true;
        break;
      }
    }
    if (!stopped) {
      console.error(
        'Cannot stop the existing server — password mismatch.\n' +
          'Stop it manually (Ctrl+C in its terminal) and try again.',
      );
      process.exit(1);
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (!(await checkExistingServer(config))) break;
    }
  }

  async function main() {
    const baseConfig = parseArgs();
    const targetPort = baseConfig.port;
    const targetHost = baseConfig.host === '0.0.0.0' ? '127.0.0.1' : baseConfig.host;

    // Check connection.json for an existing server
    const existing = readConnectionConfig();
    if (existing && (await checkExistingServer(existing))) {
      if (baseConfig.force) {
        await stopExistingServer(existing, baseConfig.password);
      } else {
        const displayHost = existing.host === '127.0.0.1' ? 'localhost' : existing.host;
        console.error(
          `TermBeam is already running on http://${displayHost}:${existing.port}\n` +
            'Use "termbeam resume" to reconnect, "termbeam sessions" to list sessions,\n' +
            'or "termbeam --force" to stop the existing server and start a new one.',
        );
        process.exit(1);
      }
    }

    // Also check the target port directly (handles stale/missing connection.json)
    if (baseConfig.force && targetPort !== 0) {
      const targetConfig = { host: targetHost, port: targetPort, password: baseConfig.password };
      if (await checkExistingServer(targetConfig)) {
        await stopExistingServer(targetConfig);
      }
    }

    let config;
    if (baseConfig.interactive) {
      config = await runInteractiveSetup(baseConfig);
    }
    const instance = createTermBeamServer(config ? { config } : undefined);

    process.on('SIGINT', () => {
      console.log('\n[termbeam] Shutting down...');
      instance.shutdown();
      setTimeout(() => process.exit(0), 500).unref();
    });
    process.on('SIGTERM', () => {
      console.log('\n[termbeam] Shutting down...');
      instance.shutdown();
      setTimeout(() => process.exit(0), 500).unref();
    });

    instance.start();
  }

  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
