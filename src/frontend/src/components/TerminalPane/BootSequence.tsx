import { useEffect, useRef, useState } from 'react';
import styles from './BootSequence.module.css';

/**
 * Minimal terminal-native loader shown briefly while a brand-new PTY
 * is spawning and we haven't yet seen the first byte from the shell.
 *
 *     ⠋ spawning shell
 *
 * Design choices:
 *  - **Classic Braille dots spinner.** The same loading idiom used by
 *    `npm`, `cargo`, `yarn`, `gh`, etc. — instantly recognizable as
 *    "loading" and unambiguously communicates progress. Replaces an
 *    earlier approach (typed boot log) that scrolled too fast to read,
 *    and a second iteration (slow ambient pulse) that was readable
 *    but not obviously a loading indicator.
 *  - **Show delay (150 ms)** gates fast-localhost flicker — if the
 *    first byte arrives before then, the overlay never mounts.
 *  - **Slow, graceful fade-out (420 ms)** with upward drift + blur on
 *    first byte so the loader appears to lift away before the shell
 *    takes over.
 *  - **Accessibility**: the visible text is a single stable
 *    `role="status"` announcement. Spinner glyph is `aria-hidden`.
 *  - **Reduced motion**: spinner uses a static glyph, no fade
 *    transforms, instant unmount.
 */

const SHOW_DELAY_MS = 150;
const FADE_OUT_MS = 420;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface BootSequenceProps {
  /** True once the first byte has arrived from the shell. Triggers
   * the fade-out animation; once complete the component unmounts. */
  complete: boolean;
}

export function BootSequence({ complete }: BootSequenceProps) {
  const [mounted, setMounted] = useState(false);
  const [fading, setFading] = useState(false);
  const [unmounted, setUnmounted] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const reduced = useRef(prefersReducedMotion());

  // Show delay: gate mount behind a 150ms timer so fast localhost
  // boots never see this overlay at all.
  useEffect(() => {
    if (complete) return;
    const t = setTimeout(() => setMounted(true), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [complete]);

  // Spinner animation — cycle through Braille frames while mounted
  // and not yet fading. Reduced motion: pin to first frame.
  useEffect(() => {
    if (!mounted || fading || reduced.current) return;
    const t = setInterval(() => {
      setFrameIdx((i) => (i + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(t);
  }, [mounted, fading]);

  // When the real first byte arrives, gracefully fade out.
  useEffect(() => {
    if (!complete || !mounted) return;
    setFading(true);
  }, [complete, mounted]);

  // Unmount after the fade animation finishes.
  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(() => setUnmounted(true), reduced.current ? 0 : FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [fading]);

  if (!mounted || unmounted) return null;

  const frame = SPINNER_FRAMES[frameIdx] ?? SPINNER_FRAMES[0]!;

  return (
    <div
      className={styles.overlay}
      data-testid="warmup-overlay"
      data-fading={fading || undefined}
    >
      <div className={styles.label} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true">
          {frame}
        </span>
        <span>spawning shell</span>
      </div>
    </div>
  );
}
