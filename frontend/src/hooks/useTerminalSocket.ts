import { useRef, useEffect, useCallback, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { getWebSocketUrl } from '@/services/api';
import { toast } from 'sonner';
import type { WSServerMessage } from '@/types';
import { useSessionStore } from '@/stores/sessionStore';
import {
  playNotificationSound,
  isNotificationsEnabled,
  sendCommandNotification,
} from '@/services/audio';

export interface UseTerminalSocketOptions {
  sessionId: string;
  terminal: Terminal | null;
  onExit?: (sessionId: string) => void;
  onConnected?: () => void;
}

export interface UseTerminalSocketReturn {
  send: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  connected: boolean;
  reconnect: () => void;
  ws: WebSocket | null;
}

const INITIAL_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30_000;
const KEEPALIVE_INTERVAL = 30_000;
const SILENCE_TIMEOUT = 3000;

// Original document title, saved once for title-bullet indicator
const originalTitle = document.title;

// Silence timers for command-completion notifications (sessionId → timeout)
const silenceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Strip OSC 4/10/11/12 sequences that can cause display issues
function stripOscSequences(data: string): string {
  return data.replace(/\x1b\](?:4|10|11|12);[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

// Restore document title when the page becomes visible
function handleVisibilityChange() {
  if (!document.hidden) {
    document.title = originalTitle;
  }
}
document.addEventListener('visibilitychange', handleVisibilityChange);

export function useTerminalSocket(options: UseTerminalSocketOptions): UseTerminalSocketReturn {
  const { sessionId, terminal, onExit, onConnected } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const connectFnRef = useRef<(() => void) | null>(null);

  const [connected, setConnected] = useState(false);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
  }, []);

  const send = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  useEffect(() => {
    if (!terminal || !sessionId) return;
    mountedRef.current = true;

    // RAF-based write coalescer to batch rapid terminal output and reduce flicker
    let writeBuffer = '';
    let rafPending = false;

    function flushWrites() {
      if (writeBuffer && terminal) {
        terminal.write(writeBuffer);
        writeBuffer = '';
      }
      rafPending = false;
    }

    function scheduleWrite(data: string) {
      writeBuffer += data;
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          // For large bursts, defer one extra frame to let the browser
          // coalesce even more data before painting
          if (writeBuffer.length > 512) {
            requestAnimationFrame(flushWrites);
          } else {
            flushWrites();
          }
        });
      }
    }

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
        ws.send(JSON.stringify({ type: 'attach', sessionId }));
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

        // Start keepalive pings
        keepaliveTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, KEEPALIVE_INTERVAL);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current || !terminal) return;

        let msg: WSServerMessage;
        try {
          msg = JSON.parse(event.data as string) as WSServerMessage;
        } catch {
          // Write raw non-JSON data to terminal as fallback (matches old UI behavior)
          const rawData = event.data;
          if (typeof rawData === 'string' && rawData.length > 0) {
            scheduleWrite(rawData);
          }
          return;
        }

        switch (msg.type) {
          case 'attached': {
            setConnected(true);
            onConnected?.();
            if (msg.scrollback) {
              terminal.write(stripOscSequences(msg.scrollback));
            }
            // Send current dimensions so the PTY adjusts to this client's viewport
            if (terminal.cols && terminal.rows) {
              ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
            }
            break;
          }
          case 'output': {
            scheduleWrite(msg.data);
            const store = useSessionStore.getState();
            const session = store.sessions.get(sessionId);

            // Sound: only play when transitioning from read → unread
            if (store.activeId !== sessionId) {
              const wasAlreadyUnread = session?.hasUnread ?? false;
              store.markUnread(sessionId);
              if (!wasAlreadyUnread && isNotificationsEnabled()) {
                playNotificationSound();
              }
            }

            // Title bullet indicator when page is hidden
            if (document.hidden && isNotificationsEnabled()) {
              if (!document.title.startsWith('(\u25CF) ')) {
                document.title = '(\u25CF) ' + originalTitle;
              }
            }

            // 3s silence timer for command-completion desktop notification
            if (isNotificationsEnabled()) {
              const existing = silenceTimers.get(sessionId);
              if (existing) clearTimeout(existing);
              silenceTimers.set(
                sessionId,
                setTimeout(() => {
                  silenceTimers.delete(sessionId);
                  if (document.hidden) {
                    sendCommandNotification(session?.name ?? sessionId);
                  }
                }, SILENCE_TIMEOUT),
              );
            }
            break;
          }
          case 'exit': {
            onExit?.(msg.sessionId);
            break;
          }
          case 'error': {
            if (msg.message?.toLowerCase().includes('not found')) {
              mountedRef.current = false;
              // Only show toast if user didn't intentionally delete this session
              const store = useSessionStore.getState();
              if (!store.isDeleted(sessionId)) {
                toast.error(msg.message);
                onExit?.(sessionId);
              }
              ws.close();
            } else {
              toast.error(msg.message);
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        if (keepaliveTimerRef.current) {
          clearInterval(keepaliveTimerRef.current);
          keepaliveTimerRef.current = null;
        }

        if (!mountedRef.current) return;

        // Exponential backoff reconnect
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire after onerror, handling reconnect
      };
    }

    connectFnRef.current = connect;
    connect();

    return () => {
      mountedRef.current = false;
      clearTimers();
      // Clean up silence timer for this session
      const timer = silenceTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        silenceTimers.delete(sessionId);
      }
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
  }, [terminal, sessionId, onExit, onConnected, clearTimers]);

  const reconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
      wsRef.current = null;
    }
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    setConnected(false);
    connectFnRef.current?.();
  }, []);

  return { send, connected, sendResize, reconnect, ws: wsRef.current };
}
