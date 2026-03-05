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
  const { listSessions } = require('../src/resume');
  listSessions(process.argv.slice(3)).catch((err) => {
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

  async function main() {
    const baseConfig = parseArgs();

    const existing = readConnectionConfig();
    if (existing && (await checkExistingServer(existing))) {
      if (baseConfig.force) {
        const host = existing.host === 'localhost' ? '127.0.0.1' : existing.host;
        const headers = existing.password ? { Authorization: `Bearer ${existing.password}` } : {};
        console.log(`Stopping existing server on port ${existing.port}...`);
        await httpPost(`http://${host}:${existing.port}/api/shutdown`, headers);
        await new Promise((r) => setTimeout(r, 500));
      } else {
        console.error(
          `TermBeam is already running on http://${existing.host}:${existing.port}\n` +
            'Use "termbeam resume" to reconnect, "termbeam sessions" to list sessions,\n' +
            'or "termbeam --force" to stop the existing server and start a new one.',
        );
        process.exit(1);
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
