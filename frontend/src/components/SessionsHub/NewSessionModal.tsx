import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { createSession, fetchShells } from '@/services/api';
import { SESSION_COLORS, type SessionColor } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser';
import styles from './NewSessionModal.module.css';

interface NewSessionModalProps {
  onCreated: (id: string) => void;
}

export default function NewSessionModal({ onCreated }: NewSessionModalProps) {
  const { newSessionModalOpen, closeNewSessionModal } = useUIStore();
  const [name, setName] = useState('');
  const [shell, setShell] = useState('');
  const [shells, setShells] = useState<string[]>([]);
  const [cwd, setCwd] = useState('');
  const [color, setColor] = useState<SessionColor>(SESSION_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    if (newSessionModalOpen) {
      fetchShells()
        .then((list) => {
          setShells(list);
          if (!shell && list.length > 0) setShell(list[0]!);
        })
        .catch(() => setShells([]));
    }
  }, [newSessionModalOpen, shell]);

  function resetForm() {
    setName('');
    setShell('');
    setCwd('');
    setColor(SESSION_COLORS[0]);
    setBrowsing(false);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const session = await createSession({
        name: name.trim() || undefined,
        shell: shell || undefined,
        cwd: cwd.trim() || undefined,
        color,
      });
      toast.success(`Session "${session.name}" created`);
      closeNewSessionModal();
      resetForm();
      onCreated(session.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={newSessionModalOpen} onOpenChange={(open) => {
      if (!open) {
        closeNewSessionModal();
        resetForm();
      }
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>New Session</Dialog.Title>

          {browsing ? (
            <FolderBrowser
              currentDir={cwd || '/'}
              onSelect={(dir: string) => {
                setCwd(dir);
                setBrowsing(false);
              }}
              onCancel={() => setBrowsing(false)}
            />
          ) : (
            <div className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>Name</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="my-session"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Shell</label>
                <select
                  className={styles.select}
                  value={shell}
                  onChange={(e) => setShell(e.target.value)}
                >
                  {shells.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Working Directory</label>
                <div className={styles.dirRow}>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="/"
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.browseBtn}
                    onClick={() => setBrowsing(true)}
                  >
                    Browse
                  </button>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Color</label>
                <div className={styles.colorPicker}>
                  {SESSION_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`${styles.colorDot} ${c === color ? styles.colorDotActive : ''}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => {
                    closeNewSessionModal();
                    resetForm();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.submitBtn}
                  disabled={submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
