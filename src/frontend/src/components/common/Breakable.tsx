import { Fragment } from 'react';
import { breakSegments } from '@/utils/sessionDisplay';

/** Machine text with soft breaks after path separators — wraps, never truncates. */
export function Breakable({ text }: { text: string }) {
  const parts = breakSegments(text);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </>
  );
}
