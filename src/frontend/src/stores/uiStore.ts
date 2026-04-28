import { create } from 'zustand';
import { usePreferencesStore } from './preferencesStore';

const MIN_FONT_SIZE = 2;
const MAX_FONT_SIZE = 32;

interface UIState {
  toolsPanelOpen: boolean;
  searchBarOpen: boolean;
  sidePanelOpen: boolean;
  newSessionModalOpen: boolean;
  uploadModalOpen: boolean;
  previewModalOpen: boolean;
  downloadModalOpen: boolean;
  markdownModalOpen: boolean;
  selectModeActive: boolean;
  copyOverlayOpen: boolean;
  fontSize: number;
  touchCtrlActive: boolean;
  touchShiftActive: boolean;
  resumeBrowserOpen: boolean;
  codeViewerOpen: boolean;
  codeViewerSessionId: string | null;
  codeViewerInitialView: 'files' | 'changes';
  showingAgentTerminal: boolean;

  setShowingAgentTerminal: (v: boolean) => void;
  openResumeBrowser: () => void;
  closeResumeBrowser: () => void;
  openToolsPanel: () => void;
  closeToolsPanel: () => void;
  toggleToolsPanel: () => void;
  openSearchBar: () => void;
  closeSearchBar: () => void;
  openSidePanel: () => void;
  closeSidePanel: () => void;
  openNewSessionModal: () => void;
  closeNewSessionModal: () => void;
  openUploadModal: () => void;
  closeUploadModal: () => void;
  openPreviewModal: () => void;
  closePreviewModal: () => void;
  openDownloadModal: () => void;
  closeDownloadModal: () => void;
  openMarkdownModal: () => void;
  closeMarkdownModal: () => void;
  setSelectMode: (active: boolean) => void;
  openCopyOverlay: () => void;
  closeCopyOverlay: () => void;
  setFontSize: (size: number) => void;
  setTouchCtrl: (active: boolean) => void;
  setTouchShift: (active: boolean) => void;
  openCodeViewer: (sessionId: string, initialView?: 'files' | 'changes') => void;
  closeCodeViewer: () => void;

  /** Handler for TouchBar to interact with the active chat input (Copilot sessions) */
  chatInputHandler: ((text: string) => void) | null;
  chatSendHandler: (() => void) | null;
  chatCancelHandler: (() => void) | null;
  chatNewlineHandler: (() => void) | null;
  setChatInputHandler: (handler: ((text: string) => void) | null) => void;
  setChatSendHandler: (handler: (() => void) | null) => void;
  setChatCancelHandler: (handler: (() => void) | null) => void;
  setChatNewlineHandler: (handler: (() => void) | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  toolsPanelOpen: false,
  searchBarOpen: false,
  sidePanelOpen: false,
  newSessionModalOpen: false,
  uploadModalOpen: false,
  previewModalOpen: false,
  downloadModalOpen: false,
  markdownModalOpen: false,
  selectModeActive: false,
  copyOverlayOpen: false,
  fontSize: usePreferencesStore.getState().prefs.fontSize,
  touchCtrlActive: false,
  touchShiftActive: false,
  resumeBrowserOpen: false,
  codeViewerOpen: false,
  codeViewerSessionId: null,
  codeViewerInitialView: 'files',
  showingAgentTerminal: false,

  setShowingAgentTerminal: (v) => set({ showingAgentTerminal: v }),
  openResumeBrowser: () => set({ resumeBrowserOpen: true }),
  closeResumeBrowser: () => set({ resumeBrowserOpen: false }),
  openToolsPanel: () => set({ toolsPanelOpen: true }),
  closeToolsPanel: () => set({ toolsPanelOpen: false }),
  toggleToolsPanel: () => set((s) => ({ toolsPanelOpen: !s.toolsPanelOpen })),
  openSearchBar: () => set({ searchBarOpen: true }),
  closeSearchBar: () => set({ searchBarOpen: false }),
  openSidePanel: () => set({ sidePanelOpen: true }),
  closeSidePanel: () => set({ sidePanelOpen: false }),
  openNewSessionModal: () => set({ newSessionModalOpen: true }),
  closeNewSessionModal: () => set({ newSessionModalOpen: false }),
  openUploadModal: () => set({ uploadModalOpen: true }),
  closeUploadModal: () => set({ uploadModalOpen: false }),
  openPreviewModal: () => set({ previewModalOpen: true }),
  closePreviewModal: () => set({ previewModalOpen: false }),
  openDownloadModal: () => set({ downloadModalOpen: true }),
  closeDownloadModal: () => set({ downloadModalOpen: false }),
  openMarkdownModal: () => set({ markdownModalOpen: true }),
  closeMarkdownModal: () => set({ markdownModalOpen: false }),
  setSelectMode: (active) => set({ selectModeActive: active }),
  openCopyOverlay: () => set({ copyOverlayOpen: true }),
  closeCopyOverlay: () => set({ copyOverlayOpen: false }),
  setFontSize: (size) => {
    const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(size)));
    usePreferencesStore.getState().setPreference('fontSize', clamped);
    set({ fontSize: clamped });
  },
  setTouchCtrl: (active) => set({ touchCtrlActive: active }),
  setTouchShift: (active) => set({ touchShiftActive: active }),
  openCodeViewer: (sessionId, initialView = 'files') =>
    set({
      codeViewerOpen: true,
      codeViewerSessionId: sessionId,
      codeViewerInitialView: initialView,
    }),
  closeCodeViewer: () =>
    set({ codeViewerOpen: false, codeViewerSessionId: null, codeViewerInitialView: 'files' }),

  chatInputHandler: null,
  chatSendHandler: null,
  chatCancelHandler: null,
  chatNewlineHandler: null,
  setChatInputHandler: (handler) => set({ chatInputHandler: handler }),
  setChatSendHandler: (handler) => set({ chatSendHandler: handler }),
  setChatCancelHandler: (handler) => set({ chatCancelHandler: handler }),
  setChatNewlineHandler: (handler) => set({ chatNewlineHandler: handler }),
}));

// Mirror server-driven fontSize changes back into the UI store so subscribers
// re-render when prefs are pushed from another device.
usePreferencesStore.subscribe((state, prev) => {
  if (state.prefs.fontSize !== prev.prefs.fontSize) {
    useUIStore.setState({ fontSize: state.prefs.fontSize });
  }
});
