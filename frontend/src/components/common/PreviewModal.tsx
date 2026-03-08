import { useCallback, useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import styles from './PreviewModal.module.css';

export function PreviewModal() {
  const open = useUIStore((s) => s.previewModalOpen);
  const close = useUIStore((s) => s.closePreviewModal);
  const sessionId = useSessionStore((s) => s.activeId);
  const [port, setPort] = useState('');
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (!open || !sessionId) return;
    setHint('');
    fetch(`/api/sessions/${sessionId}/detect-port`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.detected) {
          setPort(String(data.port));
          setHint(`Detected port ${data.port}`);
        }
      })
      .catch(() => {});
  }, [open, sessionId]);

  const handleClose = useCallback(() => {
    setPort('');
    setHint('');
    close();
  }, [close]);

  const handleOpen = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const portNum = parseInt(port, 10);
      if (!portNum || portNum < 1 || portNum > 65535) return;
      window.open(`/preview/${portNum}/`, '_blank');
      handleClose();
    },
    [port, handleClose],
  );

  const isValid = (() => {
    const n = parseInt(port, 10);
    return !isNaN(n) && n >= 1 && n <= 65535;
  })();

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>Port Preview</Dialog.Title>
          <Dialog.Description className={styles.description}>
            Preview a service running on localhost
          </Dialog.Description>
          <button
            className={styles.close}
            onClick={handleClose}
            aria-label="Close"
          >
            ✕
          </button>

          <form onSubmit={handleOpen}>
            <label className={styles.label}>Port number</label>
            <input
              className={styles.input}
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="e.g. 3000"
              autoFocus
            />
            {hint && (
              <div style={{ fontSize: '0.8rem', color: 'var(--accent)', marginTop: 4 }}>
                {hint}
              </div>
            )}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.openBtn}
                disabled={!isValid}
              >
                Open Preview
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
