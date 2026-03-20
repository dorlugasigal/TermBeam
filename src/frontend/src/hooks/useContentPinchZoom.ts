import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Pinch-to-zoom hook that applies CSS transform: scale() on a target element.
 * Uses transform-origin: 0 0 so the scaled content always starts at the top-left
 * and the container's native scroll handles panning in all directions.
 */
export function useContentPinchZoom(
  containerRef: React.RefObject<HTMLDivElement | null>,
  targetRef: React.RefObject<HTMLDivElement | null>,
) {
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const startDistRef = useRef(0);
  const startScaleRef = useRef(1);

  const applyScale = useCallback(
    (newScale: number) => {
      const target = targetRef.current;
      if (!target) return;
      if (newScale <= 1) {
        target.style.transform = '';
        target.style.transformOrigin = '';
        target.style.width = '';
        target.style.minHeight = '';
      } else {
        target.style.transformOrigin = '0 0';
        target.style.transform = `scale(${newScale})`;
        // Expand the element's layout size so the container can scroll to see all content
        target.style.width = `${100 / newScale}%`;
        target.style.minHeight = `${newScale * 100}%`;
      }
    },
    [targetRef],
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
        startDistRef.current = getDistance(t0, t1);
        startScaleRef.current = scaleRef.current;
      }
    }

    function onTouchMove(e: TouchEvent) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      if (e.touches.length === 2 && t0 && t1) {
        e.preventDefault();
        const dist = getDistance(t0, t1);
        // Min 1x (no zoom out below 100%), max 5x
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
      if (e.touches.length < 2 && startDistRef.current > 0) {
        startDistRef.current = 0;
        // Snap back to 1x if close
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
