import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { createSession } from '@/services/api';
import { usePreferencesStore, type Workspace } from '@/stores/preferencesStore';
import { useSessionStore } from '@/stores/sessionStore';
import styles from './WorkspaceLauncher.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  onLaunched: (firstSessionId: string | undefined) => void;
}

/**
 * Launches one of the user's saved workspaces. Supports multiple named
 * workspaces (`prefs.workspaces[]`) and falls back to the legacy single
 * `prefs.startupWorkspace` if the user hasn't migrated yet.
 */
export default function WorkspaceLauncher({ open, onClose, onLaunched }: Props) {
  const prefs = usePreferencesStore((s) => s.prefs);
  const [launching, setLaunching] = useState<string | null>(null);

  const workspaces = useMemo<Workspace[]>(() => {
    const namedWorkspaces = prefs.workspaces ?? [];
    if (namedWorkspaces.length > 0) return namedWorkspaces;
    // Legacy fallback — surface the single startup workspace as one entry
    // so users with old data can still launch it.
    if (prefs.startupWorkspace?.sessions?.length) {
      return [
        {
          id: '__legacy__',
          name: 'Default startup',
          sessions: prefs.startupWorkspace.sessions,
        },
      ];
    }
    return [];
  }, [prefs]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleLaunch = async (ws: Workspace) => {
    if (ws.sessions.length === 0) {
      toast.info('This workspace is empty');
      return;
    }
    setLaunching(ws.id);
    let firstId: string | undefined;
    let firstWithCommand: string | undefined;
    let cmdCount = 0;
    try {
      for (const s of ws.sessions) {
        try {
          const cmd = (s.initialCommand ?? '').trim();
          const created = await createSession({
            name: s.name,
            cwd: s.cwd || undefined,
            color: s.color || undefined,
            shell: s.shell || undefined,
            initialCommand: cmd || undefined,
            type: s.kind === 'agent' ? 'agent' : 'terminal',
          });
          if (!firstId) firstId = created.id;
          if (cmd) {
            // Track on the client so saving this workspace later preserves
            // the command — without this round-trip, a user who launches
            // and then re-saves would lose the command.
            useSessionStore.getState().setPendingInitialCommand(created.id, cmd);
            if (!firstWithCommand) firstWithCommand = created.id;
            cmdCount += 1;
          }
        } catch (err) {
          toast.error(
            `Failed to launch "${s.name}": ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        }
      }
      const cmdSummary = cmdCount > 0 ? ` · ${cmdCount} initial command${cmdCount === 1 ? '' : 's'} running` : '';
      toast.success(
        `Launched ${ws.sessions.length} session${ws.sessions.length === 1 ? '' : 's'}${cmdSummary}`,
      );
      // Prefer to land the user on the first session that has an initial
      // command so they can see it execute (the most common gripe is
      // "I clicked launch and nothing happened" — which usually means
      // they landed on a session WITHOUT a command).
      onLaunched(firstWithCommand ?? firstId);
      onClose();
    } finally {
      setLaunching(null);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Open Workspace</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.body}>
          {workspaces.length === 0 ? (
            <div className={styles.empty}>
              <p>No workspaces saved yet.</p>
              <p className={styles.emptyHint}>
                Open <strong>Settings → Workspaces</strong> and click <em>Save current as new
                workspace</em> after spinning up the sessions you want grouped.
              </p>
            </div>
          ) : (
            <ul className={styles.list}>
              {workspaces.map((ws) => (
                <li key={ws.id} className={styles.workspaceItem}>
                  <div className={styles.workspaceHeader}>
                    <span className={styles.workspaceName}>{ws.name}</span>
                    {ws.default && <span className={styles.defaultBadge}>auto-start</span>}
                    <span className={styles.workspaceCount}>
                      {ws.sessions.length} session{ws.sessions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className={styles.sessionList}>
                    {ws.sessions.slice(0, 5).map((s) => (
                      <li key={s.id} className={styles.sessionItem}>
                        <span
                          className={styles.sessionColor}
                          style={{ background: s.color || 'var(--accent)' }}
                          aria-hidden="true"
                        />
                        <div className={styles.sessionBody}>
                          <span className={styles.sessionName}>{s.name}</span>
                          {s.initialCommand && (
                            <code className={styles.sessionCmd} title={s.initialCommand}>
                              {s.initialCommand}
                            </code>
                          )}
                        </div>
                      </li>
                    ))}
                    {ws.sessions.length > 5 && (
                      <li className={styles.sessionMore}>
                        + {ws.sessions.length - 5} more
                      </li>
                    )}
                  </ul>
                  <button
                    className={styles.launchBtn}
                    onClick={() => handleLaunch(ws)}
                    disabled={launching !== null}
                  >
                    {launching === ws.id ? 'Launching…' : 'Launch'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
