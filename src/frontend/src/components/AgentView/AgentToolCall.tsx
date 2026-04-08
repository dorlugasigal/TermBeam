import type { ToolCallInfo } from '@/stores/agentStore';
import { AgentCodeBlock } from './AgentCodeBlock';
import styles from './AgentView.module.css';

interface AgentToolCallProps {
  toolCall: ToolCallInfo;
  onToggleCollapse: () => void;
}

function getToolIcon(type: ToolCallInfo['type']): string {
  switch (type) {
    case 'bash':
      return '💻';
    case 'file-edit':
      return '📝';
    case 'search':
      return '🔍';
    case 'read-file':
      return '📄';
    default:
      return '🔧';
  }
}

function getToolLanguage(type: ToolCallInfo['type']): string | undefined {
  switch (type) {
    case 'bash':
      return 'bash';
    case 'file-edit':
      return 'diff';
    default:
      return undefined;
  }
}

export function AgentToolCall({ toolCall, onToggleCollapse }: AgentToolCallProps) {
  const { type, label, content, collapsed } = toolCall;
  const expanded = !collapsed;

  return (
    <div className={styles.toolCallBlock}>
      <button className={styles.toolCallHeader} onClick={onToggleCollapse}>
        <svg
          className={`${styles.toolCallChevron} ${expanded ? styles.toolCallChevronExpanded : ''}`}
          viewBox="0 0 16 16"
          fill="currentColor"
          stroke="none"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className={styles.toolCallIcon}>{getToolIcon(type)}</span>
        <span className={styles.toolCallLabel}>{label}</span>
      </button>
      <div className={collapsed ? styles.toolCallCollapsed : styles.toolCallContent}>
        {content && <AgentCodeBlock code={content} language={getToolLanguage(type)} />}
      </div>
    </div>
  );
}
