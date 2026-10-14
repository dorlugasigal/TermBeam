// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useVisualViewport } from '../useVisualViewport';

type Listener = () => void;

function fakeViewport(height: number, offsetTop = 0) {
  const listeners = new Set<Listener>();
  const vv = {
    height,
    offsetTop,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    fire() {
      for (const fn of listeners) fn();
    },
    listeners,
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  return vv;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const originalInnerHeight = window.innerHeight;

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
});

describe('useVisualViewport', () => {
  it('reports the area hidden below the visible viewport (the iOS keyboard)', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true });
    const vv = fakeViewport(852);
    const { result } = renderHook(() => useVisualViewport(true));
    expect(result.current).toEqual({ bottom: 0, height: 852 });

    // Keyboard opens: the visual viewport shrinks, the layout viewport doesn't
    vv.height = 516;
    await act(async () => {
      vv.fire();
      await nextFrame();
    });
    expect(result.current).toEqual({ bottom: 336, height: 516 });

    // iOS scrolled the layout viewport to reveal the focused input
    vv.offsetTop = 120;
    await act(async () => {
      vv.fire();
      await nextFrame();
    });
    expect(result.current).toEqual({ bottom: 216, height: 516 });
  });

  it('is inert while disabled and stops listening when turned off', () => {
    const vv = fakeViewport(700);
    const { result, rerender } = renderHook(({ on }) => useVisualViewport(on), {
      initialProps: { on: false },
    });
    expect(result.current).toBeNull();
    expect(vv.listeners.size).toBe(0);
    rerender({ on: true });
    expect(vv.listeners.size).toBe(1);
    rerender({ on: false });
    expect(result.current).toBeNull();
    expect(vv.listeners.size).toBe(0);
  });

  it('returns null where the Visual Viewport API is missing', () => {
    const { result } = renderHook(() => useVisualViewport(true));
    expect(result.current).toBeNull();
  });
});
