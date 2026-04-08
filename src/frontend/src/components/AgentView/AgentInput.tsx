import { useState, useRef, useCallback } from 'react';
import styles from './AgentView.module.css';

interface AgentInputProps {
  onSend: (text: string) => void;
  onCancel: () => void;
  disabled: boolean;
  isThinking?: boolean;
}

export function AgentInput({ onSend, onCancel, disabled, isThinking }: AgentInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resetHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      resetHeight();
    },
    [resetHeight],
  );

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    // Reset textarea height after clearing
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
      }
    });
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div className={styles.inputArea}>
      <div className={styles.inputAreaInner}>
        <div className={styles.inputContainer}>
          <textarea
            ref={textareaRef}
            className={styles.inputTextarea}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={isThinking ? 'Agent is working…' : disabled ? 'Copilot is loading…' : 'Send a message...'}
            disabled={disabled}
            rows={1}
            style={{ opacity: disabled ? 0.5 : 1 }}
          />
          {isThinking ? (
            <button
              className={styles.stopButton}
              onClick={onCancel}
              aria-label="Stop agent"
              title="Stop agent (Ctrl+C)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className={styles.sendButton}
              onClick={send}
              disabled={!text.trim()}
              aria-label="Send message"
            >
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
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
