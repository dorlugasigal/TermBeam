import { useRef, useEffect, useCallback, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { getWebSocketUrl } from '@/services/api';
import { toast } from 'sonner';
import type { WSServerMessage } from '@/types';
import { useSessionStore } from '@/stores/sessionStore';
import { useConnectionStore } from '@/stores/connectionStore';
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
  /** Timestamp of the last keystroke dropped because the link was down. */
  inputBlockedAt: number | null;
  reconnect: () => void;
  ws: WebSocket | null;
}

const RECONNECT_DELAYS = [400, 1000, 2000, 4000, 8000, 10_000];
const KEEPALIVE_INTERVAL = 15_000;
// No pong for this long ⇒ the socket is a zombie (common after sleep / network
// handoff: the relay keeps a dead TCP leg "open").
const PONG_TIMEOUT = 40_000;
const WS_CLOSE_UNAUTHORIZED = 4401;

// Original document title, saved once for title-bullet indicator
const originalTitle = document.title;

// Grace period after attach — suppress notification sounds for initial output burst
const ATTACH_GRACE_MS = 2000;
const attachGrace = new Map<string, ReturnType<typeof setTimeout>>();

// Strip OSC 4/10/11/12 sequences that can cause display issues
function stripOscSequences(data: string): string {
  return data.replace(/\x1b\](?:4|10|11|12);[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function jitter(ms: number): number {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
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
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const disconnectGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const lastPongRef = useRef(0);
  const mountedRef = useRef(true);
  const pausedRef = useRef(false);
  const connectFnRef = useRef<(() => void) | null>(null);

  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [inputBlockedAt, setInputBlockedAt] = useState<number | null>(null);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
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
    } else {
      // Never queue keystrokes for surprise execution later — drop them and
      // tell the user input is paused.
      setInputBlockedAt(Date.now());
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
    pausedRef.current = false;
    const connection = useConnectionStore.getState();
    const unregister = connection.registerSocket();

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

    function markDisconnectedSoon() {
      // Delay showing disconnected UI — mobile app switches cause brief
      // WS disconnects that resolve within ~500ms.
      if (disconnectGraceRef.current) clearTimeout(disconnectGraceRef.current);
      disconnectGraceRef.current = setTimeout(() => {
        disconnectGraceRef.current = null;
        setConnected(false);
        setReconnecting(true);
      }, 1500);
    }

    function scheduleReconnect() {
      if (!mountedRef.current || reconnectTimerRef.current) return;
      const delay = jitter(
        RECONNECT_DELAYS[Math.min(attemptRef.current, RECONNECT_DELAYS.length - 1)]!,
      );
      attemptRef.current++;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    function connect() {
      if (!mountedRef.current) return;
      // While the store knows reconnecting is pointless (offline, host away,
      // locked, tunnel sign-in) stay paused until it signals resume.
      if (!useConnectionStore.getState().canConnect()) {
        pausedRef.current = true;
        return;
      }
      pausedRef.current = false;
      const existing = wsRef.current;
      if (existing && existing.readyState <= WebSocket.OPEN) return;

      const url = getWebSocketUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;
      let unauthorized = false;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ type: 'attach', sessionId }));
        lastPongRef.current = Date.now();

        if (keepaliveTimerRef.current) clearInterval(keepaliveTimerRef.current);
        keepaliveTimerRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (Date.now() - lastPongRef.current > PONG_TIMEOUT) {
            // Zombie socket — close it; onclose takes over.
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        }, KEEPALIVE_INTERVAL);
      };

      ws.onmessage = (event) => {
        // Stale-socket guard: a force-reconnect path may null `onclose` but
        // leave `onmessage` live. Without this guard, late messages from the
        // old socket can interleave with replay/output from the new one.
        if (wsRef.current !== ws) return;
        if (!mountedRef.current || !terminal) return;
        lastPongRef.current = Date.now();

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
            attemptRef.current = 0;
            setConnected(true);
            setReconnecting(false);
            setInputBlockedAt(null);
            useConnectionStore.getState().reportAttached();
            onConnected?.();
            // Send current dimensions so the PTY adjusts to this client's viewport
            if (terminal.cols && terminal.rows) {
              lastSentDimsRef.current = { cols: terminal.cols, rows: terminal.rows };
              ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
            }
            // Measure RTT right away instead of waiting for the first keepalive.
            ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
            // Start grace period — suppress notification sounds for initial output burst
            const prev = attachGrace.get(sessionId);
            if (prev) clearTimeout(prev);
            attachGrace.set(
              sessionId,
              setTimeout(() => attachGrace.delete(sessionId), ATTACH_GRACE_MS),
            );
            break;
          }
          case 'pong': {
            if (typeof msg.t === 'number') {
              useConnectionStore.getState().reportRtt(Date.now() - msg.t);
            }
            break;
          }
          case 'replay': {
            // Authoritative state snapshot from the server. The xterm.js instance
            // is preserved across React re-renders / socket reconnects, so
            // appending the replay would duplicate visible content for plain
            // shells. Drop any pending writes and reset the terminal first.
            // The payload ends with the app's input modes (mouse tracking,
            // bracketed paste…) so TUIs keep scrolling correctly after reset.
            writeBuffer = '';
            rafPending = false;
            terminal.reset();
            if (msg.data) {
              terminal.write(stripOscSequences(msg.data));
            }
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
              if (!wasAlreadyUnread && isNotificationsEnabled()) {
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
            if (msg.code === 'unauthorized') {
              // Session expired or signed out — the server closes with 4401.
              unauthorized = true;
              useConnectionStore.getState().reportAuthExpired();
              break;
            }
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
          case 'tunnel-status': {
            useConnectionStore.getState().setTunnelStatus({
              state: msg.state,
              url: msg.url,
              urlChanged: msg.urlChanged,
              attempt: msg.attempt,
              since: msg.since,
            });
            window.dispatchEvent(new MessageEvent('termbeam:ws-message', { data: event.data }));
            break;
          }
          case 'update-progress': {
            const status = msg.status;
            if (status === 'restarting' || status === 'installing' || status === 'verifying') {
              useConnectionStore.getState().setUpdating(msg.phase || 'Installing the update');
            } else if (status === 'failed' || status === 'idle') {
              useConnectionStore.getState().setUpdating(null);
            }
            // Forward update progress events to the UpdateBanner via a custom DOM event
            window.dispatchEvent(new MessageEvent('termbeam:ws-message', { data: event.data }));
            break;
          }
        }
      };

      ws.onclose = (event) => {
        // Guard against stale sockets — if a newer connection has already
        // replaced this one, ignore the close event from the old socket.
        if (wsRef.current !== ws) return;
        wsRef.current = null;

        if (keepaliveTimerRef.current) {
          clearInterval(keepaliveTimerRef.current);
          keepaliveTimerRef.current = null;
        }

        if (!mountedRef.current) return;
        markDisconnectedSoon();

        if (unauthorized || event.code === WS_CLOSE_UNAUTHORIZED) {
          // Wait for the unlock sheet — retrying would just be rejected again.
          useConnectionStore.getState().reportAuthExpired();
          pausedRef.current = true;
          return;
        }

        useConnectionStore.getState().reportSocketLost();
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror, handling reconnect
      };
    }

    connectFnRef.current = connect;
    connect();

    // The connection store bumps resumeNonce when retrying makes sense again
    // (network back, host reachable, unlocked) — reconnect immediately.
    const unsubscribe = useConnectionStore.subscribe((state, prev) => {
      if (state.resumeNonce === prev.resumeNonce || !mountedRef.current) return;
      const ws = wsRef.current;
      if (ws && ws.readyState <= WebSocket.OPEN) return;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      attemptRef.current = 0;
      connect();
    });

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
      attemptRef.current = 0;

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
          ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
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
      unsubscribe();
      unregister();
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
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
      wsRef.current = null;
    }
    attemptRef.current = 0;
    setConnected(false);
    setReconnecting(false);
    connectFnRef.current?.();
  }, []);

  return {
    send,
    connected,
    reconnecting,
    inputBlockedAt,
    sendResize,
    reconnect,
    ws: wsRef.current,
  };
}
