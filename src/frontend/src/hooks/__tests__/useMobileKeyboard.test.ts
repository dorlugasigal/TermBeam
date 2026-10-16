// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMobileKeyboard } from '../useMobileKeyboard';

const originalInnerHeight = window.innerHeight;

function setup() {
  const viewport = Object.assign(new EventTarget(), { height: 844, width: 390, offsetTop: 0 });
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  const input = document.createElement('textarea');
  document.body.append(input);
  input.focus();
  const hook = renderHook(() => useMobileKeyboard());
  return { viewport, input, ...hook };
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
});

describe('useMobileKeyboard', () => {
  it('lifts bottom-anchored controls when only the visual viewport shrinks', () => {
    const { viewport, result } = setup();
    act(() => {
      viewport.height = 504;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ keyboardOpen: true, keyboardHeight: 340 });

    act(() => {
      viewport.height = 844;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ keyboardOpen: false, keyboardHeight: 0 });
  });

  it('does not subtract the keyboard twice when Android also shrinks the layout viewport', () => {
    const { viewport, result } = setup();
    act(() => {
      Object.defineProperty(window, 'innerHeight', { value: 504, configurable: true });
      viewport.height = 504;
      viewport.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ keyboardOpen: true, keyboardHeight: 0 });
  });

  it('accounts for viewport panning to reveal the focused terminal textarea', () => {
    const { viewport, result } = setup();
    act(() => {
      viewport.height = 504;
      viewport.dispatchEvent(new Event('resize'));
    });
    act(() => {
      viewport.offsetTop = 120;
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toEqual({ keyboardOpen: true, keyboardHeight: 220 });
  });

  it('updates the inset if the layout resize arrives after the visual viewport resize', () => {
    const { viewport, result } = setup();
    act(() => {
      viewport.height = 504;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(result.current.keyboardHeight).toBe(340);
    act(() => {
      Object.defineProperty(window, 'innerHeight', { value: 504, configurable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ keyboardOpen: true, keyboardHeight: 0 });
  });

  it('never returns a negative inset during viewport transitions', () => {
    const { viewport, result } = setup();
    act(() => {
      Object.defineProperty(window, 'innerHeight', { value: 504, configurable: true });
      viewport.height = 504;
      viewport.offsetTop = 20;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ keyboardOpen: true, keyboardHeight: 0 });
  });

  it('ignores browser chrome changes smaller than a keyboard', () => {
    const { viewport, result } = setup();
    act(() => {
      viewport.height = 780;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ keyboardOpen: false, keyboardHeight: 0 });
  });

  it('requires an editable element to be focused', () => {
    const { viewport, input, result } = setup();
    act(() => {
      input.blur();
      viewport.height = 504;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ keyboardOpen: false, keyboardHeight: 0 });
  });

  it('works without the Visual Viewport API', () => {
    const { result } = renderHook(() => useMobileKeyboard());
    expect(result.current).toEqual({ keyboardOpen: false, keyboardHeight: 0 });
  });
});
