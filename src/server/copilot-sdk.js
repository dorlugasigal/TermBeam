'use strict';

// Optional dependency — not available in CI or when not installed
let CopilotClient, approveAll;
try {
  ({ CopilotClient, approveAll } = require('@github/copilot-sdk'));
} catch {
  // SDK not installed — CopilotService will be unavailable
}
const log = require('../utils/logger');
const { isValidModelId, normalizeModels } = require('../utils/copilot-models');
const path = require('path');
const fs = require('fs');
const os = require('os');

const configDir = process.env.TERMBEAM_CONFIG_DIR || path.join(os.homedir(), '.termbeam');
const AUTH_URL_FILE = path.join(configDir, 'auth-urls.log');

// The model catalogue changes server-side (releases, retirements, org
// policy), so it comes from the SDK and is refreshed rather than hard-coded.
const MODELS_TTL_MS = 30 * 60 * 1000;
const MODELS_RETRY_MS = 60 * 1000;
const MODELS_TIMEOUT_MS = 20 * 1000;
const CURRENT_MODEL_TIMEOUT_MS = 3 * 1000;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function assertModelId(model) {
  if (model && !isValidModelId(model)) throw new Error('Invalid model id');
}

/**
 * Create a browser handler script that writes URLs to a file
 * instead of opening a browser. This lets us forward OAuth URLs to mobile clients.
 * Cross-platform: generates .cmd on Windows, .sh elsewhere.
 */
function ensureBrowserHandler() {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const ext = process.platform === 'win32' ? '.cmd' : '.sh';
  const handlerPath = path.join(configDir, `browser-handler${ext}`);
  const script =
    process.platform === 'win32'
      ? `@echo off\r\necho %1 >> "${AUTH_URL_FILE}"\r\n`
      : `#!/bin/sh\necho "$1" >> "${AUTH_URL_FILE}"\n`;
  const mode = process.platform === 'win32' ? 0o700 : 0o755;
  try {
    fs.writeFileSync(handlerPath, script, { mode });
  } catch {
    // Ignore — fallback to BROWSER=echo
  }
  return handlerPath;
}

/**
 * Read MCP server configs from the user's Copilot config directory.
 * Injects BROWSER env var into each local server to intercept OAuth flows.
 */
function loadMcpConfig(browserHandler) {
  const configDir = path.join(os.homedir(), '.copilot');
  const mcpPath = path.join(configDir, 'mcp-config.json');
  try {
    const raw = fs.readFileSync(mcpPath, 'utf8');
    const parsed = JSON.parse(raw);
    const servers = parsed.mcpServers || null;
    if (!servers) return null;
    // Inject BROWSER handler into each local MCP server's env
    for (const [, config] of Object.entries(servers)) {
      if (!config || typeof config !== 'object') continue;
      if (!config.type || config.type === 'local' || config.type === 'stdio') {
        config.env = { ...config.env, BROWSER: browserHandler };
      }
    }
    return servers;
  } catch {
    return null;
  }
}

class CopilotService {
  constructor() {
    this.client = null;
    this.sessions = new Map(); // sessionId -> { session, listeners }
    this._startPromise = null;
    this.browserHandler = ensureBrowserHandler();
    this.mcpServers = loadMcpConfig(this.browserHandler);
    if (this.mcpServers) {
      const count = Object.keys(this.mcpServers).length;
      log.info(`Loaded ${count} MCP server(s) from ~/.copilot/mcp-config.json`);
    }
    this._authUrlOffset = 0;
    this._models = null; // { models, fetchedAt }
    this._modelsPromise = null;
    this._watchAuthUrls();
  }

  /**
   * Models the signed-in account can use, as `{ id, name }`. After the first
   * load this answers from cache and refreshes in the background once stale.
   */
  async listModels() {
    const cached = this._models;
    if (!cached) return this._refreshModels();
    if (Date.now() - cached.fetchedAt >= MODELS_TTL_MS) this._refreshModels().catch(() => {});
    return cached.models;
  }

  _refreshModels() {
    if (!this._modelsPromise) {
      this._modelsPromise = this._fetchModels()
        .then((models) => {
          this._models = { models, fetchedAt: Date.now() };
          return models;
        })
        .catch((err) => {
          log.warn(`Could not load the Copilot model list: ${err.message}`);
          // Keep serving the previous list; try again after a short pause.
          if (this._models) this._models.fetchedAt = Date.now() - MODELS_TTL_MS + MODELS_RETRY_MS;
          throw err;
        })
        .finally(() => {
          this._modelsPromise = null;
        });
    }
    return this._modelsPromise;
  }

  async _fetchModels() {
    const client = await withTimeout(
      this.ensureClient(),
      MODELS_TIMEOUT_MS,
      'Timed out starting Copilot',
    );
    // The SDK caches models.list for the client's lifetime; clear it so a
    // long-running server picks up newly released and retired models.
    if (this._models && 'modelsCache' in client) client.modelsCache = null;
    const raw = await withTimeout(
      client.listModels(),
      MODELS_TIMEOUT_MS,
      'Timed out listing Copilot models',
    );
    return normalizeModels(raw);
  }

  /** The model a session is running, or null when the SDK can't say. */
  async _readCurrentModel(session) {
    try {
      const current = await withTimeout(
        Promise.resolve(session.rpc?.model?.getCurrent?.()),
        CURRENT_MODEL_TIMEOUT_MS,
        'Timed out reading the session model',
      );
      return isValidModelId(current?.modelId) ? current.modelId : null;
    } catch {
      return null;
    }
  }

  /**
   * Watch the auth URL file for new OAuth URLs written by MCP servers.
   * Forward them to all active WebSocket listeners.
   */
  _watchAuthUrls() {
    // Truncate file on startup
    try {
      fs.writeFileSync(AUTH_URL_FILE, '');
    } catch {
      /* ignore */
    }
    this._authUrlOffset = 0;

    this._authPollTimer = setInterval(() => {
      try {
        const content = fs.readFileSync(AUTH_URL_FILE, 'utf8');
        if (content.length <= this._authUrlOffset) return;
        const newContent = content.slice(this._authUrlOffset);
        this._authUrlOffset = content.length;
        const urls = newContent.split('\n').filter((u) => u.trim().startsWith('http'));
        for (const url of urls) {
          try {
            log.info(`Auth URL intercepted: ${new URL(url).origin}/...`);
          } catch {
            log.info('Auth URL intercepted');
          }
          const event = { type: 'copilot.auth_url', data: { url: url.trim() } };
          // Forward to ALL active session listeners
          for (const [, entry] of this.sessions) {
            if (entry.listener) entry.listener(event);
          }
        }
      } catch {
        /* file may not exist yet */
      }
    }, 500);
  }

  async ensureClient() {
    if (this.client) return this.client;
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._doStart();
    return this._startPromise;
  }

  async _doStart() {
    try {
      if (!CopilotClient) throw new Error('Copilot SDK not installed');
      process.env.BROWSER = this.browserHandler;
      this.client = new CopilotClient({
        cwd: process.cwd(),
      });
      await this.client.start();
      // A failed start stops the OAuth URL watcher; bring it back once Copilot runs.
      if (!this._authPollTimer) this._watchAuthUrls();
      log.info('Copilot SDK client started');
      return this.client;
    } catch (err) {
      log.error('Failed to start Copilot SDK client:', err.message);
      this.client = null;
      if (this._authPollTimer) {
        clearInterval(this._authPollTimer);
        this._authPollTimer = null;
      }
      throw err;
    } finally {
      this._startPromise = null;
    }
  }

  /**
   * Custom permission handler that intercepts URL requests (OAuth flows)
   * and forwards them to the WebSocket client instead of opening a server-side browser.
   */
  _createPermissionHandler(sessionId, eventBuffer) {
    return (request) => {
      if (request.kind === 'url' && request.url) {
        log.info(`Auth URL requested for session ${sessionId}`);
        const entry = this.sessions.get(sessionId);
        const event = {
          type: 'copilot.auth_url',
          data: { url: request.url },
        };
        if (entry?.listener) {
          entry.listener(event);
        } else if (entry) {
          entry.eventBuffer.push(event);
        } else if (eventBuffer) {
          // Buffer pre-registration events until session entry exists
          eventBuffer.push(event);
        }
      }
      return { kind: 'approved' };
    };
  }

  async resumeSession(sdkSessionId, options = {}) {
    assertModelId(options.model);
    const client = await this.ensureClient();
    const sessionId = require('crypto').randomBytes(16).toString('hex');

    const eventBuffer = [];

    const resumeCwd = options.cwd || process.cwd();
    const configDir = path.join(os.homedir(), '.copilot');

    const resumeConfig = {
      onPermissionRequest: this._createPermissionHandler(sessionId, eventBuffer),
      streaming: true,
      workingDirectory: resumeCwd,
      configDir,
      onUserInputRequest: async (request) => {
        const event = {
          type: 'copilot.user_input_request',
          data: {
            question: request.question,
            choices: request.choices,
            allowFreeform: request.allowFreeform !== false,
          },
        };
        const entry = this.sessions.get(sessionId);
        const listener = entry?.listener;
        if (listener) listener(event);
        else eventBuffer.push(event);

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ answer: '', wasFreeform: true });
          }, 120000);

          const storeResolve = (answer) => {
            clearTimeout(timeout);
            resolve(answer);
          };

          if (entry) {
            entry.pendingInputResolve = storeResolve;
          } else {
            // Store on eventBuffer so it can be transferred after session registration
            eventBuffer._pendingInputResolve = storeResolve;
          }
        });
      },
    };

    if (this.mcpServers) {
      resumeConfig.mcpServers = this.mcpServers;
    }
    // Without one, the session keeps the model it was running.
    if (options.model) resumeConfig.model = options.model;

    const session = await client.resumeSession(sdkSessionId, resumeConfig);

    const unsubscribe = session.on((event) => {
      try {
        this._trackModel(sessionId, event);
        const mapped = this._mapEvent(event);
        if (mapped) {
          const entry = this.sessions.get(sessionId);
          if (entry) {
            if (!entry.messageHistory) entry.messageHistory = [];
            entry.messageHistory.push(mapped);
          }
          const cb = entry?.listener;
          if (cb) cb(mapped);
          else eventBuffer.push(mapped);
        }
      } catch (err) {
        log.warn(`Error processing event for session ${sessionId}: ${err.message}`);
      }
    });

    // Get existing messages for replay
    const existingMessages = await session.getMessages().catch(() => []);

    const now = new Date().toISOString();
    this.sessions.set(sessionId, {
      session,
      unsubscribe,
      eventBuffer,
      listener: null,
      pendingInputResolve: null,
      cwd: options.cwd || process.cwd(),
      model: options.model || null,
      name: options.name || 'Resumed Session',
      ptySessionId: options.ptySessionId || null,
      createdAt: now,
      lastActivity: now,
      sdkSessionId,
      existingMessages,
    });

    // Transfer any pending input resolve stored before session registration
    if (eventBuffer._pendingInputResolve) {
      this.sessions.get(sessionId).pendingInputResolve = eventBuffer._pendingInputResolve;
    }

    await this._recordCurrentModel(sessionId, session);
    log.info(`Copilot SDK session resumed: ${sessionId} (from SDK session ${sdkSessionId})`);
    return sessionId;
  }

  /**
   * Keep `entry.model` on the model that is actually answering — Copilot
   * resolves its default on the first turn, and the model can be switched
   * from elsewhere — and tell a live client. Not added to the replay
   * history: on reconnect `copilot.created` carries the current model.
   */
  _trackModel(sessionId, event) {
    let model = null;
    if (event.type === 'session.model_change') model = event.data?.newModel;
    else if (event.type === 'assistant.message' && !event.data?.parentToolCallId) {
      model = event.data?.model;
    }
    const entry = this.sessions.get(sessionId);
    if (!entry || !isValidModelId(model) || entry.model === model) return;
    entry.model = model;
    entry.listener?.({ type: 'copilot.model_changed', data: { model } });
  }

  /** Fill in the model Copilot picked when the caller didn't name one. */
  async _recordCurrentModel(sessionId, session) {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.model) return;
    const model = await this._readCurrentModel(session);
    if (model && !entry.model) entry.model = model;
  }

  async createSession(options = {}) {
    assertModelId(options.model);
    const client = await this.ensureClient();
    const sessionId = require('crypto').randomBytes(16).toString('hex');

    const eventBuffer = []; // Buffer events until a listener connects
    let listener = null; // WebSocket event callback

    const sessionCwd = options.cwd || process.cwd();
    const configDir = path.join(os.homedir(), '.copilot');

    const sessionConfig = {
      streaming: true,
      workingDirectory: sessionCwd,
      configDir,
      onPermissionRequest: this._createPermissionHandler(sessionId, eventBuffer),
      onUserInputRequest: async (request) => {
        // Forward to WebSocket listener for UI to handle
        const event = {
          type: 'copilot.user_input_request',
          data: {
            question: request.question,
            choices: request.choices,
            allowFreeform: request.allowFreeform !== false,
          },
        };
        const entry = this.sessions.get(sessionId);
        listener = entry?.listener;
        if (listener) listener(event);
        else eventBuffer.push(event);

        // Wait for response from UI (with timeout)
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ answer: '', wasFreeform: true });
          }, 120000); // 2 min timeout

          const storeResolve = (answer) => {
            clearTimeout(timeout);
            resolve(answer);
          };

          // Store resolver for the WebSocket handler to call
          if (entry) {
            entry.pendingInputResolve = storeResolve;
          } else {
            // Store on eventBuffer so it can be transferred after session registration
            eventBuffer._pendingInputResolve = storeResolve;
          }
        });
      },
    };

    // Pass user's MCP servers so all tools are available
    if (this.mcpServers) {
      sessionConfig.mcpServers = this.mcpServers;
    }
    // Without a model, Copilot uses the account's current default.
    if (options.model) sessionConfig.model = options.model;

    const session = await client.createSession(sessionConfig);

    // Set up event forwarding
    const unsubscribe = session.on((event) => {
      try {
        this._trackModel(sessionId, event);
        const mapped = this._mapEvent(event);
        if (mapped) {
          const entry = this.sessions.get(sessionId);
          // Store for replay on reconnect
          if (entry) {
            if (!entry.messageHistory) entry.messageHistory = [];
            entry.messageHistory.push(mapped);
          }
          const cb = entry?.listener;
          if (cb) cb(mapped);
          else eventBuffer.push(mapped);
        }
      } catch (err) {
        log.warn(`Error processing event for session ${sessionId}: ${err.message}`);
      }
    });

    const now = new Date().toISOString();
    this.sessions.set(sessionId, {
      session,
      unsubscribe,
      eventBuffer,
      listener: null,
      pendingInputResolve: null,
      cwd: options.cwd || process.cwd(),
      model: options.model || null,
      name: options.name || 'Copilot Session',
      ptySessionId: options.ptySessionId || null,
      createdAt: now,
      lastActivity: now,
    });

    // Transfer any pending input resolve stored before session registration
    if (eventBuffer._pendingInputResolve) {
      this.sessions.get(sessionId).pendingInputResolve = eventBuffer._pendingInputResolve;
    }

    await this._recordCurrentModel(sessionId, session);
    log.info(`Copilot SDK session created: ${sessionId}`);
    return sessionId;
  }

  setListener(sessionId, callback, owner) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    if (entry.listener && callback && entry.listener !== callback) {
      log.warn(
        `Overwriting existing listener for session ${sessionId} — only one client supported per copilot session`,
      );
    }
    entry.listener = callback;
    entry._listenerOwner = owner || null;
    // Flush buffered events (only when attaching a real listener)
    if (callback) {
      while (entry.eventBuffer.length > 0) {
        callback(entry.eventBuffer.shift());
      }
    }
    return true;
  }

  async sendMessage(sessionId, prompt) {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error('Session not found');
    entry.lastActivity = new Date().toISOString();
    // Store user message in history for replay on reconnect
    if (!entry.messageHistory) entry.messageHistory = [];
    entry.messageHistory.push({
      type: 'copilot.user_message',
      data: { content: prompt },
    });
    await entry.session.send({ prompt });
  }

  respondToInput(sessionId, answer) {
    const entry = this.sessions.get(sessionId);
    if (!entry?.pendingInputResolve) return false;
    entry.pendingInputResolve({
      answer: answer.text,
      wasFreeform: answer.wasFreeform !== false,
    });
    entry.pendingInputResolve = null;
    return true;
  }

  getMessages(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return [];

    // If we already have messageHistory, return it (it includes replayed existing messages)
    if (entry.messageHistory && entry.messageHistory.length > 0) {
      return entry.messageHistory;
    }

    // For resumed sessions with no messageHistory yet, convert existing SDK events
    if (entry.existingMessages?.length) {
      const existing = [];
      for (const evt of entry.existingMessages) {
        const mapped = this._mapEvent(evt);
        if (mapped) existing.push(mapped);
        if (evt.type === 'user.message' && evt.data?.content) {
          existing.push({ type: 'copilot.user_message', data: { content: evt.data.content } });
        }
      }
      return existing;
    }

    return [];
  }

  async setModel(sessionId, model) {
    if (!isValidModelId(model)) throw new Error('Invalid model id');
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error('Session not found');
    await entry.session.setModel(model);
    entry.model = model;
  }

  async abortSession(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    try {
      await entry.session.abort();
    } catch {
      // Ignore — session may already be idle
    }
  }

  async disconnectSession(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    // Clean up listener first to prevent leaks
    if (entry.unsubscribe) {
      try {
        entry.unsubscribe();
      } catch {
        /* ignore */
      }
    }
    // Clear any pending input timeout
    if (entry.pendingInputResolve) {
      entry.pendingInputResolve({ answer: '', wasFreeform: true });
    }
    try {
      await entry.session.disconnect();
    } catch (err) {
      log.warn(`Error disconnecting session ${sessionId}: ${err.message}`);
    }
    this.sessions.delete(sessionId);
    log.info(`Copilot SDK session disconnected: ${sessionId}`);
  }

  listSessions() {
    return Array.from(this.sessions.keys());
  }

  async listSdkSessions() {
    try {
      const client = await this.ensureClient();
      const sessions = await client.listSessions();
      return sessions.map((s) => ({
        sessionId: s.sessionId,
        startTime: s.startTime,
        modifiedTime: s.modifiedTime,
        summary: s.summary,
        isRemote: s.isRemote,
        cwd: s.context?.cwd,
        repository: s.context?.repository,
        branch: s.context?.branch,
      }));
    } catch {
      return [];
    }
  }

  listSessionsDetailed() {
    const result = [];
    for (const [id, entry] of this.sessions) {
      result.push({
        id,
        name: entry.name || 'Copilot Session',
        cwd: entry.cwd || process.cwd(),
        model: entry.model || null,
        ptySessionId: entry.ptySessionId || null,
        createdAt: entry.createdAt || new Date().toISOString(),
        lastActivity: entry.lastActivity || entry.createdAt || new Date().toISOString(),
      });
    }
    return result;
  }

  async shutdown() {
    if (this._authPollTimer) clearInterval(this._authPollTimer);
    for (const [id] of this.sessions) {
      await this.disconnectSession(id);
    }
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    log.info('Copilot SDK service shut down');
  }

  _mapEvent(event) {
    // Map SDK events to our WebSocket protocol
    switch (event.type) {
      case 'assistant.message':
        return {
          type: 'copilot.assistant_message',
          data: {
            content: event.data.content,
            toolRequests: event.data.toolRequests,
          },
        };
      case 'assistant.message_delta':
        return {
          type: 'copilot.message_delta',
          data: { deltaContent: event.data.deltaContent },
        };
      case 'assistant.reasoning':
        return {
          type: 'copilot.reasoning',
          data: { content: event.data.content },
        };
      case 'assistant.reasoning_delta':
        return {
          type: 'copilot.reasoning_delta',
          data: { deltaContent: event.data.deltaContent },
        };
      case 'tool.execution_start':
        return {
          type: 'copilot.tool_start',
          data: {
            toolCallId: event.data?.toolCallId,
            toolName: event.data?.toolName,
            input: event.data?.arguments || event.data?.input || event.data?.args || {},
          },
        };
      case 'tool.execution_complete':
        return {
          type: 'copilot.tool_complete',
          data: {
            toolCallId: event.data?.toolCallId,
            toolName: event.data?.toolName,
            result: event.data?.result || event.data?.output || event.data,
            duration: event.data?.duration || event.data?.durationMs,
          },
        };
      case 'subagent.started':
        return {
          type: 'copilot.subagent_start',
          data: {
            toolCallId: event.data?.toolCallId,
            agentName: event.data?.agentName,
            agentDisplayName: event.data?.agentDisplayName,
          },
        };
      case 'subagent.completed':
        return {
          type: 'copilot.subagent_complete',
          data: {
            toolCallId: event.data?.toolCallId,
            agentDisplayName: event.data?.agentDisplayName,
            model: event.data?.model,
            totalToolCalls: event.data?.totalToolCalls,
            totalTokens: event.data?.totalTokens,
            durationMs: event.data?.durationMs,
          },
        };
      case 'session.idle':
        return { type: 'copilot.idle', data: {} };
      case 'session.mode_changed':
        return {
          type: 'copilot.mode_changed',
          data: { mode: event.data?.mode },
        };
      default:
        return null; // Skip internal events
    }
  }
}

module.exports = { CopilotService };
