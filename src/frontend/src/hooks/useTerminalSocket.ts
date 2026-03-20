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

const INITIAL_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30_000;
const KEEPALIVE_INTERVAL = 30_000;
const SILENCE_TIMEOUT = 5000;

// Minimum duration of output activity before a silence triggers a notification.
// Prevents notifications for trivial/instant commands (e.g. `ls`, single-line output).
const MIN_ACTIVITY_DURATION = 2000;

// Original document title, saved once for title-bullet indicator
const originalTitle = document.title;

// Silence timers for command-completion notifications (sessionId → timeout)
const silenceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Track when the current burst of output activity started per session.
// Used to avoid notifying for trivial/instant commands.
const activityStart = new Map<string, number>();
// Track whether we already notified for the current activity burst,
// so we don't send repeated notifications during a long build with pauses.
const notifiedForBurst = new Set<string>();

// Grace period after attach — suppress notification sounds for initial output burst
const ATTACH_GRACE_MS = 2000;
const attachGrace = new Map<string, ReturnType<typeof setTimeout>>();

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
            const store = useSessionStore.getState();
            const session = store.sessions.get(sessionId);

            // Unread tracking + notification sound.
            // Sound only plays when the PAGE is hidden (user in another app).
            // Within TermBeam, the visual unread dot on the tab is sufficient.
            if (store.activeId !== sessionId) {
              const wasAlreadyUnread = session?.hasUnread ?? false;
              store.markUnread(sessionId);
              if (
                document.hidden &&
                !wasAlreadyUnread &&
                !attachGrace.has(sessionId) &&
                isNotificationsEnabled()
              ) {
                playNotificationSound();
              }
            }

            // Title bullet indicator when page is hidden
            if (document.hidden && isNotificationsEnabled()) {
              if (!document.title.startsWith('(\u25CF) ')) {
                document.title = '(\u25CF) ' + originalTitle;
              }
            }

            // Activity-based command-completion notification.
            // Tracks output bursts and only notifies once when a long-running
            // command goes silent (idle after sustained activity).
            if (isNotificationsEnabled()) {
              // Mark start of activity burst if not already tracking
              if (!activityStart.has(sessionId)) {
                activityStart.set(sessionId, Date.now());
                notifiedForBurst.delete(sessionId);
              }

              const existing = silenceTimers.get(sessionId);
              if (existing) clearTimeout(existing);
              silenceTimers.set(
                sessionId,
                setTimeout(() => {
                  silenceTimers.delete(sessionId);
                  const start = activityStart.get(sessionId);
                  const duration = start ? Date.now() - start : 0;
                  // Reset activity tracking — this burst is over
                  activityStart.delete(sessionId);

                  if (
                    isNotificationsEnabled() &&
                    document.hidden &&
                    duration >= MIN_ACTIVITY_DURATION &&
                    !notifiedForBurst.has(sessionId)
                  ) {
                    notifiedForBurst.add(sessionId);
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
          case 'update-progress': {
            // Forward update progress events to the UpdateBanner via a custom DOM event
            window.dispatchEvent(new MessageEvent('termbeam:ws-message', { data: event.data }));
            break;
          }
        }
      };

      ws.onclose = () => {
        // Guard against stale sockets — if a newer connection has already
        // replaced this one, ignore the close event from the old socket.
        if (wsRef.current !== ws) return;

        setConnected(false);
        wsRef.current = null;

        if (keepaliveTimerRef.current) {
          clearInterval(keepaliveTimerRef.current);
          keepaliveTimerRef.current = null;
        }

        if (!mountedRef.current) return;

        // Exponential backoff reconnect
        setReconnecting(true);
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
    function handleVisibilityReconnect() {
      if (document.hidden || !mountedRef.current) return;
      const ws = wsRef.current;
      // Skip if already connected or a connection attempt is in progress
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))
        return;
      // Cancel pending backoff timer and reconnect immediately
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      connect();
    }
    document.addEventListener('visibilitychange', handleVisibilityReconnect);

    return () => {
      mountedRef.current = false;
      clearTimers();
      document.removeEventListener('visibilitychange', handleVisibilityReconnect);
      // Clean up silence timer for this session
      const timer = silenceTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        silenceTimers.delete(sessionId);
      }
      activityStart.delete(sessionId);
      notifiedForBurst.delete(sessionId);
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
