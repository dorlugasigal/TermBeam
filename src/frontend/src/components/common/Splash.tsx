import type { ReactNode } from 'react';
import { Wordmark, type WordmarkSize } from './Wordmark';
import styles from './Splash.module.css';

interface SplashProps {
  /** Wordmark size — defaults to `lg` for cold-load splash. */
  size?: WordmarkSize;
  /** Quiet status line shown beneath the wordmark. */
  status?: string;
  /** Optional explanation under the status (error / waiting states). */
  detail?: string;
  /** Optional action button (e.g. "Retry") rendered below the status. */
  action?: ReactNode;
}

/**
 * Cold-launch / waiting splash: the stroke-drawn wordmark, a carrier line,
 * and a monospace status with breathing dots so the user knows the app is
 * doing something even when the message isn't changing.
 */
export function Splash({ size = 'lg', status, detail, action }: SplashProps) {
  return (
    <div className={styles.root}>
      <div className={styles.stack}>
        <Wordmark size={size} />
        <span className={styles.carrier} aria-hidden="true" />
        {(status || action) && (
          <div className={styles.statusBlock} role="status" aria-live="polite">
            {status && (
              <span className={styles.status}>
                {status}
                {!action && (
                  <span className={styles.dots} aria-hidden="true">
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                  </span>
                )}
              </span>
            )}
            {detail && <p className={styles.detail}>{detail}</p>}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

export default Splash;
