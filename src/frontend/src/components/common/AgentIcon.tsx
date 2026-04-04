import styles from './AgentIcon.module.css';

const AGENT_COLORS: Record<string, string> = {
  copilot: '#6cc644',
  claude: '#cc785c',
  aider: '#4a9eff',
  codex: '#888',
};

interface AgentIconProps {
  agent: string;
  size?: 'sm' | 'md';
}

export function AgentIcon({ agent, size = 'sm' }: AgentIconProps) {
  const color = AGENT_COLORS[agent] || 'var(--text-muted)';
  return (
    <span className={`${styles.badge} ${styles[size]}`}>
      <span className={styles.dot} style={{ background: color }} />
    </span>
  );
}
