import { create } from 'zustand';
import type { GitStatus, GitDiff, GitBlame, GitLog } from '@/services/api';

export interface OpenFile {
  path: string;
  content: string;
  language: string;
  size: number;
  scrollTop: number;
}

export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  children?: FileTreeNode[];
}

interface CodeViewerState {
  // Tracks which session this state belongs to
  boundSessionId: string | null;

  // State
  openFiles: Map<string, OpenFile>;
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  fileTree: FileTreeNode[] | null;
  // Directory paths whose children have been loaded. Root is represented by ''.
  loadedDirs: Set<string>;
  // True once a full deep traversal has been merged (used for search).
  deepLoaded: boolean;
  sidebarOpen: boolean;

  // Git state
  viewMode: 'files' | 'changes';
  gitStatus: GitStatus | null;
  gitDiff: GitDiff | null;
  gitBlame: GitBlame | null;
  gitLog: GitLog | null;
  diffFile: string | null;
  blameEnabled: boolean;

  // Actions
  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  toggleDir: (path: string) => void;
  setFileTree: (tree: FileTreeNode[]) => void;
  mergeChildren: (path: string, children: FileTreeNode[]) => void;
  markDirLoaded: (path: string) => void;
  setDeepLoaded: (loaded: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  updateScrollTop: (path: string, scrollTop: number) => void;

  // Git actions
  setViewMode: (mode: 'files' | 'changes') => void;
  setGitStatus: (status: GitStatus | null) => void;
  setGitDiff: (diff: GitDiff | null) => void;
  setGitBlame: (blame: GitBlame | null) => void;
  setGitLog: (log: GitLog | null) => void;
  setDiffFile: (file: string | null) => void;
  toggleBlame: () => void;

  // Bind store to a session, resetting state if the session changed
  bindSession: (sessionId: string) => void;
}

export const useCodeViewerStore = create<CodeViewerState>((set, get) => ({
  boundSessionId: null,
  openFiles: new Map(),
  activeFilePath: null,
  expandedDirs: new Set(),
  fileTree: null,
  loadedDirs: new Set(),
  deepLoaded: false,
  sidebarOpen: true,

  // Git defaults
  viewMode: 'files',
  gitStatus: null,
  gitDiff: null,
  gitBlame: null,
  gitLog: null,
  diffFile: null,
  blameEnabled: false,

  openFile: (file) =>
    set((state) => {
      const openFiles = new Map(state.openFiles);
      openFiles.set(file.path, file);
      return { openFiles, activeFilePath: file.path };
    }),

  closeFile: (path) =>
    set((state) => {
      const openFiles = new Map(state.openFiles);
      openFiles.delete(path);

      let activeFilePath = state.activeFilePath;
      if (activeFilePath === path) {
        const keys = [...openFiles.keys()];
        activeFilePath = keys[keys.length - 1] ?? null;
      }
      return { openFiles, activeFilePath };
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  toggleDir: (path) =>
    set((state) => {
      const expandedDirs = new Set(state.expandedDirs);
      if (expandedDirs.has(path)) {
        expandedDirs.delete(path);
      } else {
        expandedDirs.add(path);
      }
      return { expandedDirs };
    }),

  setFileTree: (tree) => set({ fileTree: tree, loadedDirs: new Set(['']), deepLoaded: false }),

  mergeChildren: (dirPath, children) =>
    set((state) => {
      if (!state.fileTree) return state;

      // Recursively clone the path down to the target dir, replacing children in place.
      function replace(nodes: FileTreeNode[]): FileTreeNode[] {
        return nodes.map((n) => {
          if (n.path === dirPath) return { ...n, children };
          if (n.type === 'directory' && n.children && dirPath.startsWith(n.path + '/')) {
            return { ...n, children: replace(n.children) };
          }
          return n;
        });
      }

      const nextLoaded = new Set(state.loadedDirs);
      nextLoaded.add(dirPath);
      return { fileTree: replace(state.fileTree), loadedDirs: nextLoaded };
    }),

  markDirLoaded: (dirPath) =>
    set((state) => {
      const next = new Set(state.loadedDirs);
      next.add(dirPath);
      return { loadedDirs: next };
    }),

  setDeepLoaded: (loaded) => set({ deepLoaded: loaded }),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  updateScrollTop: (path, scrollTop) =>
    set((state) => {
      const openFiles = new Map(state.openFiles);
      const existing = openFiles.get(path);
      if (existing) {
        openFiles.set(path, { ...existing, scrollTop });
        return { openFiles };
      }
      return state;
    }),

  // Git actions
  setViewMode: (mode) => set({ viewMode: mode }),
  setGitStatus: (status) => set({ gitStatus: status }),
  setGitDiff: (diff) => set({ gitDiff: diff }),
  setGitBlame: (blame) => set({ gitBlame: blame }),
  setGitLog: (log) => set({ gitLog: log }),
  setDiffFile: (file) => set({ diffFile: file }),
  toggleBlame: () => set((state) => ({ blameEnabled: !state.blameEnabled })),

  bindSession: (sessionId) => {
    if (get().boundSessionId === sessionId) return;
    set({
      boundSessionId: sessionId,
      openFiles: new Map(),
      activeFilePath: null,
      expandedDirs: new Set(),
      fileTree: null,
      loadedDirs: new Set(),
      deepLoaded: false,
      gitStatus: null,
      gitDiff: null,
      gitBlame: null,
      gitLog: null,
      diffFile: null,
      blameEnabled: false,
    });
  },
}));
