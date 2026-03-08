import { THEMES, type ThemeId } from '@/themes/terminalThemes';
import { useThemeStore } from '@/stores/themeStore';
import styles from './CommandPalette.module.css';

interface ThemePanelProps {
  onBack: () => void;
}

export default function ThemePanel({ onBack }: ThemePanelProps) {
  const currentTheme = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);

  const handleSelect = (id: ThemeId) => {
    setTheme(id);
  };

  return (
    <div data-testid="theme-subpanel" data-open="true">
      <div className={styles.header}>
        <button className={styles.closeBtn} onClick={onBack}>
          ←
        </button>
        <span className={styles.title}>Theme</span>
        <span />
      </div>
      <div className={styles.list}>
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            className={styles.item}
            data-selected={theme.id === currentTheme}
            data-testid="theme-item"
            data-tid={theme.id}
            onClick={() => handleSelect(theme.id)}
          >
            <span
              style={{
                display: 'inline-block',
                width: 16,
                height: 16,
                borderRadius: 4,
                background: theme.bg,
                border: '1px solid var(--border, #555)',
                flexShrink: 0,
              }}
            />
            <span>{theme.name}</span>
            {theme.id === currentTheme && (
              <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.6 }}>
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
