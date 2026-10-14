import { useEffect, useState } from 'react';

export interface VisibleViewport {
  /** Layout-viewport pixels hidden below the visible area — the iOS keyboard. */
  bottom: number;
  /** Height of the visible area. */
  height: number;
}

/**
 * Tracks the visual viewport while `enabled`. iOS draws the software keyboard
 * over the page without shrinking the layout viewport (or `100dvh`), so a
 * fixed, bottom-anchored surface has to lift itself by `bottom` and fit in
 * `height` to keep its inputs and buttons reachable.
 */
export function useVisualViewport(enabled: boolean): VisibleViewport | null {
  const [viewport, setViewport] = useState<VisibleViewport | null>(null);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!enabled || !vv) {
      setViewport(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bottom = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const height = Math.round(vv.height);
      setViewport((prev) =>
        prev && prev.bottom === bottom && prev.height === height ? prev : { bottom, height },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
    };
  }, [enabled]);

  return viewport;
}
