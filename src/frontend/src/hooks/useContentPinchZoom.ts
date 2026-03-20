import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Pinch-to-zoom hook — true visual zoom (like a magnifying glass).
 * Scales the target element via CSS transform and wraps it in a scrollable
 * area so the user can pan around the zoomed content.
 */
export function useContentPinchZoom(
  containerRef: React.RefObject<HTMLDivElement | null>,
  targetRef: React.RefObject<HTMLDivElement | null>,
) {
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const startDistRef = useRef(0);
  const startScaleRef = useRef(1);
  const isPinchingRef = useRef(false);

  const applyScale = useCallback(
    (s: number) => {
      const target = targetRef.current;
      const container = containerRef.current;
      if (!target || !container) return;

      if (s <= 1) {
        target.style.transform = '';
        target.style.transformOrigin = '';
        container.style.overflow = '';
      } else {
        target.style.transformOrigin = '0 0';
        target.style.transform = `scale(${s})`;
        container.style.overflow = 'scroll';
      }
    },
    [targetRef, containerRef],
  );

  const resetZoom = useCallback(() => {
    scaleRef.current = 1;
    setScale(1);
    applyScale(1);
  }, [applyScale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function getDistance(t0: Touch, t1: Touch): number {
      const dx = t1.clientX - t0.clientX;
      const dy = t1.clientY - t0.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e: TouchEvent) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      if (e.touches.length === 2 && t0 && t1) {
        e.preventDefault();
        isPinchingRef.current = true;
        startDistRef.current = getDistance(t0, t1);
        startScaleRef.current = scaleRef.current;
      }
    }

    function onTouchMove(e: TouchEvent) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      if (e.touches.length === 2 && t0 && t1 && isPinchingRef.current) {
        e.preventDefault();
        const dist = getDistance(t0, t1);
        const newScale = Math.min(
          5,
          Math.max(1, startScaleRef.current * (dist / startDistRef.current)),
        );
        scaleRef.current = newScale;
        setScale(newScale);
        applyScale(newScale);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2 && isPinchingRef.current) {
        isPinchingRef.current = false;
        startDistRef.current = 0;
        if (scaleRef.current < 1.05) {
          scaleRef.current = 1;
          setScale(1);
          applyScale(1);
        }
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [containerRef, targetRef, applyScale]);

  return { scale, resetZoom };
}
