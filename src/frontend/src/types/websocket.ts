export interface WSAttachMessage {
  type: 'attach';
  sessionId: string;
  cols?: number;
  rows?: number;
}

export interface WSInputMessage {
  type: 'input';
  data: string;
}

export interface WSResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

export interface WSPingMessage {
  type: 'ping';
  t?: number;
}

export type WSClientMessage = WSAttachMessage | WSInputMessage | WSResizeMessage | WSPingMessage;

export interface WSOutputMessage {
  type: 'output';
  data: string;
}

// Server-authored snapshot of the session's display state (sanitized scrollback
// plus any alt-screen re-entry). Sent on attach. Clients should treat this as
// authoritative: drop any pending writes, reset their terminal, then write the
// payload. Prevents duplicate content on reconnect when xterm.js is preserved.
export interface WSReplayMessage {
  type: 'replay';
  data: string;
}

export interface WSAttachedMessage {
  type: 'attached';
  sessionId: string;
}

export interface WSExitMessage {
  type: 'exit';
  sessionId: string;
  code?: number;
}

export interface WSErrorMessage {
  type: 'error';
  message: string;
  /** 'unauthorized' when the session expired or was signed out (socket closes with 4401). */
  code?: 'unauthorized';
}

export interface WSPongMessage {
  type: 'pong';
  t: number | null;
}

export interface WSUpdateProgressMessage {
  type: 'update-progress';
  status: string;
  phase?: string;
  progress?: string;
  error?: string;
  fromVersion?: string;
  toVersion?: string;
  restartStrategy?: string;
}

export interface WSNotificationMessage {
  type: 'notification';
  notificationType: 'command-complete';
  sessionName: string;
  timestamp: number;
}

export interface WSTunnelStatusMessage {
  type: 'tunnel-status';
  state:
    'connected' | 'disconnected' | 'reconnecting' | 'waiting-network' | 'auth-expired' | 'failed';
  url?: string;
  urlChanged?: boolean;
  attempt?: number;
  since?: number;
}

export type WSServerMessage =
  | WSOutputMessage
  | WSReplayMessage
  | WSAttachedMessage
  | WSExitMessage
  | WSErrorMessage
  | WSPongMessage
  | WSUpdateProgressMessage
  | WSNotificationMessage
  | WSTunnelStatusMessage;
