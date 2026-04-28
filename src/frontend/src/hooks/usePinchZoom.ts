import { useState, useRef, useCallback, useEffect } from 'react';
import { usePinch } from '@use-gesture/react';
import { usePreferencesStore } from '@/stores/preferencesStore';

export interface UsePinchZoomOptions {
  ref: React.RefObject<HTMLElement | null>;
  onFontSizeChange: (size: number) => void;
  initialSize?: number;
  min?: number;
  max?: number;
}

const DEBOUNCE_MS = 50;

export function usePinchZoom(options: UsePinchZoomOptions): { fontSize: number } {
  const { ref, onFontSizeChange, initialSize = 14, min = 2, max = 32 } = options;
  const [fontSize, setFontSize] = useState(
    () => usePreferencesStore.getState().prefs.fontSize ?? initialSize,
  );
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
      // Route through the unified preferences store (debounced PUT to server +
      // localStorage cache write are handled inside the store).
      usePreferencesStore.getState().setPreference('fontSize', newSize);
      debouncedCallback(newSize);
    },
    {
      target: ref,
      scaleBounds: { min: min / initialSize, max: max / initialSize },
      eventOptions: { passive: false },
    },
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { fontSize };
}

