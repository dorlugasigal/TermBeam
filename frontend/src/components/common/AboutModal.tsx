import { useCallback, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { checkUpdate } from '@/services/api';
import styles from './PreviewModal.module.css';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  version: string;
}

export function AboutModal({ open, onClose, version }: AboutModalProps) {
  const [updateStatus, setUpdateStatus] = useState('');
  const [checking, setChecking] = useState(false);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    setUpdateStatus('');
    try {
      const data = await checkUpdate(true);
      if (!data) {
        setUpdateStatus('Unable to check for updates');
      } else if (data.hasUpdate) {
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
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>
            TermBeam {version ? `v${version}` : ''}
          </Dialog.Title>
          <Dialog.Description className={styles.description}>
            Terminal in your browser, optimized for mobile.
          </Dialog.Description>
          <button
            className={styles.close}
            onClick={handleClose}
            aria-label="Close"
          >
            ✕
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a
                href="https://github.com/dorlugasigal/TermBeam"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', fontSize: '0.9rem' }}
              >
                GitHub
              </a>
              <a
                href="https://dorlugasigal.github.io/TermBeam/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', fontSize: '0.9rem' }}
              >
                Docs
              </a>
              <a
                href="https://termbeam.pages.dev"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', fontSize: '0.9rem' }}
              >
                Website
              </a>
            </div>

            <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
              <button
                type="button"
                className={styles.openBtn}
                onClick={handleCheckUpdate}
                disabled={checking}
                style={{ fontSize: '0.85rem' }}
              >
                {checking ? 'Checking…' : 'Check for updates'}
              </button>
            </div>

            {updateStatus && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {updateStatus}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
