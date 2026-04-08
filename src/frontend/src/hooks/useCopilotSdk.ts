import { useState, useRef, useEffect, useCallback } from 'react';
import { getWebSocketUrl } from '@/services/api';

// ── Types ──

export interface CopilotToolCall {
  id: string;
  toolName: string;
  input?: Record<string, unknown>;
  result?: { content?: string; detailedContent?: string };
  duration?: number;
  status: 'running' | 'complete' | 'error';
  /** Nested tool calls for sub-agents */
  children?: CopilotToolCall[];
}

export interface CopilotChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  reasoning?: string;
  toolCalls?: CopilotToolCall[];
  /** Pending user-input request attached to this assistant turn */
  inputRequest?: {
    question: string;
    choices?: string[];
    allowFreeform: boolean;
  };
}

export type CopilotSdkStatus = 'idle' | 'thinking' | 'streaming';

export interface UseCopilotSdkOptions {
  /** TermBeam session ID — when provided, the backend either creates or resumes the SDK session for this ID. */
  sessionId?: string;
  autoCreate?: boolean;
  model?: string;
}

export interface UseCopilotSdkReturn {
  connected: boolean;
  sessionReady: boolean;
  status: CopilotSdkStatus;
  messages: CopilotChatMessage[];
  currentModel: string;
  sendMessage: (prompt: string) => void;
  respondToInput: (answer: string) => void;
  setModel: (modelId: string) => void;
  cancelSession: () => void;
}

// ── Helpers ──

let msgCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

// ── Hook ──

export function useCopilotSdk(options: UseCopilotSdkOptions = {}): UseCopilotSdkReturn {
  const { sessionId, autoCreate = true, model } = options;

  const [connected, setConnected] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [status, setStatus] = useState<CopilotSdkStatus>('idle');
  const [messages, setMessages] = useState<CopilotChatMessage[]>([]);
  const [currentModel, setCurrentModel] = useState(model || 'claude-opus-4.6');

  // Sync model when the prop updates (e.g. after metadata fetch)
  useEffect(() => {
    if (model) setCurrentModel(model);
  }, [model]);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionReadyRef = useRef(false);
  const reasoningBufRef = useRef('');
  const activeSubagentsRef = useRef<Set<string>>(new Set());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const [connectKey, setConnectKey] = useState(0);

  // Send a JSON message over the WebSocket
  const wsSend = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // ── Message handlers ──

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      let msg: { type: string; data?: Record<string, unknown>; [key: string]: unknown };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        // Auth success — the server accepted us. Now create a Copilot session.
        // This case handles the legacy flow where copilot.create was sent after
        // a PTY attach. With copilot.attach, this path is not reached.
        case 'attached': {
          break;
        }

        case 'copilot.created': {
          sessionReadyRef.current = true;
          setSessionReady(true);
          retryCountRef.current = 0;
          const createdModel = (msg.data as { model?: string })?.model;
          if (createdModel) setCurrentModel(createdModel);
          // Request message history for replay on reconnect
          wsSend({ type: 'copilot.get_messages' });
          break;
        }

        case 'copilot.message_history': {
          const history = (msg.data as { messages?: Array<{ type: string; data?: Record<string, unknown> }> })?.messages || [];
          if (history.length === 0) break;
          // Clear existing messages before replay to avoid duplicates
          setMessages([]);
          reasoningBufRef.current = '';
          // Replay stored events through the existing handlers to rebuild message state
          for (const event of history) {
            if (event.type === 'copilot.message_history') continue; // Prevent infinite recursion
            const syntheticEvent = new MessageEvent('message', {
              data: JSON.stringify(event),
            });
            handleWsMessage(syntheticEvent);
          }
          break;
        }

        case 'copilot.model_changed': {
          const newModel = (msg.data as { model?: string })?.model;
          if (newModel) setCurrentModel(newModel);
          break;
        }

        case 'copilot.reasoning': {
          const content = (msg.data as { content?: string })?.content;
          if (content) {
            reasoningBufRef.current = content;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, reasoning: content }];
              }
              return prev;
            });
          }
          break;
        }

        case 'copilot.user_message': {
          const content = (msg.data as { content?: string })?.content ?? '';
          if (!content) break;
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'user',
              content,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'copilot.message_delta': {
          const delta = (msg.data as { deltaContent?: string })?.deltaContent ?? '';
          if (!delta) break;
          // Suppress deltas while sub-agents are active — their output is captured in tool results
          if (activeSubagentsRef.current.size > 0) break;
          setStatus('streaming');
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) {
              const updated = { ...last, content: last.content + delta };
              return [...prev.slice(0, -1), updated];
            }
            // Create a new streaming message
            return [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content: delta,
                timestamp: Date.now(),
                isStreaming: true,
                reasoning: reasoningBufRef.current || undefined,
                toolCalls: [],
              },
            ];
          });
          break;
        }

        case 'copilot.assistant_message': {
          const content = (msg.data as { content?: string })?.content ?? '';
          // Suppress full messages while sub-agents are active
          if (activeSubagentsRef.current.size > 0) break;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, content, isStreaming: false },
              ];
            }
            // No streaming message was in progress — add as finalized
            return [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content,
                timestamp: Date.now(),
                isStreaming: false,
                reasoning: reasoningBufRef.current || undefined,
                toolCalls: [],
              },
            ];
          });
          reasoningBufRef.current = '';
          break;
        }

        case 'copilot.reasoning_delta': {
          // Suppress reasoning while sub-agents are active
          if (activeSubagentsRef.current.size > 0) break;
          const delta = (msg.data as { deltaContent?: string })?.deltaContent ?? '';
          reasoningBufRef.current += delta;
          // Also update the current streaming message's reasoning field
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, reasoning: reasoningBufRef.current },
              ];
            }
            return prev;
          });
          break;
        }

        case 'copilot.tool_start': {
          const data = msg.data as {
            toolCallId?: string;
            toolName?: string;
            input?: Record<string, unknown>;
          };
          if (!data?.toolCallId) break;
          const tc: CopilotToolCall = {
            id: data.toolCallId,
            toolName: data.toolName ?? 'unknown',
            input: data.input,
            status: 'running',
          };

          // If a sub-agent is active, nest this tool call under the most recent one
          const activeSet = activeSubagentsRef.current;
          if (activeSet.size > 0) {
            // Pick the last-added subagent (most recent)
            const parentIds = [...activeSet];
            setMessages((prev) => {
              // Try each active subagent, preferring the most recent
              for (let i = parentIds.length - 1; i >= 0; i--) {
                const pid = parentIds[i]!;
                const idx = prev.findLastIndex(
                  (m) => m.role === 'assistant' && m.toolCalls?.some((t) => t.id === pid),
                );
                if (idx !== -1 && prev[idx]) {
                  const target = prev[idx]!;
                  const toolCalls = (target.toolCalls ?? []).map((t) =>
                    t.id === pid ? { ...t, children: [...(t.children ?? []), tc] } : t,
                  );
                  return [...prev.slice(0, idx), { ...target, toolCalls }, ...prev.slice(idx + 1)];
                }
              }
              return prev;
            });
            break;
          }

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              const toolCalls = [...(last.toolCalls ?? []), tc];
              return [...prev.slice(0, -1), { ...last, toolCalls }];
            }
            return [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                isStreaming: true,
                toolCalls: [tc],
              },
            ];
          });
          break;
        }

        case 'copilot.tool_complete': {
          const data = msg.data as {
            toolCallId?: string;
            toolName?: string;
            result?: { content?: string; detailedContent?: string };
            duration?: number;
          };
          if (!data?.toolCallId) break;
          setMessages((prev) => {
            // Helper: update a tool call by ID, including inside sub-agent children
            function updateToolCall(tcs: CopilotToolCall[]): CopilotToolCall[] {
              return tcs.map((tc) => {
                if (tc.id === data.toolCallId) {
                  return { ...tc, result: data.result, duration: data.duration, status: 'complete' as const };
                }
                if (tc.children?.some((c) => c.id === data.toolCallId)) {
                  return { ...tc, children: updateToolCall(tc.children) };
                }
                return tc;
              });
            }
            // Search all messages for the matching tool call (top-level or nested)
            const idx = prev.findLastIndex(
              (m) =>
                m.role === 'assistant' &&
                m.toolCalls?.some(
                  (tc) =>
                    tc.id === data.toolCallId ||
                    tc.children?.some((c) => c.id === data.toolCallId),
                ),
            );
            if (idx === -1 || !prev[idx]) return prev;
            const target = prev[idx]!;
            const toolCalls = updateToolCall(target.toolCalls ?? []);
            return [...prev.slice(0, idx), { ...target, toolCalls }, ...prev.slice(idx + 1)];
          });
          break;
        }

        case 'copilot.subagent_start': {
          const data = msg.data as {
            toolCallId?: string;
            agentName?: string;
            agentDisplayName?: string;
          };
          if (!data?.toolCallId) break;
          activeSubagentsRef.current.add(data.toolCallId);
          // Upgrade the existing tool call (same toolCallId from tool.execution_start)
          // to a sub-agent with agent metadata and a children array
          setMessages((prev) => {
            const idx = prev.findLastIndex(
              (m) => m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === data.toolCallId),
            );
            if (idx !== -1 && prev[idx]) {
              const target = prev[idx]!;
              const toolCalls = (target.toolCalls ?? []).map((tc) =>
                tc.id === data.toolCallId
                  ? {
                      ...tc,
                      toolName: `subagent:${data.agentDisplayName ?? data.agentName ?? tc.toolName}`,
                      children: tc.children ?? [],
                      status: 'running' as const,
                    }
                  : tc,
              );
              return [...prev.slice(0, idx), { ...target, toolCalls }, ...prev.slice(idx + 1)];
            }
            // No existing tool call — create one (shouldn't normally happen)
            const tc: CopilotToolCall = {
              id: data.toolCallId!,
              toolName: `subagent:${data.agentDisplayName ?? data.agentName ?? 'agent'}`,
              status: 'running',
              children: [],
            };
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, toolCalls: [...(last.toolCalls ?? []), tc] }];
            }
            return [
              ...prev,
              { id: nextId(), role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true, toolCalls: [tc] },
            ];
          });
          break;
        }

        case 'copilot.subagent_complete': {
          const data = msg.data as {
            toolCallId?: string;
            agentDisplayName?: string;
            model?: string;
            totalToolCalls?: string;
            totalTokens?: string;
            durationMs?: string;
          };
          if (!data?.toolCallId) break;
          activeSubagentsRef.current.delete(data.toolCallId);
          const summary = [
            data.model,
            data.totalToolCalls && `${data.totalToolCalls} tool calls`,
            data.totalTokens && `${data.totalTokens} tokens`,
            data.durationMs && `${(Number(data.durationMs) / 1000).toFixed(1)}s`,
          ]
            .filter(Boolean)
            .join(' · ');
          // Update the existing sub-agent tool call with stats (don't overwrite result —
          // tool.execution_complete will set the final result)
          setMessages((prev) => {
            const idx = prev.findLastIndex(
              (m) => m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === data.toolCallId),
            );
            if (idx === -1 || !prev[idx]) return prev;
            const target = prev[idx]!;
            const toolCalls = (target.toolCalls ?? []).map((tc) =>
              tc.id === data.toolCallId
                ? {
                    ...tc,
                    result: { content: summary },
                    duration: data.durationMs ? Number(data.durationMs) : undefined,
                    status: 'complete' as const,
                  }
                : tc,
            );
            return [...prev.slice(0, idx), { ...target, toolCalls }, ...prev.slice(idx + 1)];
          });
          break;
        }

        case 'copilot.idle': {
          // Finalize any streaming message
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.isStreaming) {
              return [...prev.slice(0, -1), { ...last, isStreaming: false }];
            }
            return prev;
          });
          setStatus('idle');
          reasoningBufRef.current = '';
          break;
        }

        case 'copilot.error': {
          const errorMsg = (msg.data as { message?: string })?.message ?? 'Unknown error';
          // If session not found and not yet ready, fallback to creating a new session
          if (errorMsg.includes('Session not found') && !sessionReadyRef.current) {
            const createMsg: Record<string, unknown> = { type: 'copilot.create' };
            if (model) createMsg.model = model;
            wsSend(createMsg);
            break;
          }
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'system',
              content: `⚠️ ${errorMsg}`,
              timestamp: Date.now(),
            },
          ]);
          setStatus('idle');
          break;
        }

        case 'copilot.user_input_request': {
          const data = msg.data as {
            question?: string;
            choices?: string[];
            allowFreeform?: boolean;
          };
          // Attach the input request to the last assistant message, or create one
          setMessages((prev) => {
            const request = {
              question: data?.question ?? '',
              choices: data?.choices,
              allowFreeform: data?.allowFreeform ?? true,
            };
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, isStreaming: false, inputRequest: request }];
            }
            return [
              ...prev,
              {
                id: nextId(),
                role: 'assistant',
                content: data?.question ?? '',
                timestamp: Date.now(),
                inputRequest: request,
              },
            ];
          });
          setStatus('idle');
          break;
        }

        case 'copilot.auth_url': {
          const url = (msg.data as { url?: string })?.url;
          if (!url) break;
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'system',
              content: `🔐 Authentication required — [tap here to sign in](${url})`,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        default:
          break;
      }
    },
    [autoCreate, sessionId, model, wsSend],
  );

  // ── WebSocket lifecycle ──

  useEffect(() => {
    const url = getWebSocketUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // If we have a sessionId (created via POST /api/sessions), attach to existing SDK session.
      // Otherwise, create a new one via WebSocket.
      if (sessionId) {
        ws.send(JSON.stringify({ type: 'copilot.attach', sessionId }));
      } else if (autoCreate) {
        const createMsg: Record<string, unknown> = { type: 'copilot.create' };
        if (model) createMsg.model = model;
        ws.send(JSON.stringify(createMsg));
      }
    };

    ws.onmessage = handleWsMessage;

    ws.onclose = () => {
      setConnected(false);
      setSessionReady(false);
      sessionReadyRef.current = false;
      // Retry connection after 2s if session wasn't established
      if (retryCountRef.current < 3) {
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(() => setConnectKey((k) => k + 1), 2000);
      }
    };

    ws.onerror = () => {
      setConnected(false);
    };

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      ws.close();
      wsRef.current = null;
    };
  }, [handleWsMessage, connectKey]);

  // ── Public actions ──

  const sendMessage = useCallback(
    (prompt: string) => {
      if (!prompt.trim()) return;
      // Add user message to chat
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        },
      ]);
      setStatus('thinking');
      reasoningBufRef.current = '';
      wsSend({ type: 'copilot.send', prompt });
    },
    [wsSend],
  );

  const respondToInput = useCallback(
    (answer: string) => {
      // Clear the input request from the last message
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.inputRequest) {
          return [...prev.slice(0, -1), { ...last, inputRequest: undefined }];
        }
        return prev;
      });
      // Add the user's response as a user message
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'user',
          content: answer,
          timestamp: Date.now(),
        },
      ]);
      setStatus('thinking');
      wsSend({
        type: 'copilot.input_response',
        answer: { text: answer, wasFreeform: true },
      });
    },
    [wsSend],
  );

  const setModel = useCallback(
    (modelId: string) => {
      wsSend({ type: 'copilot.set_model', model: modelId });
      setCurrentModel(modelId);
    },
    [wsSend],
  );

  const cancelSession = useCallback(() => {
    wsSend({ type: 'copilot.cancel' });
    setStatus('idle');
    // Finalize any streaming message
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.isStreaming) {
        return [...prev.slice(0, -1), { ...last, isStreaming: false }];
      }
      return prev;
    });
  }, [wsSend]);

  return {
    connected,
    sessionReady,
    status,
    messages,
    currentModel,
    sendMessage,
    respondToInput,
    setModel,
    cancelSession,
  };
}
