const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const termbeamPath = require.resolve('../bin/termbeam');
const resumePath = require.resolve('../src/resume');
const servicePath = require.resolve('../src/service');
const cliPath = require.resolve('../src/cli');

function clearCaches() {
  delete require.cache[termbeamPath];
  delete require.cache[resumePath];
  delete require.cache[servicePath];
  delete require.cache[cliPath];
}

describe('bin/termbeam.js subcommand dispatch', () => {
  let origArgv;
  let origExit;
  let exitCode;
  let exitCalled;

  beforeEach(() => {
    origArgv = process.argv;
    origExit = process.exit;
    exitCode = null;
    exitCalled = false;
    process.exit = (code) => {
      exitCalled = true;
      if (exitCode === null) exitCode = code;
    };
  });

  afterEach(() => {
    process.argv = origArgv;
    process.exit = origExit;
    clearCaches();
    // Clean up signal handlers that main() may register when falling through
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('should dispatch "resume" subcommand', async () => {
    let calledWith = null;
    require.cache[resumePath] = {
      id: resumePath,
      filename: resumePath,
      loaded: true,
      exports: {
        resume: async (args) => {
          calledWith = args;
        },
        list: async () => {},
        readConnectionConfig: () => null,
        writeConnectionConfig: () => {},
        removeConnectionConfig: () => {},
      },
    };

    process.argv = ['node', 'termbeam.js', 'resume', '--port', '4000'];
    require('../bin/termbeam');
    await new Promise((r) => setTimeout(r, 50));

    assert.deepStrictEqual(calledWith, ['--port', '4000']);
  });

  it('should dispatch "list" subcommand', async () => {
    let listCalled = false;
    require.cache[resumePath] = {
      id: resumePath,
      filename: resumePath,
      loaded: true,
      exports: {
        resume: async () => {},
        list: async () => {
          listCalled = true;
        },
        readConnectionConfig: () => null,
        writeConnectionConfig: () => {},
        removeConnectionConfig: () => {},
      },
    };

    process.argv = ['node', 'termbeam.js', 'list'];
    require('../bin/termbeam');
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(listCalled);
  });

  it('should dispatch "service" subcommand', async () => {
    let calledWith = null;
    require.cache[servicePath] = {
      id: servicePath,
      filename: servicePath,
      loaded: true,
      exports: {
        run: async (args) => {
          calledWith = args;
        },
      },
    };

    process.argv = ['node', 'termbeam.js', 'service', 'status'];
    require('../bin/termbeam');
    await new Promise((r) => setTimeout(r, 50));

    assert.deepStrictEqual(calledWith, ['status']);
  });

  it('should exit with error for unknown subcommand', () => {
    let helpPrinted = false;
    // Mock ALL dependencies loaded in the else block to prevent side effects
    const serverPath = require.resolve('../src/server');
    const interactivePath = require.resolve('../src/interactive');
    require.cache[cliPath] = {
      id: cliPath,
      filename: cliPath,
      loaded: true,
      exports: {
        printHelp: () => {
          helpPrinted = true;
        },
        parseArgs: () => ({
          port: 0,
          host: '127.0.0.1',
          password: null,
          force: false,
          interactive: false,
          cwd: process.cwd(),
          shell: '/bin/sh',
        }),
      },
    };
    require.cache[serverPath] = {
      id: serverPath,
      filename: serverPath,
      loaded: true,
      exports: {
        createTermBeamServer: () => ({ start: async () => {}, shutdown: () => {} }),
      },
    };
    require.cache[interactivePath] = {
      id: interactivePath,
      filename: interactivePath,
      loaded: true,
      exports: { runInteractiveSetup: async (cfg) => cfg },
    };
    require.cache[resumePath] = {
      id: resumePath,
      filename: resumePath,
      loaded: true,
      exports: {
        resume: async () => {},
        list: async () => {},
        readConnectionConfig: () => null,
        writeConnectionConfig: () => {},
        removeConnectionConfig: () => {},
      },
    };

    process.argv = ['node', 'termbeam.js', 'bogus'];
    require('../bin/termbeam');

    assert.ok(exitCalled);
    assert.equal(exitCode, 1);
    assert.ok(helpPrinted);

    delete require.cache[serverPath];
    delete require.cache[interactivePath];
  });

  it('should handle resume error by exiting with code 1', async () => {
    require.cache[resumePath] = {
      id: resumePath,
      filename: resumePath,
      loaded: true,
      exports: {
        resume: async () => {
          throw new Error('connection failed');
        },
        list: async () => {},
        readConnectionConfig: () => null,
        writeConnectionConfig: () => {},
        removeConnectionConfig: () => {},
      },
    };

    process.argv = ['node', 'termbeam.js', 'resume'];
    require('../bin/termbeam');
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(exitCalled);
    assert.equal(exitCode, 1);
  });

  it('should handle list error by exiting with code 1', async () => {
    require.cache[resumePath] = {
      id: resumePath,
      filename: resumePath,
      loaded: true,
      exports: {
        resume: async () => {},
        list: async () => {
          throw new Error('list failed');
        },
        readConnectionConfig: () => null,
        writeConnectionConfig: () => {},
        removeConnectionConfig: () => {},
      },
    };

    process.argv = ['node', 'termbeam.js', 'list'];
    require('../bin/termbeam');
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(exitCalled);
    assert.equal(exitCode, 1);
  });

  it('should handle service error by exiting with code 1', async () => {
    require.cache[servicePath] = {
      id: servicePath,
      filename: servicePath,
      loaded: true,
      exports: {
        run: async () => {
          throw new Error('service failed');
        },
      },
    };

    process.argv = ['node', 'termbeam.js', 'service', 'install'];
    require('../bin/termbeam');
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(exitCalled);
    assert.equal(exitCode, 1);
  });

  it('should be case-insensitive for subcommands', async () => {
    let calledWith = null;
    require.cache[resumePath] = {
      id: resumePath,
      filename: resumePath,
      loaded: true,
      exports: {
        resume: async (args) => {
          calledWith = args;
        },
        list: async () => {},
        readConnectionConfig: () => null,
        writeConnectionConfig: () => {},
        removeConnectionConfig: () => {},
      },
    };

    process.argv = ['node', 'termbeam.js', 'RESUME'];
    require('../bin/termbeam');
    await new Promise((r) => setTimeout(r, 50));

    assert.deepStrictEqual(calledWith, []);
  });
});
