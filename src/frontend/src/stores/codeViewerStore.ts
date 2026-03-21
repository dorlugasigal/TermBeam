import { create } from 'zustand';

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
  // State
  openFiles: Map<string, OpenFile>;
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  fileTree: FileTreeNode[] | null;
  sidebarOpen: boolean;

  // Actions
  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  toggleDir: (path: string) => void;
  setFileTree: (tree: FileTreeNode[]) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  updateScrollTop: (path: string, scrollTop: number) => void;
}

export const useCodeViewerStore = create<CodeViewerState>((set) => ({
  openFiles: new Map(),
  activeFilePath: null,
  expandedDirs: new Set(),
  fileTree: null,
  sidebarOpen: true,

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

  setFileTree: (tree) => set({ fileTree: tree }),

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
}));
