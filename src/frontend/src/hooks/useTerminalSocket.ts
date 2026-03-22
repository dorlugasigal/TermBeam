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
  reconnecting: boolean;
  reconnect: () => void;
  ws: WebSocket | null;
}

const INITIAL_RECONNECT_DELAY = 500;
const MAX_RECONNECT_DELAY = 30_000;
const KEEPALIVE_INTERVAL = 15_000;

// Original document title, saved once for title-bullet indicator
const originalTitle = document.title;

// Grace period after attach — suppress notification sounds for initial output burst
const ATTACH_GRACE_MS = 2000;
const attachGrace = new Map<string, ReturnType<typeof setTimeout>>();

// Strip OSC 4/10/11/12 sequences that can cause display issues
function stripOscSequences(data: string): string {
  return data.replace(/\x1b\](?:4|10|11|12);[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

// Restore document title and clear app badge when the page becomes visible
function handleVisibilityChange() {
  if (!document.hidden) {
    document.title = originalTitle;
    // Clear PWA app badge (iOS/Android home screen)
    try {
      navigator.clearAppBadge?.();
    } catch {
      // Badge API not supported
    }
  }
}
document.addEventListener('visibilitychange', handleVisibilityChange);

export function useTerminalSocket(options: UseTerminalSocketOptions): UseTerminalSocketReturn {
  const { sessionId, terminal, onExit, onConnected } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const zombieCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const connectFnRef = useRef<(() => void) | null>(null);

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
    if (zombieCheckRef.current) {
      clearTimeout(zombieCheckRef.current);
      zombieCheckRef.current = null;
    }
    if (disconnectGraceRef.current) {
      clearTimeout(disconnectGraceRef.current);
      disconnectGraceRef.current = null;
    }
  }, []);

  const send = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const lastSentDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  const lastResizeTimeRef = useRef(0);
  const resizeTrailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const RESIZE_THROTTLE_MS = 300;

  const sendResize = useCallback((cols: number, rows: number) => {
    const doSend = () => {
      const ws = wsRef.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      const last = lastSentDimsRef.current;
      if (last && last.cols === cols && last.rows === rows) return;
      lastSentDimsRef.current = { cols, rows };
      lastResizeTimeRef.current = Date.now();
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    };

    if (resizeTrailingRef.current) clearTimeout(resizeTrailingRef.current);

    const elapsed = Date.now() - lastResizeTimeRef.current;
    if (elapsed >= RESIZE_THROTTLE_MS) {
      doSend();
    } else {
      // Buffer trailing send to ensure final dimensions are always applied
      resizeTrailingRef.current = setTimeout(() => {
        resizeTrailingRef.current = null;
        doSend();
      }, RESIZE_THROTTLE_MS - elapsed);
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
        requestAnimationFrame(flushWrites);
      }
    }

    // Bell listener — when the terminal receives BEL (\x07), a running program
    // is explicitly requesting attention (command finished, input needed, etc.).
    // Trigger notification sound + desktop notification immediately.
    const bellDisposable = terminal.onBell(() => {
      if (!isNotificationsEnabled()) return;
      const store = useSessionStore.getState();
      if (store.activeId !== sessionId || document.hidden) {
        if (!attachGrace.has(sessionId)) {
          playNotificationSound();
        }
        const session = store.sessions.get(sessionId);
        if (document.hidden) {
          sendCommandNotification(session?.name ?? sessionId);
        }
      }
    });

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
            // Cancel disconnect grace timer — we reconnected before it fired,
            // so the user never sees the red dot or "reconnecting" state
            if (disconnectGraceRef.current) {
              clearTimeout(disconnectGraceRef.current);
              disconnectGraceRef.current = null;
            }
            setConnected(true);
            setReconnecting(false);
            onConnected?.();
            if (msg.scrollback) {
              terminal.write(stripOscSequences(msg.scrollback));
            }
            // Send current dimensions so the PTY adjusts to this client's viewport
            if (terminal.cols && terminal.rows) {
              ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
            }
            // Start grace period — suppress notification sounds for initial output burst
            const prev = attachGrace.get(sessionId);
            if (prev) clearTimeout(prev);
            attachGrace.set(
              sessionId,
              setTimeout(() => attachGrace.delete(sessionId), ATTACH_GRACE_MS),
            );
            break;
          }
          case 'output': {
            scheduleWrite(msg.data);

            // Skip unread tracking during attach grace period — scrollback
            // replay shouldn't trigger notifications or blue dots
            if (attachGrace.has(sessionId)) break;

            const store = useSessionStore.getState();
            const session = store.sessions.get(sessionId);

            // Unread tracking: only mark as unread when the PAGE is hidden
            // (user is in another app or browser tab). Within TermBeam,
            // session switching doesn't produce unread dots — the user
            // sees output when they switch tabs. This prevents idle shell
            // prompts from triggering false unread indicators.
            if (document.hidden && store.activeId !== sessionId) {
              const wasAlreadyUnread = session?.hasUnread ?? false;
              store.markUnread(sessionId);
              if (
                !wasAlreadyUnread &&
                isNotificationsEnabled()
              ) {
                playNotificationSound();
              }
            }
            break;
          }
          case 'exit': {
            onExit?.(msg.sessionId);
            break;
          }
          case 'notification': {
            // Server detected a command completed (child process exited).
            if (!isNotificationsEnabled()) break;

            const name = msg.sessionName ?? sessionId;
            const store = useSessionStore.getState();
            const isViewingThis = !document.hidden && store.activeId === sessionId;

            // User is looking at this session — no notification needed
            if (isViewingThis) break;

            if (document.hidden) {
              // App is backgrounded — full notification
              playNotificationSound();
              sendCommandNotification(name);
              if (!document.title.startsWith('(\u25CF) ')) {
                document.title = '(\u25CF) ' + originalTitle;
              }
            } else {
              // User is in TermBeam but on a different session tab — just toast
              toast.info(`Command finished in ${name}`);
            }
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
        // Guard against stale sockets — if a newer connection has already
        // replaced this one, ignore the close event from the old socket.
        if (wsRef.current !== ws) return;

        wsRef.current = null;

        if (keepaliveTimerRef.current) {
          clearInterval(keepaliveTimerRef.current);
          keepaliveTimerRef.current = null;
        }

        if (!mountedRef.current) return;

        // Delay showing disconnected UI — mobile app switches cause brief
        // WS disconnects that resolve within ~500ms. A 2s grace period
        // hides the red dot flicker so the user never notices.
        disconnectGraceRef.current = setTimeout(() => {
          disconnectGraceRef.current = null;
          setConnected(false);
          setReconnecting(true);
        }, 2000);

        // Start reconnect immediately (UI update is delayed above)
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

    // Instant reconnect when the page becomes visible again (e.g. mobile app switch).
    // Bypasses backoff timer so the user doesn't see a "disconnected" overlay.
    // On mobile, the OS suspends WebSocket connections when the app is backgrounded.
    // The socket may appear OPEN but actually be dead (zombie socket).
    function handleVisibilityReconnect() {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (!mountedRef.current) return;

      const hiddenDuration = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;

      // Cancel any pending backoff timer
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

      const ws = wsRef.current;

      // No socket at all → reconnect immediately
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        connect();
        return;
      }

      // Long background (>30s) → socket is almost certainly dead, force reconnect
      if (hiddenDuration > 30000) {
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
        setConnected(false);
        connect();
        return;
      }

      // Short background — verify socket is alive with a send attempt
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // Send failed → socket is dead, force reconnect
          ws.onclose = null;
          ws.close();
          wsRef.current = null;
          setConnected(false);
          connect();
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityReconnect);

    return () => {
      mountedRef.current = false;
      clearTimers();
      document.removeEventListener('visibilitychange', handleVisibilityReconnect);
      bellDisposable.dispose();
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
    if (zombieCheckRef.current) {
      clearTimeout(zombieCheckRef.current);
      zombieCheckRef.current = null;
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
    setReconnecting(false);
    connectFnRef.current?.();
  }, []);

  return { send, connected, reconnecting, sendResize, reconnect, ws: wsRef.current };
}
