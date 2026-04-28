import { useState, useRef, useEffect, useCallback } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';
import styles from './ThemePicker.module.css';

interface ThemePickerProps {
  open?: boolean;
  onClose?: () => void;
  hideTrigger?: boolean;
  onSelect?: (themeId: ThemeId) => void;
}

export default function ThemePicker({ open: controlledOpen, onClose, hideTrigger, onSelect }: ThemePickerProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const { themeId, setTheme } = useThemeStore();

  const isControlled = controlledOpen !== undefined && onClose !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const currentTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]!;

  const handleClose = useCallback(() => {
    if (isControlled) {
      onClose?.();
    } else {
      setInternalOpen(false);
    }
  }, [isControlled, onClose]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    const target = e.target as Node;
    const shouldCheckTrigger = !hideTrigger;
    if (
      panelRef.current &&
      !panelRef.current.contains(target) &&
      (!shouldCheckTrigger || (triggerRef.current && !triggerRef.current.contains(target)))
    ) {
      handleClose();
    }
  }, [hideTrigger, handleClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  }, [handleClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, handleClickOutside, handleKeyDown]);

  useEffect(() => {
    if (isOpen) {
      setDragOffset(null);
      closeBtnRef.current?.focus();
    }
  }, [isOpen]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panelRef.current) return;
    
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    
    const rect = panelRef.current.getBoundingClientRect();
    const currentX = dragOffset?.x ?? 0;
    const currentY = dragOffset?.y ?? 0;
    
    const startX = e.clientX - currentX;
    const startY = e.clientY - currentY;
    
    setIsDragging(true);
    
    const handleMove = (moveEvent: PointerEvent) => {
      const rawX = moveEvent.clientX - startX;
      const rawY = moveEvent.clientY - startY;
      
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const panelWidth = rect.width;
      const panelHeight = rect.height;
      
      const clampedX = Math.max(
        8 - panelWidth / 2,
        Math.min(vw - panelWidth / 2 - 8, rawX)
      );
      const clampedY = Math.max(
        8 - panelHeight / 2,
        Math.min(vh - 40 - panelHeight / 2, rawY)
      );
      
      setDragOffset({ x: clampedX, y: clampedY });
    };
    
    const handleUp = () => {
      setIsDragging(false);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
    
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, [dragOffset]);

  const handleThemeSelect = useCallback((selectedThemeId: ThemeId) => {
    setTheme(selectedThemeId);
    onSelect?.(selectedThemeId);
    handleClose();
  }, [setTheme, handleClose, onSelect]);

  const panelStyle = dragOffset
    ? { transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${dragOffset.y}px))` }
    : undefined;

  return (
    <>
      {!hideTrigger && (
        <button
          ref={triggerRef}
          className={styles.trigger}
          onClick={() => setInternalOpen((v) => !v)}
          aria-label="Pick theme"
        >
          <span className={styles.swatch} style={{ background: currentTheme.bg }} />
          {`Theme: ${currentTheme.name}`}
        </button>
      )}

      {isOpen && (
        <div 
          className={`${styles.panel} ${isDragging ? styles.dragging : ''}`} 
          ref={panelRef}
          style={panelStyle}
          role="dialog"
          aria-label="Choose theme"
        >
          <div 
            className={styles.header}
            ref={headerRef}
            onPointerDown={handlePointerDown}
            title="Drag to move"
          >
            <span className={styles.dragHandle} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
            <span className={styles.title}>Choose theme</span>
            <button
              ref={closeBtnRef}
              className={styles.closeBtn}
              onClick={handleClose}
              aria-label="Close theme picker"
            >
              ✕
            </button>
          </div>
          <div className={styles.list}>
            {THEMES.map((theme) => {
              const rc = parseInt(theme.bg.slice(1, 3), 16);
              const gc = parseInt(theme.bg.slice(3, 5), 16);
              const bc = parseInt(theme.bg.slice(5, 7), 16);
              const isLight = (rc + gc + bc) / 3 > 140;
              const isActive = theme.id === themeId;
              return (
                <button
                  key={theme.id}
                  className={`${styles.themeRow} ${isActive ? styles.themeRowActive : ''}`}
                  onClick={() => handleThemeSelect(theme.id as ThemeId)}
                  aria-label={`Select ${theme.name} theme`}
                >
                  <span className={styles.themeBar}>
                    <span style={{ flex: 40, background: theme.bg }} />
                    <span style={{ flex: 30, background: theme.surface }} />
                    <span style={{ flex: 20, background: theme.accent }} />
                    <span style={{ flex: 10, background: theme.text }} />
                  </span>
                  <span
                    className={styles.themeLabel}
                    style={isLight ? { color: '#1a1a1a', textShadow: 'none' } : undefined}
                  >
                    {theme.name}
                  </span>
                  {isActive && <span className={styles.themeCheck}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
