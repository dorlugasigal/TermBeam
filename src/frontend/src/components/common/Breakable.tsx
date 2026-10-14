import { Fragment } from 'react';
import { breakSegments } from '@/utils/sessionDisplay';

/**
 * Machine text with soft breaks after path separators — wraps, never truncates.
 * One inline span, so inside a flex container the segments and their <wbr>
 * breaks stay a single text run instead of becoming separate flex items.
 */
export function Breakable({ text, className }: { text: string; className?: string }) {
  const parts = breakSegments(text);
  return (
    <span className={className}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </span>
  );
}
