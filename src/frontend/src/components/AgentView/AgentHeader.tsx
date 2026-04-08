import { CopilotLogo } from '@/components/common/CopilotLogo';
import styles from './AgentHeader.module.css';

interface AgentHeaderProps {
  agentName: string | null;
  sessionId: string | null;
  status: 'idle' | 'thinking' | 'working' | 'done' | 'error' | 'disconnected';
  isRawTerminal: boolean;
  onToggleRawTerminal: () => void;
  onBack: () => void;
  copilotSessionId?: string | null;
  sessionInfo?: {
    cwd?: string;
    gitBranch?: string;
    shell?: string;
  };
}

const STATUS_CLASS: Record<AgentHeaderProps['status'], string | undefined> = {
  idle: styles.statusIdle,
  thinking: styles.statusThinking,
  working: styles.statusWorking,
  done: styles.statusDone,
  error: styles.statusError,
  disconnected: styles.statusDisconnected,
};

export function AgentHeader({
  agentName,
  sessionId: _sessionId,
  status,
  isRawTerminal,
  onToggleRawTerminal,
  onBack,
  copilotSessionId,
}: AgentHeaderProps) {
  const chatLabel = copilotSessionId ? 'Show chat' : 'No active session';

  return (
    <header className={styles.header} data-testid="agent-header">
      <div className={styles.left}>
        <button className={styles.btn} onClick={onBack} aria-label="Back to sessions" title="Back">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <div className={styles.center}>
        <span style={{ flexShrink: 0, opacity: 0.7 }}>
          <CopilotLogo size={14} />
        </span>
        <span className={styles.agentName} data-testid="agent-name">
          {agentName || 'GitHub Copilot'}
        </span>
        <span
          className={`${styles.statusDot} ${STATUS_CLASS[status]}`}
          title={status}
          data-testid="agent-status-dot"
        />
      </div>

      <div className={styles.right}>
        <button
          className={`${styles.btn} ${isRawTerminal ? styles.btnActive : ''}`}
          onClick={onToggleRawTerminal}
          aria-label={isRawTerminal ? chatLabel : 'Show terminal'}
          title={isRawTerminal ? chatLabel : 'Show terminal'}
          data-testid="raw-terminal-toggle"
        >
          {isRawTerminal ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25Z" />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
