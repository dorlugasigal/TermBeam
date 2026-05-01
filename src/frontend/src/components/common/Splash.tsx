import type { ReactNode } from 'react';
import { Wordmark, type WordmarkSize } from './Wordmark';
import styles from './Splash.module.css';

interface SplashProps {
  /** Wordmark size — defaults to `lg` for cold-load splash. */
  size?: WordmarkSize;
  /** Quiet status line shown beneath the wordmark. */
  status?: string;
  /** Optional action button (e.g. "Retry") rendered below the status. */
  action?: ReactNode;
}

/**
 * Cold-launch / reconnecting splash. Renders the Inter-ExtraBold wordmark
 * with a single fade + blur-clear entrance, plus a quiet monospace status
 * line with breathing dots so the user knows the app is doing something
 * even when the message isn't changing.
 *
 * Used by `App.tsx` for the initial auth-check screen and the no-password
 * mode reconnecting screen. The minimum splash duration is enforced by
 * `useMinDuration` in the host so the wordmark animation has time to play.
 */
export function Splash({ size = 'lg', status, action }: SplashProps) {
  return (
    <div className={styles.root}>
      <div className={styles.stack}>
        <Wordmark size={size} />
        {(status || action) && (
          <div className={styles.statusBlock}>
            {status && (
              <span className={styles.status}>
                {status}
                <span className={styles.dots} aria-hidden="true">
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                </span>
              </span>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

export default Splash;
