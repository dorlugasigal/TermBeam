import { create } from 'zustand';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';

export type SplitMode = 'off' | 'vertical' | 'horizontal';

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
  hasUnread: boolean;
  scrollback: string;
  git?: {
    branch: string;
    provider?: string;
    repoName?: string;
    status?: {
      clean: boolean;
      modified: number;
      staged: number;
      untracked: number;
      ahead: number;
      behind: number;
      summary: string;
    };
  };
}

interface SessionState {
  sessions: Map<string, ManagedSession>;
  activeId: string | null;
  tabOrder: string[];
  splitMode: SplitMode;
  deletedIds: Set<string>;

  addSession: (session: ManagedSession) => void;
  removeSession: (id: string) => void;
  setActiveId: (id: string) => void;
  updateSession: (id: string, updates: Partial<ManagedSession>) => void;
  setTabOrder: (order: string[]) => void;
  toggleSplit: () => void;
  setSplit: (mode: SplitMode) => void;
  markUnread: (id: string) => void;
  clearUnread: (id: string) => void;
  isDeleted: (id: string) => boolean;
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
  try {
    localStorage.setItem('termbeam-tab-order', JSON.stringify(order));
  } catch {
    // Storage unavailable
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  activeId: null,
  tabOrder: loadTabOrder(),
  splitMode: 'off' as SplitMode,
  deletedIds: new Set(),

  addSession: (session) =>
    set((state) => {
      if (state.sessions.has(session.id) || state.deletedIds.has(session.id)) return state;
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

      const deletedIds = new Set(state.deletedIds);
      deletedIds.add(id);
      // Auto-clear after 30s so stale IDs don't accumulate
      setTimeout(() => {
        const s = get();
        const next = new Set(s.deletedIds);
        next.delete(id);
        set({ deletedIds: next });
      }, 30_000);

      let activeId = state.activeId;
      if (activeId === id) {
        activeId = tabOrder[0] ?? null;
      }
      return { sessions, tabOrder, activeId, deletedIds };
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

  toggleSplit: () =>
    set((state) => {
      const cycle: SplitMode[] = ['off', 'vertical', 'horizontal'];
      const next = cycle[(cycle.indexOf(state.splitMode) + 1) % cycle.length];
      return { splitMode: next };
    }),
  setSplit: (mode) => set({ splitMode: mode }),

  markUnread: (id) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const existing = sessions.get(id);
      if (existing && !existing.hasUnread) {
        sessions.set(id, { ...existing, hasUnread: true });
        return { sessions };
      }
      return state;
    }),

  clearUnread: (id) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const existing = sessions.get(id);
      if (existing && existing.hasUnread) {
        sessions.set(id, { ...existing, hasUnread: false });
        return { sessions };
      }
      return state;
    }),

  isDeleted: (id) => get().deletedIds.has(id),
}));
