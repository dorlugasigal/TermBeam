import { useRef, useEffect, useCallback, useState } from 'react';
import { getWebSocketUrl } from '@/services/api';
import { toast } from 'sonner';
import type { WSServerMessage } from '@/types';
import { useAgentStore } from '@/stores/agentStore';
import { AgentOutputParser } from '@/services/agentParser';
import type { ParsedEvent } from '@/services/agentParser';

export interface UseAgentSocketOptions {
  sessionId: string | null;
  onRawOutput?: (data: string) => void;
}

export interface UseAgentSocketReturn {
  sendMessage: (text: string) => void;
  sendRawInput: (data: string) => void;
  cancelAgent: () => void;
  connected: boolean;
  reconnecting: boolean;
  reconnect: () => void;
}

const INITIAL_RECONNECT_DELAY = 500;
const MAX_RECONNECT_DELAY = 30_000;
const KEEPALIVE_INTERVAL = 15_000;
const FLUSH_INTERVAL = 300;

function processEvents(
  events: ParsedEvent[],
  rawBufferRef: React.MutableRefObject<string>,
  onRawOutput?: (data: string) => void,
) {
  const store = useAgentStore.getState();

  for (const event of events) {
    switch (event.type) {
      case 'assistant-message':
        store.addMessage({
          role: 'assistant',
          content: event.content,
          toolCalls: event.toolCalls,
        });
        break;
      case 'prompt-ready':
        store.setStatus('idle');
        break;
      case 'thinking-start':
        store.setStatus('thinking');
        break;
      case 'raw-output':
        rawBufferRef.current += event.data;
        onRawOutput?.(event.data);
        break;
    }
  }
}

export function useAgentSocket(options: UseAgentSocketOptions): UseAgentSocketReturn {
  const { sessionId, onRawOutput } = options;
  const onRawOutputRef = useRef(onRawOutput);
  onRawOutputRef.current = onRawOutput;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const disconnectGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const connectFnRef = useRef<(() => void) | null>(null);
  const parserRef = useRef(new AgentOutputParser());
  const rawBufferRef = useRef('');
  const readyDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (disconnectGraceRef.current) {
      clearTimeout(disconnectGraceRef.current);
      disconnectGraceRef.current = null;
    }
    if (readyDelayRef.current) {
      clearTimeout(readyDelayRef.current);
      readyDelayRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;

    const store = useAgentStore.getState();
    store.addMessage({ role: 'user', content: text });
    store.setStatus('thinking');

    parserRef.current.setLastUserInput(text);
    // Send text first, then Enter (\r) with a small delay
    // Copilot CLI TUI needs a moment to process pasted text before Enter
    ws.send(JSON.stringify({ type: 'input', data: text }));
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: '\r' }));
      }
    }, 50);
  }, []);

  const cancelAgent = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ type: 'input', data: '\x03' }));
    useAgentStore.getState().setStatus('idle');
  }, []);

  const sendRawInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'input', data }));
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    mountedRef.current = true;

    const parser = parserRef.current;
    parser.reset();
    rawBufferRef.current = '';

    function connect() {
      if (!mountedRef.current) return;

      const url = getWebSocketUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        // Auth cookie is sent automatically with the upgrade request.
        // Attach to the agent session + send initial resize so the server
        // adds this client to session.clients (required for receiving output).
        ws.send(JSON.stringify({ type: 'attach', sessionId }));
        ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 30 }));
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

        // Keepalive pings
        keepaliveTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, KEEPALIVE_INTERVAL);

        // Flush timer — stream partial messages and finalize after silence
        flushTimerRef.current = setInterval(() => {
          const sinceLastFeed = Date.now() - parser.getLastFeedTime();
          const store = useAgentStore.getState();

          // Check if the agent CLI is ready for input
          if (!store.agentReady && parser.isAgentReady()) {
            // Add a delay — the CLI's input handler may still be initializing
            if (!readyDelayRef.current) {
              readyDelayRef.current = setTimeout(() => {
                useAgentStore.getState().setAgentReady(true);
              }, 2000);
            }
          }

          if (parser.hasPartialMessage()) {
            // Only stream/flush when agent is in thinking state (user sent a message)
            if (store.status !== 'thinking' && store.status !== 'working') {
              // Agent is loading/idle — just consume the buffer silently
              if (sinceLastFeed > 2000) {
                parser.flush(); // discard startup noise
              }
              return;
            }

            const streamContent = parser.getStreamingContent();

            if (streamContent) {
              const lastMsg = store.messages[store.messages.length - 1];
              if (lastMsg?.isStreaming && lastMsg.role === 'assistant') {
                store.updateLastAssistantMessage(streamContent);
              } else {
                store.addMessage({
                  role: 'assistant',
                  content: streamContent,
                  isStreaming: true,
                });
              }
            }

            // After sufficient silence (2s), finalize the message
            if (sinceLastFeed > 2000) {
              const event = parser.flush();
              if (event && event.type === 'assistant-message') {
                const lastMsg = store.messages[store.messages.length - 1];
                if (lastMsg?.isStreaming) {
                  store.updateLastAssistantMessage(event.content);
                  store.finalizeStreaming();
                } else if (event.content.trim()) {
                  store.addMessage({
                    role: 'assistant',
                    content: event.content,
                    toolCalls: event.toolCalls,
                  });
                }
              }
              store.setStatus('idle');
            }
          } else if (
            sinceLastFeed > 10000 &&
            store.status === 'thinking'
          ) {
            store.setStatus('idle');
          }
        }, FLUSH_INTERVAL);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        let msg: WSServerMessage;
        try {
          msg = JSON.parse(event.data as string) as WSServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'attached': {
            if (disconnectGraceRef.current) {
              clearTimeout(disconnectGraceRef.current);
              disconnectGraceRef.current = null;
            }
            setConnected(true);
            setReconnecting(false);

            // Replay scrollback through parser to reconstruct message history
            if (msg.scrollback) {
              const events = parser.feed(msg.scrollback);
              processEvents(events, rawBufferRef, onRawOutputRef.current);
            }
            break;
          }
          case 'output': {
            const events = parser.feed(msg.data);
            processEvents(events, rawBufferRef, onRawOutputRef.current);
            break;
          }
          case 'exit': {
            useAgentStore.getState().setStatus('done');
            toast.info('Agent session ended');
            break;
          }
          case 'error': {
            if (msg.message?.toLowerCase().includes('not found')) {
              mountedRef.current = false;
              toast.error(msg.message);
              ws.close();
            } else {
              toast.error(msg.message);
              useAgentStore.getState().addMessage({
                role: 'error',
                content: msg.message,
              });
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;

        if (keepaliveTimerRef.current) {
          clearInterval(keepaliveTimerRef.current);
          keepaliveTimerRef.current = null;
        }
        if (flushTimerRef.current) {
          clearInterval(flushTimerRef.current);
          flushTimerRef.current = null;
        }

        if (!mountedRef.current) return;

        // Grace period before showing disconnected UI (mobile app switches)
        if (disconnectGraceRef.current) clearTimeout(disconnectGraceRef.current);
        disconnectGraceRef.current = setTimeout(() => {
          disconnectGraceRef.current = null;
          setConnected(false);
          setReconnecting(true);
          useAgentStore.getState().setStatus('disconnected');
        }, 2000);

        // Exponential backoff reconnect
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose fires after onerror, handling reconnect
      };
    }

    connectFnRef.current = connect;
    connect();

    // Instant reconnect on visibility change (mobile app switch)
    function handleVisibilityReconnect() {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (!mountedRef.current) return;

      const hiddenDuration = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

      const ws = wsRef.current;

      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        connect();
        return;
      }

      // Long background (>30s) — socket is likely dead
      if (hiddenDuration > 30000) {
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
        setConnected(false);
        parser.reset();
        connect();
        return;
      }

      // Short background — verify socket is alive
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          ws.onclose = null;
          ws.close();
          wsRef.current = null;
          setConnected(false);
          parser.reset();
          connect();
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityReconnect);

    return () => {
      mountedRef.current = false;
      clearTimers();
      document.removeEventListener('visibilitychange', handleVisibilityReconnect);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [sessionId, clearTimers]);

  const reconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
      wsRef.current = null;
    }
    parserRef.current.reset();
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    setConnected(false);
    setReconnecting(false);
    connectFnRef.current?.();
  }, []);

  return { sendMessage, sendRawInput, cancelAgent, connected, reconnecting, reconnect };
}
