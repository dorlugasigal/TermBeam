import { create } from 'zustand';

interface UIState {
  commandPaletteOpen: boolean;
  searchBarOpen: boolean;
  sidePanelOpen: boolean;
  newSessionModalOpen: boolean;
  uploadModalOpen: boolean;
  previewModalOpen: boolean;
  selectModeActive: boolean;

  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
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
  setSelectMode: (active: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  searchBarOpen: false,
  sidePanelOpen: false,
  newSessionModalOpen: false,
  uploadModalOpen: false,
  previewModalOpen: false,
  selectModeActive: false,

  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
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
  setSelectMode: (active) => set({ selectModeActive: active }),
}));
