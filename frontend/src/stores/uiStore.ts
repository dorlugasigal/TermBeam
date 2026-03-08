import { create } from 'zustand';

const FONT_SIZE_KEY = 'termbeam-font-size';
const MIN_FONT_SIZE = 2;
const MAX_FONT_SIZE = 32;
const DEFAULT_FONT_SIZE = 14;

function loadFontSize(): number {
  try {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    if (saved) {
      const n = Number(saved);
      if (!Number.isNaN(n) && n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) return n;
    }
  } catch {
    // ignore
  }
  return DEFAULT_FONT_SIZE;
}

interface UIState {
  commandPaletteOpen: boolean;
  searchBarOpen: boolean;
  sidePanelOpen: boolean;
  newSessionModalOpen: boolean;
  uploadModalOpen: boolean;
  previewModalOpen: boolean;
  selectModeActive: boolean;
  copyOverlayOpen: boolean;
  fontSize: number;

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
  openCopyOverlay: () => void;
  closeCopyOverlay: () => void;
  setFontSize: (size: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  searchBarOpen: false,
  sidePanelOpen: false,
  newSessionModalOpen: false,
  uploadModalOpen: false,
  previewModalOpen: false,
  selectModeActive: false,
  copyOverlayOpen: false,
  fontSize: loadFontSize(),

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
  openCopyOverlay: () => set({ copyOverlayOpen: true }),
  closeCopyOverlay: () => set({ copyOverlayOpen: false }),
  setFontSize: (size) => {
    const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(size)));
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(clamped));
    } catch {
      // localStorage may be unavailable (private browsing, quota exceeded)
    }
    set({ fontSize: clamped });
  },
}));
