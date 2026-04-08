import { useState, useEffect } from 'react';
import { CopilotLogo } from '@/components/common/CopilotLogo';
import styles from './AgentThinking.module.css';

interface AgentThinkingProps {
  startTime: number | null;
  status: 'thinking' | 'working';
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function AgentThinking({ startTime, status }: AgentThinkingProps) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (startTime == null) {
      setElapsed('');
      return;
    }

    const tick = () => setElapsed(formatElapsed(Date.now() - startTime));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const label = status === 'thinking' ? 'Thinking…' : 'Working…';

  return (
    <div className={styles.container}>
      <span className={styles.avatar}>
        <CopilotLogo size={14} />
      </span>
      <div className={styles.content}>
        <span className={styles.dots}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </span>
        <span className={styles.label}>{label}</span>
        {elapsed && <span className={styles.elapsed}>{elapsed}</span>}
      </div>
    </div>
  );
}
