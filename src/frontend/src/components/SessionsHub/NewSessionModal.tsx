import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { createSession, fetchShells, fetchAgents } from '@/services/api';
import type { ShellInfo, AgentInfo } from '@/services/api';
import { SESSION_COLORS, type SessionColor } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser';
import { AgentIcon } from '@/components/common/AgentIcon';
import styles from './NewSessionModal.module.css';

interface NewSessionModalProps {
  onCreated: (id: string) => void;
}

function folderName(dir: string): string {
  const parts = dir.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || dir;
}

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

export default function NewSessionModal({ onCreated }: NewSessionModalProps) {
  const { newSessionModalOpen, closeNewSessionModal } = useUIStore();
  // Shell state
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [shell, setShell] = useState('');
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [cwd, setCwd] = useState('');
  const [initialCommand, setInitialCommand] = useState('');
  const [color, setColor] = useState<SessionColor>(SESSION_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  // Agent state
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);

  const deriveNameFromCwd = useCallback(
    (dir: string) => {
      if (nameManuallyEdited) return;
      const sessions = useSessionStore.getState().sessions;
      const existingNames = new Set<string>();
      for (const s of sessions.values()) existingNames.add(s.name);
      setName(uniqueName(folderName(dir), existingNames));
    },
    [nameManuallyEdited],
  );

  useEffect(() => {
    if (newSessionModalOpen) {
      // Fetch shells and agents in parallel
      Promise.all([
        fetchShells().catch(() => ({ shells: [], defaultShell: '', cwd: '' })),
        fetchAgents().catch(() => ({ agents: [] })),
      ]).then(([shellData, agentData]) => {
        // Shells
        const list = shellData.shells;
        setShells(list);
        if (!shell) {
          const def =
            list.find((s) => s.cmd === shellData.defaultShell) ||
            list.find((s) => s.path === shellData.defaultShell);
          setShell(def?.cmd ?? list[0]?.cmd ?? '');
        }
        if (!cwd && shellData.cwd) {
          setCwd(shellData.cwd);
          deriveNameFromCwd(shellData.cwd);
        }
        // Agents — auto-expand custom section if no agents detected
        setAgents(agentData.agents);
        if (agentData.agents.length === 0) setShowCustom(true);
      });
    }
  }, [newSessionModalOpen]);

  function resetForm() {
    setName('');
    setNameManuallyEdited(false);
    setShell('');
    setCwd('');
    setInitialCommand('');
    setColor(SESSION_COLORS[0]);
    setBrowsing(false);
    setShowCustom(false);
    setLaunching(null);
  }

  async function handleAgentLaunch(agent: AgentInfo) {
    setLaunching(agent.id);
    try {
      const store = useSessionStore.getState();
      const activeMs = store.activeId ? store.sessions.get(store.activeId) : null;
      const cols = activeMs?.term?.cols;
      const rows = activeMs?.term?.rows;

      const command = agent.args?.length ? `${agent.cmd} ${agent.args.join(' ')}` : agent.cmd;

      const sessions = useSessionStore.getState().sessions;
      const existingNames = new Set<string>();
      for (const s of sessions.values()) existingNames.add(s.name);
      const sessionName = uniqueName(folderName(cwd || '/'), existingNames);

      const session = await createSession({
        name: sessionName,
        cwd: cwd.trim() || undefined,
        initialCommand: command,
        color: '#c084fc',
        ...(cols && rows ? { cols, rows } : {}),
      });
      closeNewSessionModal();
      resetForm();
      onCreated(session.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to launch agent');
    } finally {
      setLaunching(null);
    }
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
    <Dialog.Root
      open={newSessionModalOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeNewSessionModal();
          resetForm();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          data-testid="new-session-modal"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className={styles.title}>New Session</Dialog.Title>

          {browsing ? (
            <FolderBrowser
              currentDir={cwd || '/'}
              onSelect={(dir: string) => {
                setCwd(dir);
                deriveNameFromCwd(dir);
                setBrowsing(false);
              }}
              onCancel={() => setBrowsing(false)}
            />
          ) : (
            <div className={styles.form}>
              {/* Working Directory — shared by agents and custom */}
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

              {/* AI Agents section */}
              {agents.length > 0 && (
                <div className={styles.agentSection}>
                  <label className={styles.label}>AI Agents</label>
                  <div className={styles.agentGrid}>
                    {agents.map((agent) => (
                      <button
                        key={agent.id}
                        className={styles.agentCard}
                        disabled={launching !== null || submitting}
                        onClick={() => handleAgentLaunch(agent)}
                      >
                        <span className={styles.agentIcon}><AgentIcon agent={agent.icon} size="md" /></span>
                        <span className={styles.agentName}>{agent.name}</span>
                        {launching === agent.id && (
                          <span className={styles.agentSpinner}>⟳</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Resume link */}
              <button
                type="button"
                className={styles.resumeLink}
                onClick={() => {
                  closeNewSessionModal();
                  useUIStore.getState().openResumeBrowser();
                }}
              >
                Resume previous session →
              </button>

              {/* Divider */}
              <div className={styles.divider}>
                <button
                  type="button"
                  className={styles.dividerBtn}
                  onClick={() => setShowCustom(!showCustom)}
                >
                  {showCustom ? '▾ Custom Session' : '▸ Custom Session'}
                </button>
              </div>

              {/* Custom session form (expandable) */}
              {showCustom && (
                <>
                  <div className={styles.field}>
                    <label className={styles.label}>Name</label>
                    <input
                      className={styles.input}
                      type="text"
                      placeholder={folderName(cwd || '/')}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setNameManuallyEdited(true);
                      }}
                      data-testid="ns-name"
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>Shell</label>
                    <select
                      className={styles.select}
                      value={shell}
                      onChange={(e) => setShell(e.target.value)}
                      data-testid="ns-shell"
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
                      data-testid="ns-cancel"
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
                      data-testid="ns-create"
                      onClick={handleSubmit}
                    >
                      Create
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
