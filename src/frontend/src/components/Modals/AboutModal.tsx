import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { checkUpdate, fetchChangelog } from '@/services/api';
import styles from './PreviewModal.module.css';
import aboutStyles from './AboutModal.module.css';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  version: string;
}

export function AboutModal({ open, onClose, version }: AboutModalProps) {
  const [updateStatus, setUpdateStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [changelogState, setChangelogState] = useState<'idle' | 'loading' | 'loaded' | 'error'>(
    'idle',
  );
  const fetchStartedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (fetchStartedRef.current) return;
    fetchStartedRef.current = true;
    setChangelogState('loading');
    fetchChangelog().then((text) => {
      if (text) {
        setChangelog(text);
        setChangelogState('loaded');
      } else {
        setChangelogState('error');
        // Allow a retry on next open if the first fetch failed.
        fetchStartedRef.current = false;
      }
    });
  }, [open]);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    setUpdateStatus('');
    try {
      const data = await checkUpdate(true);
      if (!data) {
        setUpdateStatus('Unable to check for updates');
      } else if (data.updateAvailable) {
        setUpdateStatus(`Update available: v${data.latest} (current: v${data.current})`);
      } else {
        setUpdateStatus(`You're up to date (v${data.current})`);
      }
    } catch {
      setUpdateStatus('Unable to check for updates');
    } finally {
      setChecking(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    setUpdateStatus('');
    onClose();
  }, [onClose]);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={`${styles.content} ${aboutStyles.wide}`}>
          <Dialog.Title className={styles.title}>
            TermBeam {version ? `v${version}` : ''}
          </Dialog.Title>
          <Dialog.Description className={styles.description}>
            Terminal in your browser, optimized for mobile.
          </Dialog.Description>
          <button className={styles.close} onClick={handleClose} aria-label="Close">
            ✕
          </button>

          <div className={aboutStyles.body}>
            <div className={aboutStyles.linksRow}>
              <a
                href="https://github.com/dorlugasigal/TermBeam"
                target="_blank"
                rel="noopener noreferrer"
                className={aboutStyles.link}
              >
                GitHub
              </a>
              <a
                href="https://dorlugasigal.github.io/TermBeam/"
                target="_blank"
                rel="noopener noreferrer"
                className={aboutStyles.link}
              >
                Docs
              </a>
            </div>

            <div className={aboutStyles.updateRow}>
              <button
                type="button"
                className={styles.openBtn}
                onClick={handleCheckUpdate}
                disabled={checking}
              >
                {checking ? 'Checking…' : 'Check for updates'}
              </button>
            </div>

            {updateStatus && <div className={aboutStyles.updateStatus}>{updateStatus}</div>}

            <div className={aboutStyles.changelogHeader}>What&apos;s new</div>
            {changelogState === 'loading' && (
              <div className={aboutStyles.changelogPlaceholder}>Loading release notes…</div>
            )}
            {changelogState === 'error' && (
              <div className={aboutStyles.changelogPlaceholder}>
                Couldn&apos;t load release notes.{' '}
                <a
                  href="https://github.com/dorlugasigal/TermBeam/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={aboutStyles.link}
                >
                  View on GitHub
                </a>
              </div>
            )}
            {changelogState === 'loaded' && changelog && (
              <div className={aboutStyles.changelog}>
                <Markdown remarkPlugins={[remarkGfm]}>{changelog}</Markdown>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
