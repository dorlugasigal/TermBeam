import type { AgentMessage as AgentMessageType, AgentStatus } from '@/stores/agentStore';
import { useAgentStore } from '@/stores/agentStore';
import { AgentMessage } from './AgentMessage';
import { AgentThinking } from './AgentThinking';
import styles from './AgentView.module.css';

interface AgentChatPanelProps {
  messages: AgentMessageType[];
  status: AgentStatus;
  thinkingStartTime: number | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const isThinkingOrWorking = (s: AgentStatus): s is 'thinking' | 'working' =>
  s === 'thinking' || s === 'working';

export function AgentChatPanel({
  messages,
  status,
  thinkingStartTime,
  scrollRef,
}: AgentChatPanelProps) {
  const toggleToolCallCollapse = useAgentStore((s) => s.toggleToolCallCollapse);
  const isThinking = isThinkingOrWorking(status);

  if (messages.length === 0 && !isThinking) {
    return (
      <div className={styles.chatPanel}>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>💬</span>
          <span className={styles.emptyTitle}>Start a conversation with your agent</span>
          <span className={styles.emptyHint}>
            Type a message below to get started. The agent can edit files, run commands, and answer
            questions about your project.
          </span>
        </div>
        <div ref={scrollRef} className={styles.scrollAnchor} />
      </div>
    );
  }

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatPanelInner}>
        <div className={styles.messageList}>
          {messages.map((msg) => (
            <AgentMessage
              key={msg.id}
              message={msg}
              onToggleToolCallCollapse={(tcId) => toggleToolCallCollapse(msg.id, tcId)}
            />
          ))}
          {isThinkingOrWorking(status) && (
            <AgentThinking startTime={thinkingStartTime} status={status} />
          )}
        </div>
      </div>
      <div ref={scrollRef} className={styles.scrollAnchor} />
    </div>
  );
}
