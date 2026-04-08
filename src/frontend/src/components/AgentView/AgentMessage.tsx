import type { Components } from 'react-markdown';
import type { ExtraProps } from 'react-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentMessage as AgentMessageType } from '@/stores/agentStore';
import { CopilotLogo } from '@/components/common/CopilotLogo';
import { AgentCodeBlock } from './AgentCodeBlock';
import { AgentToolCall } from './AgentToolCall';
import styles from './AgentView.module.css';

interface AgentMessageProps {
  message: AgentMessageType;
  onToggleToolCallCollapse?: (toolCallId: string) => void;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const markdownComponents: Components = {
  code({ className, children, ...props }: React.ComponentProps<'code'> & ExtraProps) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');

    if (match) {
      return <AgentCodeBlock code={codeString} language={match[1]} />;
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

export function AgentMessage({ message, onToggleToolCallCollapse }: AgentMessageProps) {
  const { role, content, timestamp, toolCalls, isStreaming } = message;

  if (role === 'system') {
    return (
      <div className={styles.systemMessage}>
        <div className={styles.systemContent}>{content}</div>
      </div>
    );
  }

  if (role === 'user') {
    return (
      <div className={styles.userMessage}>
        <div className={styles.userAvatar}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10.561 8.073a6 6 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6 6 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
          </svg>
        </div>
        <div className={styles.userContent}>
          <div className={styles.userBubble}>
            {content}
            {isStreaming && <span className={styles.streamingCursor}>▊</span>}
          </div>
          <div className={styles.messageMeta}>{formatTimestamp(timestamp)}</div>
        </div>
      </div>
    );
  }

  if (role === 'error') {
    return (
      <div className={styles.errorMessage}>
        <div className={styles.assistantAvatar}>⚠️</div>
        <div className={styles.assistantBody}>
          <div className={styles.errorContent}>{content}</div>
          <div className={styles.messageMeta}>{formatTimestamp(timestamp)}</div>
        </div>
      </div>
    );
  }

  // Assistant message — clean text, no bubble
  // Preserve single newlines for terminal output (markdown normally ignores them)
  const markdownContent = content.replace(/\n/g, '  \n');

  return (
    <div className={styles.assistantMessage}>
      <div className={styles.assistantAvatar}>
        <CopilotLogo size={14} />
      </div>
      <div className={styles.assistantBody}>
        <div className={styles.assistantContent}>
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {markdownContent}
          </Markdown>
          {isStreaming && <span className={styles.streamingCursor}>▊</span>}
        </div>

        {toolCalls?.map((tc) => (
          <AgentToolCall
            key={tc.id}
            toolCall={tc}
            onToggleCollapse={() => onToggleToolCallCollapse?.(tc.id)}
          />
        ))}

        <div className={styles.messageMeta}>{formatTimestamp(timestamp)}</div>
      </div>
    </div>
  );
}
