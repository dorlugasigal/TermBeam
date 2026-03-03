#!/usr/bin/env node

// Dispatch subcommands before loading the server
const subcommand = (process.argv[2] || '').toLowerCase();
if (subcommand === 'service') {
  const { run } = require('../src/service');
  run(process.argv.slice(3)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  const { createTermBeamServer } = require('../src/server.js');
  const instance = createTermBeamServer();

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
