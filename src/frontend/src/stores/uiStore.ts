import { create } from 'zustand';
import { usePreferencesStore } from './preferencesStore';

const MIN_FONT_SIZE = 2;
const MAX_FONT_SIZE = 32;

interface UIState {
  toolsPanelOpen: boolean;
  searchBarOpen: boolean;
  sidePanelOpen: boolean;
  newSessionModalOpen: boolean;
  newSessionModalInitialMode: 'terminal' | 'copilot' | null;
  settingsPanelOpen: boolean;
  uploadModalOpen: boolean;
  previewModalOpen: boolean;
  downloadModalOpen: boolean;
  markdownModalOpen: boolean;
  selectModeActive: boolean;
  copyOverlayOpen: boolean;
  fontSize: number;
  touchCtrlActive: boolean;
  touchShiftActive: boolean;
  /** Mirrors the live TouchBar collapsed state so other components
   *  (e.g. TerminalPane) can react with a fit() when the bar height
   *  changes. Set by TouchBar.tsx whenever the user toggles. */
  touchBarCollapsedLive: boolean;
  resumeBrowserOpen: boolean;
  codeViewerOpen: boolean;
  codeViewerSessionId: string | null;
  codeViewerInitialView: 'files' | 'changes';
  showingAgentTerminal: boolean;
  themePickerOpen: boolean;
  customKeysModalOpen: boolean;

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
  openNewSessionModal: (initialMode?: 'terminal' | 'copilot') => void;
  closeNewSessionModal: () => void;
  openSettingsPanel: () => void;
  closeSettingsPanel: () => void;
  toggleSettingsPanel: () => void;
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
  setTouchBarCollapsedLive: (collapsed: boolean) => void;
  openCodeViewer: (sessionId: string, initialView?: 'files' | 'changes') => void;
  closeCodeViewer: () => void;
  openThemePicker: () => void;
  closeThemePicker: () => void;
  toggleThemePicker: () => void;
  openCustomKeysModal: () => void;
  closeCustomKeysModal: () => void;

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
  newSessionModalInitialMode: null,
  settingsPanelOpen: false,
  uploadModalOpen: false,
  previewModalOpen: false,
  downloadModalOpen: false,
  markdownModalOpen: false,
  selectModeActive: false,
  copyOverlayOpen: false,
  fontSize: usePreferencesStore.getState().prefs.fontSize,
  touchCtrlActive: false,
  touchShiftActive: false,
  touchBarCollapsedLive: false,
  resumeBrowserOpen: false,
  codeViewerOpen: false,
  codeViewerSessionId: null,
  codeViewerInitialView: 'files',
  showingAgentTerminal: false,
  themePickerOpen: false,
  customKeysModalOpen: false,

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
  openNewSessionModal: (initialMode) =>
    set({ newSessionModalOpen: true, newSessionModalInitialMode: initialMode ?? null }),
  closeNewSessionModal: () =>
    set({ newSessionModalOpen: false, newSessionModalInitialMode: null }),
  openSettingsPanel: () => set({ settingsPanelOpen: true }),
  closeSettingsPanel: () => set({ settingsPanelOpen: false }),
  toggleSettingsPanel: () => set((s) => ({ settingsPanelOpen: !s.settingsPanelOpen })),
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
  setTouchBarCollapsedLive: (collapsed) => set({ touchBarCollapsedLive: collapsed }),
  openCodeViewer: (sessionId, initialView = 'files') =>
    set({
      codeViewerOpen: true,
      codeViewerSessionId: sessionId,
      codeViewerInitialView: initialView,
    }),
  closeCodeViewer: () =>
    set({ codeViewerOpen: false, codeViewerSessionId: null, codeViewerInitialView: 'files' }),
  openThemePicker: () => set({ themePickerOpen: true }),
  closeThemePicker: () => set({ themePickerOpen: false }),
  toggleThemePicker: () => set((s) => ({ themePickerOpen: !s.themePickerOpen })),
  openCustomKeysModal: () => set({ customKeysModalOpen: true }),
  closeCustomKeysModal: () => set({ customKeysModalOpen: false }),

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
