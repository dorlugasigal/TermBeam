import { create } from 'zustand';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';

interface ThemeState {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
}

function getSavedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem('termbeam-theme');
    if (saved && THEMES.some((t) => t.id === saved)) return saved as ThemeId;
  } catch {
    // localStorage unavailable (private browsing, storage disabled)
  }
  return 'dark';
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeId: getSavedTheme(),
  setTheme: (id) => {
    try {
      localStorage.setItem('termbeam-theme', id);
    } catch {
      // Storage unavailable
    }
    document.documentElement.setAttribute('data-theme', id);
    set({ themeId: id });
    // Note: meta theme-color (iOS chrome) is updated by App.tsx via
    // useChromeColor, so it can pick the right color (--bg or --surface)
    // based on the active screen.
  },
}));

// Apply theme on module load (chrome color is set by App.tsx useChromeColor)
const initialTheme = getSavedTheme();
document.documentElement.setAttribute('data-theme', initialTheme);
