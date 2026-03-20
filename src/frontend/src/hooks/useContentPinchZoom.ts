import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Pinch-to-zoom using CSS `zoom` property.
 * Unlike transform: scale(), CSS zoom reflowed content so scrolling works naturally.
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

  const resetZoom = useCallback(() => {
    scaleRef.current = 1;
    setScale(1);
    const target = targetRef.current;
    if (target) {
      target.style.zoom = '';
    }
  }, [targetRef]);

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
        const raw = startScaleRef.current * (dist / startDistRef.current);
        const newScale = Math.min(5, Math.max(0.5, raw));
        scaleRef.current = newScale;
        setScale(newScale);
        const target = targetRef.current;
        if (target) {
          target.style.zoom = `${newScale}`;
        }
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2 && isPinchingRef.current) {
        isPinchingRef.current = false;
        startDistRef.current = 0;
        // Snap to 1x if close
        if (Math.abs(scaleRef.current - 1) < 0.08) {
          scaleRef.current = 1;
          setScale(1);
          const target = targetRef.current;
          if (target) {
            target.style.zoom = '';
          }
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
  }, [containerRef, targetRef]);

  return { scale, resetZoom };
}
