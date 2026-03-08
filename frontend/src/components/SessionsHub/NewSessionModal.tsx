import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { createSession, fetchShells } from '@/services/api';
import type { ShellInfo } from '@/services/api';
import { SESSION_COLORS, type SessionColor } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser';
import styles from './NewSessionModal.module.css';

interface NewSessionModalProps {
  onCreated: (id: string) => void;
}

export default function NewSessionModal({ onCreated }: NewSessionModalProps) {
  const { newSessionModalOpen, closeNewSessionModal } = useUIStore();
  const [name, setName] = useState('');
  const [shell, setShell] = useState('');
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [cwd, setCwd] = useState('');
  const [initialCommand, setInitialCommand] = useState('');
  const [color, setColor] = useState<SessionColor>(SESSION_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    if (newSessionModalOpen) {
      fetchShells()
        .then(({ shells: list, defaultShell, cwd: serverCwd }) => {
          setShells(list);
          if (!shell) {
            const def =
              list.find((s) => s.cmd === defaultShell) ||
              list.find((s) => s.path === defaultShell);
            setShell(def?.cmd ?? list[0]?.cmd ?? '');
          }
          if (!cwd && serverCwd) setCwd(serverCwd);
        })
        .catch(() => setShells([]));
    }
  }, [newSessionModalOpen]);

  function resetForm() {
    setName('');
    setShell('');
    setCwd('');
    setInitialCommand('');
    setColor(SESSION_COLORS[0]);
    setBrowsing(false);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const store = useSessionStore.getState();
      const activeMs = store.activeId ? store.sessions.get(store.activeId) : null;
      const cols = activeMs?.term?.cols;
      const rows = activeMs?.term?.rows;

      const session = await createSession({
        name: name.trim() || undefined,
        shell: shell || undefined,
        cwd: cwd.trim() || undefined,
        color,
        initialCommand: initialCommand.trim() || undefined,
        ...(cols && rows ? { cols, rows } : {}),
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
                    <option key={s.path} value={s.cmd}>
                      {s.name} ({s.path})
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Initial command</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. npm run dev"
                  value={initialCommand}
                  onChange={(e) => setInitialCommand(e.target.value)}
                />
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
