import styles from './Wordmark.module.css';
import { WORDMARK_PATHS, WORDMARK_VIEW_BOX } from './wordmarkPaths';

export type WordmarkSize = 'sm' | 'md' | 'lg';

interface WordmarkProps {
  /** Visual size — sets the rendered SVG width; height auto-scales. */
  size?: WordmarkSize;
  /**
   * Play the per-letter stroke-draw → fill entrance on mount. Default
   * `true`. Pass `false` for persistent surfaces like the SessionsHub
   * header, where the wordmark should appear settled and not redraw on
   * every visit.
   */
  animated?: boolean;
  /** Optional class merged onto the root element. */
  className?: string;
}

/** Index at which the accent-coloured letters start. "Term" = 0..3, "Beam" = 4..7. */
const ACCENT_INDEX = 4;

/**
 * The TermBeam wordmark — `Term` + accent `Beam` rendered as eight
 * individual SVG `<path>` glyphs extracted from Montserrat ExtraBold.
 *
 * Why paths instead of `<text>` + stroke-dasharray? Because most
 * Montserrat 800 glyphs (B, e, a, m) have multiple subpaths (the outer
 * outline plus inner counter holes); stroking `<text>` draws ALL
 * subpaths simultaneously and produces visible counter-outline artifacts
 * mid-draw. Pre-baked single-path glyphs let us animate stroke-dashoffset
 * cleanly with no inner artifacts.
 *
 * On mount each letter:
 *   1. draws its stroke over 0.6s (`pathLength="100"` normalises across
 *      letters of different perimeters)
 *   2. fills in over 0.25s starting right when the stroke completes
 *
 * Per-letter delays are jittered (non-monotonic) so the reveal flutters
 * organically rather than sweeping left-to-right. Total timeline ≈ 1.4s.
 *
 * `animated={false}` skips the choreography and renders the settled
 * filled state — used by persistent surfaces like the hub header.
 */
export function Wordmark({ size = 'lg', animated = true, className }: WordmarkProps) {
  const rootClass = [
    styles.root,
    styles[size],
    animated ? styles.animated : styles.static,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={rootClass} aria-label="TermBeam" role="img">
      <svg
        className={styles.svg}
        viewBox={WORDMARK_VIEW_BOX}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        {WORDMARK_PATHS.map((p, i) => (
          <path
            key={i}
            d={p.d}
            pathLength={100}
            className={`${styles.letter} ${i >= ACCENT_INDEX ? styles.accent : ''}`}
          />
        ))}
      </svg>
    </span>
  );
}

export default Wordmark;
