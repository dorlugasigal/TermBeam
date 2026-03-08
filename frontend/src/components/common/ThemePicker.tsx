import { useState, useRef, useEffect, useCallback } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';
import styles from './ThemePicker.module.css';

export default function ThemePicker() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { themeId, setTheme } = useThemeStore();

  const currentTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]!;

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, handleClickOutside]);

  return (
    <>
      <button className={styles.trigger} onClick={() => setOpen((v) => !v)} aria-label="Pick theme">
        <span className={styles.swatch} style={{ background: currentTheme.bg }} />
        {currentTheme.name}
      </button>

      {open && (
        <div className={styles.panel} ref={panelRef}>
          <div className={styles.header}>
            <span className={styles.title}>Theme</span>
            <button
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Close theme picker"
            >
              ✕
            </button>
          </div>
          <div className={styles.list}>
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                className={`${styles.option} ${theme.id === themeId ? styles.active : ''}`}
                onClick={() => setTheme(theme.id as ThemeId)}
              >
                <span className={styles.swatch} style={{ background: theme.bg }} />
                {theme.name}
                {theme.id === themeId && <span className={styles.checkmark}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
