import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { describeLink } from './copy';
import styles from './ConnectionStatus.module.css';

const RESTORED_BEAT_MS = 1600;
const MORPH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Re-render every second while a countdown is visible. */
export function useSecondsLeft(target: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return null;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/** True for RESTORED_BEAT_MS after each restore. */
export function useRestoredBeat(): boolean {
  const restoredAt = useConnectionStore((s) => s.restoredAt);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!restoredAt) return;
    const left = RESTORED_BEAT_MS - (Date.now() - restoredAt);
    if (left <= 0) return;
    setActive(true);
    const id = setTimeout(() => setActive(false), left);
    return () => clearTimeout(id);
  }, [restoredAt]);
  return active;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

const LockGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="currentColor" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="2.4" />
  </svg>
);

interface ConnectionPillProps {
  /** Indicator only (the label stays available to assistive tech). */
  compact?: boolean;
  className?: string;
}

/**
 * Link status, calm by default: a dot and the round-trip time while all is
 * well; a tinted capsule with words only when something needs attention. The
 * capsule's width springs between labels and a ring pings once on restore.
 * Tapping opens the ConnectionSheet.
 */
export function ConnectionPill({ compact = false, className }: ConnectionPillProps) {
  const kind = useConnectionStore((s) => s.kind);
  const rttMs = useConnectionStore((s) => s.rttMs);
  const attempt = useConnectionStore((s) => s.attempt);
  const nextRetryAt = useConnectionStore((s) => s.nextRetryAt);
  const restoredAt = useConnectionStore((s) => s.restoredAt);
  const phase = useConnectionStore((s) => s.updatingPhase);
  const openSheet = useConnectionStore((s) => s.openSheet);
  const secondsLeft = useSecondsLeft(nextRetryAt);
  const restored = useRestoredBeat();

  const copy = describeLink(kind, { rttMs, attempt, secondsLeft, phase });
  const showRestored = restored && kind === 'online';
  const label = showRestored ? 'Restored' : copy.pill;
  const tone = showRestored ? 'restored' : copy.tone;

  // Spring the label track's width between states instead of snapping.
  const trackRef = useRef<HTMLSpanElement>(null);
  const lastWidth = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) {
      lastWidth.current = null;
      return;
    }
    const next = el.scrollWidth;
    const prev = lastWidth.current;
    lastWidth.current = next;
    if (prev === null || Math.abs(prev - next) < 1 || prefersReducedMotion()) return;
    el.animate([{ width: `${prev}px` }, { width: `${next}px` }], {
      duration: 360,
      easing: MORPH_EASING,
    });
  }, [label, compact]);

  // Announce state changes politely — not every countdown tick.
  const [announcement, setAnnouncement] = useState('');
  const lastKind = useRef(kind);
  useEffect(() => {
    if (lastKind.current === kind) return;
    lastKind.current = kind;
    setAnnouncement(kind === 'online' ? 'Connection restored' : copy.title);
  }, [kind, copy.title]);

  return (
    <>
      <button
        type="button"
        className={`${styles.pill} ${compact ? styles.compact : ''} ${className ?? ''}`}
        data-kind={kind}
        data-tone={tone}
        data-testid="connection-pill"
        onClick={openSheet}
        aria-label={`Connection: ${copy.title}${kind === 'online' && rttMs !== null ? `, ${rttMs} milliseconds` : ''}. Show details`}
        title={copy.title}
      >
        <span className={styles.indicator} aria-hidden="true">
          {tone === 'lock' ? <LockGlyph /> : <i className={styles.dot} />}
          {showRestored && <i key={restoredAt ?? 0} className={styles.ping} />}
        </span>
        {!compact && (
          <span ref={trackRef} className={styles.track}>
            <span key={`${kind}-${showRestored}`} className={styles.label}>
              {label}
            </span>
          </span>
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

/**
 * A 1px line pinned to the bottom edge of its (positioned) parent that plays
 * the beam sweep once per restore. Drop it inside top bars.
 */
export function BeamLine() {
  const restoredAt = useConnectionStore((s) => s.restoredAt);
  const restored = useRestoredBeat();
  return (
    <span
      key={restoredAt ?? 0}
      className={`${styles.beam} ${restored ? styles.beamOn : ''}`}
      aria-hidden="true"
    />
  );
}

export default ConnectionPill;
