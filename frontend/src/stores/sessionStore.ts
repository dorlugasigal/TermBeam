import { create } from 'zustand';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';

export interface ManagedSession {
  id: string;
  name: string;
  shell: string;
  pid: number;
  cwd: string;
  color: string;
  createdAt: string;
  lastActivity: string | number;
  term: Terminal | null;
  fitAddon: FitAddon | null;
  searchAddon: SearchAddon | null;
  ws: WebSocket | null;
  send: ((data: string) => void) | null;
  connected: boolean;
  exited: boolean;
  scrollback: string;
}

interface SessionState {
  sessions: Map<string, ManagedSession>;
  activeId: string | null;
  tabOrder: string[];
  splitMode: boolean;

  addSession: (session: ManagedSession) => void;
  removeSession: (id: string) => void;
  setActiveId: (id: string) => void;
  updateSession: (id: string, updates: Partial<ManagedSession>) => void;
  setTabOrder: (order: string[]) => void;
  toggleSplit: () => void;
  setSplit: (on: boolean) => void;
}

function loadTabOrder(): string[] {
  try {
    const saved = localStorage.getItem('termbeam-tab-order');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveTabOrder(order: string[]): void {
  localStorage.setItem('termbeam-tab-order', JSON.stringify(order));
}

export const useSessionStore = create<SessionState>((set, _get) => ({
  sessions: new Map(),
  activeId: null,
  tabOrder: loadTabOrder(),
  splitMode: false,

  addSession: (session) =>
    set((state) => {
      if (state.sessions.has(session.id)) return state;
      const sessions = new Map(state.sessions);
      sessions.set(session.id, session);
      const tabOrder = state.tabOrder.includes(session.id)
        ? state.tabOrder
        : [...state.tabOrder, session.id];
      saveTabOrder(tabOrder);
      return {
        sessions,
        tabOrder,
        activeId: state.activeId ?? session.id,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const ms = sessions.get(id);
      if (ms) {
        ms.ws?.close();
        ms.term?.dispose();
      }
      sessions.delete(id);
      const tabOrder = state.tabOrder.filter((tid) => tid !== id);
      saveTabOrder(tabOrder);

      let activeId = state.activeId;
      if (activeId === id) {
        activeId = tabOrder[0] ?? null;
      }
      return { sessions, tabOrder, activeId };
    }),

  setActiveId: (id) => set({ activeId: id }),

  updateSession: (id, updates) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const existing = sessions.get(id);
      if (existing) {
        sessions.set(id, { ...existing, ...updates });
      }
      return { sessions };
    }),

  setTabOrder: (order) => {
    saveTabOrder(order);
    set({ tabOrder: order });
  },

  toggleSplit: () => set((state) => ({ splitMode: !state.splitMode })),
  setSplit: (on) => set({ splitMode: on }),
}));
