import { useState, useEffect } from 'react';
import { checkUpdate } from '@/services/api';
import styles from './UpdateBanner.module.css';

export default function UpdateBanner() {
  const [update, setUpdate] = useState<{ current: string; latest: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkUpdate().then((result) => {
      if (result?.hasUpdate) {
        setUpdate({ current: result.current, latest: result.latest });
      }
    });
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className={styles.banner}>
      <span className={styles.text}>
        Update available: v{update.current} → v{update.latest}
      </span>
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update banner"
      >
        ✕
      </button>
    </div>
  );
}
