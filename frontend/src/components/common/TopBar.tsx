import type { ReactNode } from 'react';
import styles from './TopBar.module.css';

interface TopBarProps {
  onMenuClick?: () => void;
  showBackButton?: boolean;
  children?: ReactNode;
  actions?: ReactNode;
}

export function TopBar({ onMenuClick, showBackButton = true, children, actions }: TopBarProps) {
  return (
    <header className={styles.topBar}>
      <div className={styles.left}>
        {onMenuClick && (
          <button className={styles.menuBtn} onClick={onMenuClick} aria-label="Open menu">
            ☰
          </button>
        )}
        {showBackButton && (
          <a href="/" className={styles.backBtn}>
            ← Back
          </a>
        )}
        <span className={styles.logo}>TermBeam</span>
      </div>

      <div className={styles.center}>{children}</div>

      <div className={styles.right}>{actions}</div>
    </header>
  );
}
