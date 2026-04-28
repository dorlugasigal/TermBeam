import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { createSession } from '@/services/api';
import { usePreferencesStore, type Workspace, type StartupSession } from '@/stores/preferencesStore';
import { useSessionStore } from '@/stores/sessionStore';
import styles from './WorkspaceLauncher.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  onLaunched: (firstSessionId: string | undefined) => void;
}

function basename(p: string): string {
  if (!p) return '';
  const m = p.replace(/\/+$/, '').match(/[^/\\]+$/);
  return m ? m[0] : p;
}

function shortenPath(p: string, maxChars = 36): string {
  if (!p) return '~';
  if (p.length <= maxChars) return p;
  const head = p.slice(0, 14);
  const tail = p.slice(-(maxChars - 16));
  return `${head}…${tail}`;
}

/**
 * Launches one of the user's saved workspaces. Supports multiple named
 * workspaces (`prefs.workspaces[]`) and falls back to the legacy single
 * `prefs.startupWorkspace` if the user hasn't migrated yet.
 */
export default function WorkspaceLauncher({ open, onClose, onLaunched }: Props) {
  const prefs = usePreferencesStore((s) => s.prefs);
  const [launching, setLaunching] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const workspaces = useMemo<Workspace[]>(() => {
    const namedWorkspaces = prefs.workspaces ?? [];
    if (namedWorkspaces.length > 0) return namedWorkspaces;
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

  // Auto-expand the first workspace when only one exists
  useEffect(() => {
    if (workspaces.length === 1 && workspaces[0]) setExpandedId(workspaces[0].id);
  }, [workspaces]);

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
        const cmd = (s.initialCommand ?? '').trim();
        const baseReq = {
          name: s.name,
          cwd: s.cwd || undefined,
          color: s.color || undefined,
          initialCommand: cmd || undefined,
          type: (s.kind === 'agent' ? 'agent' : 'terminal') as 'agent' | 'terminal',
        };
        let created;
        try {
          created = await createSession({ ...baseReq, shell: s.shell || undefined });
        } catch (err) {
          // Fall back without shell if the saved value isn't recognized
          // on this host (basename vs full path, missing on this machine).
          const msg = err instanceof Error ? err.message : '';
          if (msg.toLowerCase().includes('shell')) {
            try {
              created = await createSession(baseReq);
            } catch (err2) {
              toast.error(
                `Failed to launch "${s.name}": ${err2 instanceof Error ? err2.message : 'unknown error'}`,
              );
              continue;
            }
          } else {
            toast.error(`Failed to launch "${s.name}": ${msg || 'unknown error'}`);
            continue;
          }
        }
        if (!firstId) firstId = created.id;
        if (cmd) {
          useSessionStore.getState().setPendingInitialCommand(created.id, cmd);
          if (!firstWithCommand) firstWithCommand = created.id;
          cmdCount += 1;
        }
      }
      const cmdSummary =
        cmdCount > 0 ? ` · ${cmdCount} initial command${cmdCount === 1 ? '' : 's'} running` : '';
      toast.success(
        `Launched ${ws.sessions.length} session${ws.sessions.length === 1 ? '' : 's'}${cmdSummary}`,
      );
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
          <div className={styles.titleBlock}>
            <span className={styles.title}>Open Workspace</span>
            {workspaces.length > 0 && (
              <span className={styles.subtitle}>
                {workspaces.length} saved workspace{workspaces.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.body}>
          {workspaces.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon} aria-hidden="true">
                ⊞
              </div>
              <p className={styles.emptyTitle}>No workspaces yet</p>
              <p className={styles.emptyHint}>
                Open <strong>Settings → Workspaces</strong> after spinning up the sessions you want
                grouped, then click <em>Save current as new workspace</em>.
              </p>
            </div>
          ) : (
            <ul className={styles.list}>
              {workspaces.map((ws) => {
                const isExpanded = expandedId === ws.id;
                const cmdCount = ws.sessions.filter((s) => (s.initialCommand ?? '').trim()).length;
                const agentCount = ws.sessions.filter((s) => s.kind === 'agent').length;
                return (
                  <li key={ws.id} className={styles.workspaceItem}>
                    <button
                      type="button"
                      className={styles.workspaceHeader}
                      onClick={() => setExpandedId(isExpanded ? null : ws.id)}
                      aria-expanded={isExpanded}
                    >
                      <div className={styles.workspaceTitleRow}>
                        <span className={styles.workspaceName}>{ws.name}</span>
                        {ws.default && (
                          <span className={styles.defaultBadge}>auto-start</span>
                        )}
                      </div>
                      <div className={styles.workspaceMetaRow}>
                        <span className={styles.metaPill}>
                          {ws.sessions.length} session{ws.sessions.length === 1 ? '' : 's'}
                        </span>
                        {agentCount > 0 && (
                          <span className={styles.metaPillAgent}>
                            {agentCount} agent{agentCount === 1 ? '' : 's'}
                          </span>
                        )}
                        {cmdCount > 0 && (
                          <span className={styles.metaPillCmd}>
                            {cmdCount} command{cmdCount === 1 ? '' : 's'}
                          </span>
                        )}
                        <span className={styles.chevron} aria-hidden="true">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                      </div>
                      <ColorStrip sessions={ws.sessions} />
                    </button>

                    {isExpanded && (
                      <div className={styles.workspaceBody}>
                        <ul className={styles.sessionList}>
                          {ws.sessions.map((s) => (
                            <SessionPreview key={s.id} session={s} />
                          ))}
                        </ul>
                        <button
                          className={styles.launchBtn}
                          onClick={() => handleLaunch(ws)}
                          disabled={launching !== null || ws.sessions.length === 0}
                        >
                          {launching === ws.id ? (
                            <>
                              <span className={styles.spinner} aria-hidden="true" />
                              Launching…
                            </>
                          ) : (
                            <>
                              Launch{' '}
                              {ws.sessions.length > 1 && (
                                <span className={styles.launchCount}>
                                  {ws.sessions.length}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ColorStrip({ sessions }: { sessions: StartupSession[] }) {
  if (sessions.length === 0) return null;
  return (
    <div className={styles.colorStrip} aria-hidden="true">
      {sessions.slice(0, 12).map((s, i) => (
        <span
          key={s.id + i}
          className={styles.colorStripSegment}
          style={{ background: s.color || 'var(--accent)' }}
        />
      ))}
    </div>
  );
}

function SessionPreview({ session }: { session: StartupSession }) {
  const cwdShort = shortenPath(session.cwd || '~');
  const cwdLeaf = basename(session.cwd || '');
  return (
    <li className={styles.sessionItem}>
      <span
        className={styles.sessionColorBar}
        style={{ background: session.color || 'var(--accent)' }}
        aria-hidden="true"
      />
      <div className={styles.sessionMain}>
        <div className={styles.sessionTopRow}>
          <span className={styles.sessionName}>{session.name}</span>
          <span
            className={`${styles.kindBadge} ${
              session.kind === 'agent' ? styles.kindBadgeAgent : styles.kindBadgeTerminal
            }`}
          >
            {session.kind === 'agent' ? 'Agent' : 'Terminal'}
          </span>
        </div>
        <div className={styles.sessionPath} title={session.cwd || '~'}>
          <span className={styles.pathIcon} aria-hidden="true">
            ⌘
          </span>
          <span className={styles.pathDir}>{cwdLeaf || '~'}</span>
          <span className={styles.pathFull}>{cwdShort}</span>
        </div>
        {session.initialCommand && (
          <div className={styles.sessionCmdRow} title={session.initialCommand}>
            <span className={styles.cmdLabel}>$</span>
            <code className={styles.cmdText}>{session.initialCommand}</code>
          </div>
        )}
        {(session.shell || (session.kind === 'agent' && session.agentId)) && (
          <div className={styles.sessionMeta}>
            {session.shell && (
              <span className={styles.metaItem}>
                <span className={styles.metaKey}>shell</span>
                <code>{basename(session.shell)}</code>
              </span>
            )}
            {session.kind === 'agent' && session.agentId && (
              <span className={styles.metaItem}>
                <span className={styles.metaKey}>agent</span>
                <code>{session.agentId}</code>
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
