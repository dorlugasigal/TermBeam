import { create } from 'zustand';

export interface ToolCallInfo {
  id: string;
  type: 'file-edit' | 'bash' | 'search' | 'read-file' | 'other';
  label: string;
  content: string;
  collapsed: boolean;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
}

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'done' | 'error' | 'disconnected';

interface AgentState {
  messages: AgentMessage[];
  status: AgentStatus;
  activeSessionId: string | null;
  isRawTerminal: boolean;
  thinkingStartTime: number | null;
  agentName: string | null;
  agentReady: boolean;

  addMessage: (msg: Omit<AgentMessage, 'id' | 'timestamp'>) => void;
  updateLastAssistantMessage: (content: string) => void;
  appendToLastAssistantMessage: (chunk: string) => void;
  finalizeStreaming: () => void;
  setStatus: (status: AgentStatus) => void;
  setActiveSessionId: (id: string | null) => void;
  toggleRawTerminal: () => void;
  setAgentName: (name: string | null) => void;
  setAgentReady: (ready: boolean) => void;
  clearMessages: () => void;
  toggleToolCallCollapse: (messageId: string, toolCallId: string) => void;
  reset: () => void;
}

const initialState = {
  messages: [] as AgentMessage[],
  status: 'idle' as AgentStatus,
  activeSessionId: null as string | null,
  isRawTerminal: true,
  thinkingStartTime: null as number | null,
  agentName: null as string | null,
  agentReady: false,
};

export const useAgentStore = create<AgentState>((set) => ({
  ...initialState,

  addMessage: (msg) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...msg,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          isStreaming: msg.isStreaming ?? false,
        },
      ],
    })),

  updateLastAssistantMessage: (content) =>
    set((state) => {
      const idx = findLastAssistantIndex(state.messages);
      if (idx === -1) return state;
      const messages = [...state.messages];
      messages[idx] = { ...messages[idx]!, content };
      return { messages };
    }),

  appendToLastAssistantMessage: (chunk) =>
    set((state) => {
      const idx = findLastAssistantIndex(state.messages);
      if (idx === -1) return state;
      const messages = [...state.messages];
      messages[idx] = { ...messages[idx]!, content: messages[idx]!.content + chunk };
      return { messages };
    }),

  finalizeStreaming: () =>
    set((state) => {
      const idx = findLastAssistantIndex(state.messages);
      if (idx === -1 || !state.messages[idx]!.isStreaming) return state;
      const messages = [...state.messages];
      messages[idx] = { ...messages[idx]!, isStreaming: false };
      return { messages };
    }),

  setStatus: (status) =>
    set((state) => ({
      status,
      thinkingStartTime:
        status === 'thinking' || status === 'working'
          ? (state.thinkingStartTime ?? Date.now())
          : null,
    })),

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  toggleRawTerminal: () => set((state) => ({ isRawTerminal: !state.isRawTerminal })),

  setAgentName: (name) => set({ agentName: name }),
  setAgentReady: (ready) => set({ agentReady: ready }),

  clearMessages: () => set({ messages: [] }),

  toggleToolCallCollapse: (messageId, toolCallId) =>
    set((state) => {
      const messages = state.messages.map((msg) => {
        if (msg.id !== messageId || !msg.toolCalls) return msg;
        return {
          ...msg,
          toolCalls: msg.toolCalls.map((tc) =>
            tc.id === toolCallId ? { ...tc, collapsed: !tc.collapsed } : tc,
          ),
        };
      });
      return { messages };
    }),

  reset: () => set({ ...initialState }),
}));

function findLastAssistantIndex(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') return i;
  }
  return -1;
}
