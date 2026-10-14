import { useState, useEffect, useCallback, useRef, useId, useLayoutEffect } from 'react';
import { toast } from 'sonner';
import { createSession, fetchShells, fetchAgents } from '@/services/api';
import type { ShellInfo, AgentInfo } from '@/services/api';
import { SESSION_COLORS, type SessionColor } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useCopilotModelsStore } from '@/stores/copilotModelsStore';
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser';
import { AgentIcon } from '@/components/common/AgentIcon';
import { CopilotLogo } from '@/components/common/CopilotLogo';
import { ModelSelect } from '@/components/common/ModelSelect';
import { Sheet } from '@/components/common/Sheet';
import form from '@/styles/forms.module.css';
import styles from './NewSessionModal.module.css';

interface NewSessionModalProps {
  onCreated: (
    id: string,
    type?: 'terminal' | 'copilot',
    ptySessionId?: string | null,
    model?: string,
  ) => void;
}

const savedCopilotModel = () => usePreferencesStore.getState().prefs.copilotModel;

/** Grow a textarea to fit its content (fallback for `field-sizing: content`). */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
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
  const { newSessionModalOpen, closeNewSessionModal, newSessionModalInitialMode } = useUIStore();
  const defaultFolder = usePreferencesStore((s) => s.prefs.defaultFolder);
  const defaultInitialCommand = usePreferencesStore((s) => s.prefs.defaultInitialCommand);
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
  const [model, setModel] = useState(savedCopilotModel);
  const copilotModels = useCopilotModelsStore((s) => s.models);
  const modelsStatus = useCopilotModelsStore((s) => s.status);
  const ids = useId();
  const cwdRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(cwdRef, cwd);

  // A remembered model that Copilot no longer offers falls back to its default.
  useEffect(() => {
    if (model && copilotModels.length && !copilotModels.some((m) => m.id === model)) {
      setModel('');
    }
  }, [model, copilotModels]);

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
      if (newSessionModalInitialMode) {
        setSessionMode(newSessionModalInitialMode);
      }
      // Prefs may have hydrated (or changed on another device) since mount.
      setModel(savedCopilotModel());
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
          // The shells fetch is async — by the time it resolves, the
          // defaultFolder seed effect may have already populated cwd.
          // Prefer the saved defaultFolder over the server's reported cwd
          // so the user's preference always wins. Read both directly from
          // the live stores to dodge stale React closures.
          const livePrefs = usePreferencesStore.getState().prefs;
          const liveDefaultFolder = livePrefs.defaultFolder;
          if (liveDefaultFolder) {
            // defaultFolder is being seeded by the other effect; nothing
            // to do here. Just derive a session name from it if needed.
            if (!nameManuallyEdited) deriveNameFromCwd(liveDefaultFolder);
            return;
          }
          // No defaultFolder pref — fall back to the server's cwd.
          // Use a setter callback so we read the latest cwd state, not
          // the stale closure from when the effect started.
          if (shellData.cwd) {
            setCwd((current) => current || shellData.cwd);
            if (!nameManuallyEdited) deriveNameFromCwd(shellData.cwd);
          }
        });
      fetchAgents()
        .then((data) => setAgents(data.agents || []))
        .catch(() => setAgents([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps — intentionally runs only on modal open/close
  }, [newSessionModalOpen]);

  // Seed default folder + initial command from prefs. Track whether the
  // user has touched each field so we don't keep overwriting their edits
  // when prefs change later (or hydrate after the modal opened).
  const cwdTouchedRef = useRef(false);
  const initialCommandTouchedRef = useRef(false);

  useEffect(() => {
    if (!newSessionModalOpen) return;
    if (defaultFolder && !cwdTouchedRef.current && !cwd) {
      setCwd(defaultFolder);
      // Also derive a reasonable name from the folder leaf
      if (!nameManuallyEdited) deriveNameFromCwd(defaultFolder);
    }
    if (defaultInitialCommand && !initialCommandTouchedRef.current && !initialCommand) {
      setInitialCommand(defaultInitialCommand);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps — seed when modal opens or defaults change
  }, [newSessionModalOpen, defaultFolder, defaultInitialCommand]);

  function resetForm() {
    setSessionMode('terminal');
    setName('');
    setNameManuallyEdited(false);
    setShell('');
    setCwd('');
    setInitialCommand('');
    setColor(SESSION_COLORS[0]);
    setBrowsing(false);
    setModel(savedCopilotModel());
    cwdTouchedRef.current = false;
    initialCommandTouchedRef.current = false;
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

      // Belt-and-suspenders: read both defaults DIRECTLY from the prefs
      // store so a stale React closure (or unhydrated value at mount)
      // can't swallow them. If the user didn't type anything in either
      // field, fall back to the saved default.
      const livePrefs = usePreferencesStore.getState().prefs;
      const liveDefaultCmd = (livePrefs.defaultInitialCommand || '').trim();
      const liveDefaultFolder = (livePrefs.defaultFolder || '').trim();
      const effectiveInitialCommand = initialCommand.trim() || liveDefaultCmd;
      const effectiveCwd = cwd.trim() || liveDefaultFolder;

      const session = await createSession(
        sessionMode === 'copilot'
          ? {
              name: name.trim() || undefined,
              cwd: effectiveCwd || undefined,
              type: 'copilot',
              model: model || undefined,
              ...(cols && rows ? { cols, rows } : {}),
            }
          : {
              name: name.trim() || undefined,
              shell: shell || undefined,
              cwd: effectiveCwd || undefined,
              color,
              initialCommand: effectiveInitialCommand || undefined,
              ...(cols && rows ? { cols, rows } : {}),
            },
      );
      if (effectiveInitialCommand) {
        useSessionStore.getState().setPendingInitialCommand(session.id, effectiveInitialCommand);
      }
      // Remember the pick (including "Copilot default") for the next session.
      if (sessionMode === 'copilot' && model !== livePrefs.copilotModel) {
        usePreferencesStore.getState().setPreference('copilotModel', model);
      }
      closeNewSessionModal();
      resetForm();
      onCreated(
        session.id,
        sessionMode,
        session.ptySessionId ?? null,
        sessionMode === 'copilot' ? session.model || model || undefined : undefined,
      );
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
      const agentCmd = agent.args?.length ? `${agent.cmd} ${agent.args.join(' ')}` : agent.cmd;
      useSessionStore.getState().setPendingInitialCommand(session.id, agentCmd);
      closeNewSessionModal();
      resetForm();
      onCreated(session.id, 'terminal');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to launch agent');
    } finally {
      setSubmitting(false);
    }
  }

  const close = () => {
    closeNewSessionModal();
    resetForm();
  };
  const modeIndex = sessionMode === 'terminal' ? 0 : 1;

  return (
    <Sheet
      open={newSessionModalOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={browsing ? 'Choose a folder' : 'New session'}
      testId="new-session-modal"
      onOpenAutoFocus={(e) => e.preventDefault()}
      bodyClassName={browsing ? styles.browserBody : undefined}
      headerExtra={
        !browsing && (
          <div
            className={form.segmented}
            role="group"
            aria-label="Session type"
            style={{ ['--segment-index' as string]: modeIndex, ['--segments' as string]: 2 }}
          >
            <span className={form.segmentThumb} aria-hidden="true" />
            <button
              type="button"
              className={form.segment}
              aria-pressed={sessionMode === 'terminal'}
              onClick={() => handleModeSwitch('terminal')}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 7 5 5-5 5M12.5 17H19" />
              </svg>
              Terminal
            </button>
            <button
              type="button"
              className={form.segment}
              aria-pressed={sessionMode === 'copilot'}
              onClick={() => handleModeSwitch('copilot')}
            >
              <CopilotLogo size={14} /> Copilot
            </button>
          </div>
        )
      }
      footer={
        !browsing && (
          <>
            <button
              type="button"
              className={`${form.btn} ${form.tonal} ${form.grow}`}
              data-testid="ns-cancel"
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="submit"
              form={`${ids}-form`}
              className={`${form.btn} ${form.primary} ${form.grow}`}
              disabled={submitting}
              data-testid="ns-create"
            >
              {submitting
                ? 'Creating…'
                : sessionMode === 'copilot'
                  ? 'Start Copilot session'
                  : 'Create session'}
            </button>
          </>
        )
      }
    >
      {browsing ? (
        <FolderBrowser
          currentDir={cwd || defaultFolder || '/'}
          onSelect={(dir: string) => {
            cwdTouchedRef.current = true;
            setCwd(dir);
            deriveNameFromCwd(dir);
            setBrowsing(false);
          }}
          onCancel={() => setBrowsing(false)}
        />
      ) : (
        <form
          id={`${ids}-form`}
          className={form.stack}
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitting) void handleSubmit();
          }}
        >
          <div className={form.field}>
            <label className={form.label} htmlFor={`${ids}-cwd`}>
              Folder
            </label>
            <div className={form.inputRow}>
              <textarea
                ref={cwdRef}
                id={`${ids}-cwd`}
                className={`${form.textarea} ${form.mono}`}
                rows={1}
                placeholder={defaultFolder || '/'}
                value={cwd}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => {
                  cwdTouchedRef.current = true;
                  setCwd(e.target.value.replace(/[\r\n]+/g, ''));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                type="button"
                className={`${form.btn} ${form.tonal} ${styles.browseBtn}`}
                onClick={() => setBrowsing(true)}
              >
                Browse
              </button>
            </div>
          </div>

          <div className={sessionMode === 'terminal' ? form.row : form.field}>
            <div className={form.field}>
              <label className={form.label} htmlFor={`${ids}-name`}>
                Name
              </label>
              <input
                id={`${ids}-name`}
                className={form.input}
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

            {sessionMode === 'terminal' && (
              <div className={form.field}>
                <label className={form.label} htmlFor={`${ids}-shell`}>
                  Shell
                </label>
                <select
                  id={`${ids}-shell`}
                  className={form.select}
                  value={shell}
                  onChange={(e) => setShell(e.target.value)}
                  data-testid="ns-shell"
                >
                  {shells.map((s) => (
                    <option key={s.path} value={s.cmd}>
                      {s.name} — {s.path}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {sessionMode === 'terminal' && (
            <>
              <div className={form.field}>
                <label className={form.label} htmlFor={`${ids}-cmd`}>
                  Run on start <span className={form.optional}>Optional</span>
                </label>
                <input
                  id={`${ids}-cmd`}
                  className={`${form.input} ${form.mono}`}
                  type="text"
                  placeholder={defaultInitialCommand || 'npm run dev'}
                  value={initialCommand}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={(e) => {
                    initialCommandTouchedRef.current = true;
                    setInitialCommand(e.target.value);
                  }}
                />
              </div>

              <div className={form.field} role="group" aria-labelledby={`${ids}-color`}>
                <span className={form.label} id={`${ids}-color`}>
                  Color
                </span>
                <div className={form.swatches}>
                  {SESSION_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={form.swatch}
                      style={{ ['--swatch' as string]: c }}
                      aria-pressed={c === color}
                      onClick={() => setColor(c)}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </div>

              {agents.length > 0 && (
                <div className={form.field} role="group" aria-labelledby={`${ids}-agents`}>
                  <span className={form.label} id={`${ids}-agents`}>
                    Or start an agent
                  </span>
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
                          <AgentIcon agent={agent.icon || agent.id} size="md" />
                        </span>
                        <span className={styles.agentText}>
                          <span className={styles.agentName}>{agent.name}</span>
                          {agent.version && (
                            <span className={styles.agentVersion}>{agent.version}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {sessionMode === 'copilot' && (
            <div className={form.field}>
              <label className={form.label} htmlFor={`${ids}-model`}>
                Model
              </label>
              <ModelSelect
                id={`${ids}-model`}
                className={form.select}
                value={model}
                onChange={setModel}
                defaultLabel="Copilot default"
                aria-describedby={
                  modelsStatus === 'loading' || modelsStatus === 'error'
                    ? `${ids}-model-hint`
                    : undefined
                }
                data-testid="ns-model"
              />
              {modelsStatus === 'loading' && (
                <p id={`${ids}-model-hint`} className={form.hint}>
                  Loading models from Copilot…
                </p>
              )}
              {modelsStatus === 'error' && (
                <p id={`${ids}-model-hint`} className={form.hint}>
                  Couldn’t load the model list. Copilot will use its default model.
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            className={`${form.btn} ${form.quiet} ${styles.resumeLink}`}
            onClick={() => {
              closeNewSessionModal();
              useUIStore.getState().openResumeBrowser();
            }}
          >
            Resume an earlier agent session
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      )}
    </Sheet>
  );
}
