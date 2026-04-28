import { create } from 'zustand';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';
import { usePreferencesStore, PREF_DEFAULTS } from './preferencesStore';

interface ThemeState {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  // Seed from prefs store cache (already hydrated from localStorage on import).
  const initial = usePreferencesStore.getState().prefs.themeId;

  // Keep this store in sync when prefs change (server fetch, settings panel, etc.)
  usePreferencesStore.subscribe((state, prev) => {
    if (state.prefs.themeId !== prev.prefs.themeId) {
      set({ themeId: state.prefs.themeId });
    }
  });

  return {
    themeId: initial,
    setTheme: (id) => {
      if (!THEMES.some((t) => t.id === id)) id = PREF_DEFAULTS.themeId;
      usePreferencesStore.getState().setPreference('themeId', id);
      set({ themeId: id });
    },
  };
});

// Apply current theme to the document on module load. The preferences store
// already calls setAttribute('data-theme', ...) inside its side effects, but
// we keep this to ensure the attribute exists even if prefs hydrate fails.
try {
  document.documentElement.setAttribute(
    'data-theme',
    usePreferencesStore.getState().prefs.themeId,
  );
} catch {
  // SSR / no DOM
}

