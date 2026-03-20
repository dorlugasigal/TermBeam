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

export type WSClientMessage = WSAttachMessage | WSInputMessage | WSResizeMessage;

export interface WSOutputMessage {
  type: 'output';
  data: string;
}

export interface WSAttachedMessage {
  type: 'attached';
  sessionId: string;
  scrollback?: string;
}

export interface WSExitMessage {
  type: 'exit';
  sessionId: string;
  code?: number;
}

export interface WSErrorMessage {
  type: 'error';
  message: string;
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

export type WSServerMessage =
  | WSOutputMessage
  | WSAttachedMessage
  | WSExitMessage
  | WSErrorMessage
  | WSUpdateProgressMessage;
