import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Pinch-to-zoom hook that applies CSS transform: scale() on a target element.
 * Works inside containers with touch-action: none by handling touch events directly.
 */
export function useContentPinchZoom(
  containerRef: React.RefObject<HTMLDivElement | null>,
  targetRef: React.RefObject<HTMLDivElement | null>,
) {
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const startDistRef = useRef(0);
  const startScaleRef = useRef(1);

  const resetZoom = useCallback(() => {
    scaleRef.current = 1;
    setScale(1);
    if (targetRef.current) {
      targetRef.current.style.transform = '';
      targetRef.current.style.transformOrigin = '';
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
        startDistRef.current = getDistance(t0, t1);
        startScaleRef.current = scaleRef.current;
      }
    }

    function onTouchMove(e: TouchEvent) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      if (e.touches.length === 2 && t0 && t1 && container) {
        e.preventDefault();
        const dist = getDistance(t0, t1);
        const newScale = Math.min(
          5,
          Math.max(0.5, startScaleRef.current * (dist / startDistRef.current)),
        );
        scaleRef.current = newScale;
        setScale(newScale);

        const target = targetRef.current;
        if (target) {
          const rect = container.getBoundingClientRect();
          const midX = (t0.clientX + t1.clientX) / 2 - rect.left + container.scrollLeft;
          const midY = (t0.clientY + t1.clientY) / 2 - rect.top + container.scrollTop;
          target.style.transformOrigin = `${midX}px ${midY}px`;
          target.style.transform = `scale(${newScale})`;
        }
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2 && startDistRef.current > 0) {
        startDistRef.current = 0;
        // Snap back to 1x if close
        if (Math.abs(scaleRef.current - 1) < 0.1) {
          scaleRef.current = 1;
          setScale(1);
          const target = targetRef.current;
          if (target) {
            target.style.transform = '';
            target.style.transformOrigin = '';
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
