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
  // Catch typos of known subcommands before falling through to server start
  const KNOWN_SUBCOMMANDS = ['service', 'resume', 'sessions'];
  if (subcommand && !subcommand.startsWith('-')) {
    const match = KNOWN_SUBCOMMANDS.find(
      (cmd) =>
        cmd.startsWith(subcommand) ||
        subcommand.startsWith(cmd) ||
        levenshtein(cmd, subcommand) <= 2,
    );
    if (match) {
      console.error(
        `\x1b[31mError: Unknown command "${subcommand}". Did you mean "${match}"?\x1b[0m`,
      );
      process.exit(1);
    }
  }

  const { createTermBeamServer } = require('../src/server.js');
  const { parseArgs } = require('../src/cli');
  const { runInteractiveSetup } = require('../src/interactive');

  async function main() {
    const baseConfig = parseArgs();
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

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
