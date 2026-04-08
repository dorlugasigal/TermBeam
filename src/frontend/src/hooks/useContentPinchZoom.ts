import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * True visual pinch-to-zoom — scales content like a magnifying glass.
 * Uses transform: scale() with a locked layout width and a spacer div for scroll.
 * Optimised: DOM updates happen directly (no React re-render during gesture),
 * React state only updates on gesture end for the % indicator.
 */
export function useContentPinchZoom(
  containerRef: React.RefObject<HTMLDivElement | null>,
  targetRef: React.RefObject<HTMLDivElement | null>,
  spacerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const startDistRef = useRef(0);
  const startScaleRef = useRef(1);
  const isPinchingRef = useRef(false);
  const baseWidthRef = useRef(0);
  const baseHeightRef = useRef(0);
  const rafRef = useRef(0);

  const resetZoom = useCallback(() => {
    scaleRef.current = 1;
    baseWidthRef.current = 0;
    baseHeightRef.current = 0;
    setScale(1);
    const target = targetRef.current;
    const spacer = spacerRef.current;
    if (target) {
      target.style.transform = '';
      target.style.transformOrigin = '';
      target.style.width = '';
      target.style.position = '';
    }
    if (spacer) {
      spacer.style.width = '';
      spacer.style.height = '';
    }
  }, [targetRef, spacerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = container;

    function getDistance(t0: Touch, t1: Touch): number {
      const dx = t1.clientX - t0.clientX;
      const dy = t1.clientY - t0.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function lockBase() {
      const tgt = targetRef.current;
      if (!baseWidthRef.current && tgt) {
        baseWidthRef.current = tgt.offsetWidth;
        baseHeightRef.current = tgt.scrollHeight;
      }
    }

    function applyDirect(s: number) {
      const tgt = targetRef.current;
      const spacer = spacerRef.current;
      if (!tgt) return;
      if (s <= 1.02) {
        tgt.style.transform = '';
        tgt.style.transformOrigin = '';
        tgt.style.width = '';
        tgt.style.position = '';
        if (spacer) {
          spacer.style.width = '';
          spacer.style.height = '';
        }
      } else {
        tgt.style.width = `${baseWidthRef.current}px`;
        tgt.style.transformOrigin = '0 0';
        tgt.style.transform = `scale(${s})`;
        tgt.style.position = 'absolute';
        tgt.style.top = '0';
        tgt.style.left = '0';
        if (spacer) {
          spacer.style.width = `${baseWidthRef.current * s}px`;
          spacer.style.height = `${baseHeightRef.current * s}px`;
        }
      }
    }

    function onTouchStart(e: TouchEvent) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      if (e.touches.length === 2 && t0 && t1) {
        e.preventDefault();
        isPinchingRef.current = true;
        lockBase();
        startDistRef.current = getDistance(t0, t1);
        startScaleRef.current = scaleRef.current;
      }
    }

    function onTouchMove(e: TouchEvent) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      if (e.touches.length !== 2 || !t0 || !t1 || !isPinchingRef.current) return;
      e.preventDefault();

      const dist = getDistance(t0, t1);
      const oldScale = scaleRef.current;
      const newScale = Math.min(
        5,
        Math.max(1, startScaleRef.current * (dist / startDistRef.current)),
      );
      if (Math.abs(newScale - oldScale) < 0.005) return;

      // Pinch midpoint in container viewport coords
      const rect = el.getBoundingClientRect();
      const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
      const midY = (t0.clientY + t1.clientY) / 2 - rect.top;

      // Content point under the midpoint at old scale
      const cx = (el.scrollLeft + midX) / oldScale;
      const cy = (el.scrollTop + midY) / oldScale;

      scaleRef.current = newScale;

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        applyDirect(newScale);
        // Keep the same content point under the midpoint
        el.scrollLeft = cx * newScale - midX;
        el.scrollTop = cy * newScale - midY;
      });
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2 && isPinchingRef.current) {
        isPinchingRef.current = false;
        startDistRef.current = 0;
        cancelAnimationFrame(rafRef.current);
        if (scaleRef.current < 1.05) {
          scaleRef.current = 1;
          baseWidthRef.current = 0;
          baseHeightRef.current = 0;
          applyDirect(1);
        }
        setScale(scaleRef.current);
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);

    return () => {
      cancelAnimationFrame(rafRef.current);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [containerRef, targetRef, spacerRef]);

  return { scale, resetZoom };
}
