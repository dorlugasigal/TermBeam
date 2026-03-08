import { create } from 'zustand';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';

interface ThemeState {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
}

function getSavedTheme(): ThemeId {
  const saved = localStorage.getItem('termbeam-theme');
  if (saved && THEMES.some((t) => t.id === saved)) return saved as ThemeId;
  return 'dark';
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeId: getSavedTheme(),
  setTheme: (id) => {
    localStorage.setItem('termbeam-theme', id);
    document.documentElement.setAttribute('data-theme', id);
    const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]!;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.bg);
    set({ themeId: id });
  },
}));

// Apply theme on module load
const initialTheme = getSavedTheme();
document.documentElement.setAttribute('data-theme', initialTheme);
const meta = document.querySelector('meta[name="theme-color"]');
if (meta) {
  const theme = THEMES.find((t) => t.id === initialTheme) ?? THEMES[0]!;
  meta.setAttribute('content', theme.bg);
}
