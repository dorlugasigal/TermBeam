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
import { CopilotLogo } from '@/components/common/CopilotLogo';
import styles from './NewSessionModal.module.css';

interface NewSessionModalProps {
  onCreated: (id: string, type?: 'terminal' | 'copilot', ptySessionId?: string | null, model?: string) => void;
}

const COPILOT_MODELS = [
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
  { id: 'claude-opus-4.5', label: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.2', label: 'GPT-5.2' },
  { id: 'gpt-5.1', label: 'GPT-5.1' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
];

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
  // Shared state
  const [sessionMode, setSessionMode] = useState<'terminal' | 'copilot'>('terminal');
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [cwd, setCwd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  // Terminal-specific state
  const [shell, setShell] = useState('');
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [initialCommand, setInitialCommand] = useState('');
  const [color, setColor] = useState<SessionColor>(SESSION_COLORS[0]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  // Copilot-specific state
  const [model, setModel] = useState('claude-opus-4.6');

  const deriveNameFromCwd = useCallback(
    (dir: string, mode?: 'terminal' | 'copilot') => {
      if (nameManuallyEdited) return;
      const sessions = useSessionStore.getState().sessions;
      const existingNames = new Set<string>();
      for (const s of sessions.values()) existingNames.add(s.name);
      const base = folderName(dir);
      const suffix = (mode ?? sessionMode) === 'copilot' ? ' · Copilot' : '';
      setName(uniqueName(`${base}${suffix}`, existingNames));
    },
    [nameManuallyEdited, sessionMode],
  );

  useEffect(() => {
    if (newSessionModalOpen) {
      fetchShells()
        .catch(() => ({ shells: [], defaultShell: '', cwd: '' }))
        .then((shellData) => {
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
        });
      fetchAgents()
        .then((data) => setAgents(data.agents || []))
        .catch(() => setAgents([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps — intentionally runs only on modal open/close
  }, [newSessionModalOpen]);

  function resetForm() {
    setSessionMode('terminal');
    setName('');
    setNameManuallyEdited(false);
    setShell('');
    setCwd('');
    setInitialCommand('');
    setColor(SESSION_COLORS[0]);
    setBrowsing(false);
    setModel('claude-sonnet-4');
  }

  function handleModeSwitch(mode: 'terminal' | 'copilot') {
    setSessionMode(mode);
    if (!nameManuallyEdited && cwd) {
      deriveNameFromCwd(cwd, mode);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const store = useSessionStore.getState();
      const activeMs = store.activeId ? store.sessions.get(store.activeId) : null;
      const cols = activeMs?.term?.cols;
      const rows = activeMs?.term?.rows;

      const session = await createSession(
        sessionMode === 'copilot'
          ? {
              name: name.trim() || undefined,
              cwd: cwd.trim() || undefined,
              type: 'copilot',
              model,
              ...(cols && rows ? { cols, rows } : {}),
            }
          : {
              name: name.trim() || undefined,
              shell: shell || undefined,
              cwd: cwd.trim() || undefined,
              color,
              initialCommand: initialCommand.trim() || undefined,
              ...(cols && rows ? { cols, rows } : {}),
            },
      );
      closeNewSessionModal();
      resetForm();
      onCreated(session.id, sessionMode, session.ptySessionId ?? null, sessionMode === 'copilot' ? model : undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAgentLaunch(agent: AgentInfo) {
    setSubmitting(true);
    try {
      const store = useSessionStore.getState();
      const activeMs = store.activeId ? store.sessions.get(store.activeId) : null;
      const cols = activeMs?.term?.cols;
      const rows = activeMs?.term?.rows;

      const session = await createSession({
        name: name.trim() || `${agent.name}`,
        shell: shell || undefined,
        cwd: cwd.trim() || undefined,
        color,
        initialCommand: agent.args?.length ? `${agent.cmd} ${agent.args.join(' ')}` : agent.cmd,
        ...(cols && rows ? { cols, rows } : {}),
      });
      closeNewSessionModal();
      resetForm();
      onCreated(session.id, 'terminal');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to launch agent');
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
              {/* Session type tabs */}
              <div className={styles.sessionTypeTabs}>
                <button
                  type="button"
                  className={`${styles.sessionTypeTab} ${sessionMode === 'terminal' ? styles.sessionTypeTabActive : ''}`}
                  onClick={() => handleModeSwitch('terminal')}
                >
                  &gt;_ Terminal
                </button>
                <button
                  type="button"
                  className={`${styles.sessionTypeTab} ${sessionMode === 'copilot' ? styles.sessionTypeTabActive : ''}`}
                  onClick={() => handleModeSwitch('copilot')}
                >
                  <CopilotLogo size={14} /> GitHub Copilot
                </button>
              </div>

              {/* Working Directory — shared by both modes */}
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

              {/* Name — shared by both modes */}
              <div className={styles.field}>
                <label className={styles.label}>Name</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder={
                    sessionMode === 'copilot'
                      ? `${folderName(cwd || '/')} · Copilot`
                      : folderName(cwd || '/')
                  }
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameManuallyEdited(true);
                  }}
                  data-testid="ns-name"
                />
              </div>

              {/* Terminal-specific fields */}
              {sessionMode === 'terminal' && (
                <>
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

                  {agents.length > 0 && (
                    <div className={styles.field}>
                      <label className={styles.label}>AI Agents</label>
                      <div className={styles.agentGrid}>
                        {agents.map((agent) => (
                          <button
                            key={agent.id}
                            type="button"
                            className={styles.agentCard}
                            disabled={submitting}
                            onClick={() => handleAgentLaunch(agent)}
                          >
                            <span className={styles.agentIcon}>
                              {<AgentIcon agent={agent.icon || agent.id} size="md" />}
                            </span>
                            <span className={styles.agentName}>{agent.name}</span>
                            {agent.version && (
                              <span className={styles.agentVersion}>{agent.version}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Copilot-specific fields */}
              {sessionMode === 'copilot' && (
                <div className={styles.field}>
                  <label className={styles.label}>Model</label>
                  <select
                    className={styles.modelSelect}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    data-testid="ns-model"
                  >
                    {COPILOT_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
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

              {/* Actions */}
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
                  {sessionMode === 'copilot' ? 'Start Copilot Session' : 'Create'}
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
