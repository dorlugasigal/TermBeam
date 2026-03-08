import { useEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+F → open search bar
      if (e.ctrlKey && !e.shiftKey && e.key === 'f') {
        e.preventDefault();
        useUIStore.getState().openSearchBar();
        return;
      }

      // Ctrl+Shift+P → toggle command palette
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        useUIStore.getState().toggleCommandPalette();
        return;
      }

      // Escape → close whatever is open
      if (e.key === 'Escape') {
        const state = useUIStore.getState();
        if (state.commandPaletteOpen) {
          state.closeCommandPalette();
          e.preventDefault();
          return;
        }
        if (state.searchBarOpen) {
          state.closeSearchBar();
          e.preventDefault();
          return;
        }
        if (state.selectModeActive) {
          state.setSelectMode(false);
          e.preventDefault();
          return;
        }
        if (state.newSessionModalOpen) {
          state.closeNewSessionModal();
          e.preventDefault();
          return;
        }
        if (state.uploadModalOpen) {
          state.closeUploadModal();
          e.preventDefault();
          return;
        }
        if (state.previewModalOpen) {
          state.closePreviewModal();
          e.preventDefault();
          return;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
