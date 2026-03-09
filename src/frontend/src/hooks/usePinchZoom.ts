import { useState, useRef, useCallback, useEffect } from 'react';
import { usePinch } from '@use-gesture/react';

export interface UsePinchZoomOptions {
  ref: React.RefObject<HTMLElement | null>;
  onFontSizeChange: (size: number) => void;
  initialSize?: number;
  min?: number;
  max?: number;
}

const STORAGE_KEY = 'termbeam-font-size';
const DEBOUNCE_MS = 50;

function loadSavedSize(fallback: number): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = Number(saved);
      if (!Number.isNaN(parsed) && parsed >= 2 && parsed <= 32) return parsed;
    }
  } catch {
    // ignore
  }
  return fallback;
}

export function usePinchZoom(options: UsePinchZoomOptions): { fontSize: number } {
  const { ref, onFontSizeChange, initialSize = 14, min = 2, max = 32 } = options;
  const [fontSize, setFontSize] = useState(() => loadSavedSize(initialSize));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseSizeRef = useRef(fontSize);

  const debouncedCallback = useCallback(
    (size: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFontSizeChange(size);
      }, DEBOUNCE_MS);
    },
    [onFontSizeChange],
  );

  usePinch(
    ({ offset: [scale], first }) => {
      if (first) {
        baseSizeRef.current = fontSize;
      }
      const newSize = Math.round(Math.min(max, Math.max(min, baseSizeRef.current * scale)));
      setFontSize(newSize);
      localStorage.setItem(STORAGE_KEY, String(newSize));
      debouncedCallback(newSize);
    },
    {
      target: ref,
      scaleBounds: { min: min / initialSize, max: max / initialSize },
      eventOptions: { passive: false },
    },
  );

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { fontSize };
}
