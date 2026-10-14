// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  contrastRatio,
  parseColor,
  pickOnAccent,
  relativeLuminance,
  applyThemeContrast,
} from '../themeContrast';

describe('themeContrast', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-tone');
    document.documentElement.style.removeProperty('--on-accent');
  });

  it('parses hex and rgb colors', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor(' #0078d4 ')).toEqual([0, 120, 212]);
    expect(parseColor('#11223344')).toEqual([17, 34, 51]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('rgba(10 20 30 / 0.5)')).toEqual([10, 20, 30]);
    expect(parseColor('oklch(0.5 0.1 200)')).toBeNull();
  });

  it('computes WCAG luminance and contrast', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it('picks readable ink for every kind of accent', () => {
    expect(pickOnAccent([0, 120, 212])).toBe('#ffffff'); // VS Code blue
    expect(pickOnAccent([0, 255, 65])).toBe('#0c0c0e'); // matrix green
    expect(pickOnAccent([255, 176, 0])).toBe('#0c0c0e'); // retro amber
    expect(pickOnAccent([166, 226, 46])).toBe('#0c0c0e'); // monokai lime
    for (const accent of [
      [0, 120, 212],
      [0, 255, 65],
      [255, 42, 109],
      [137, 180, 250],
    ] as [number, number, number][]) {
      const ink = parseColor(pickOnAccent(accent))!;
      expect(contrastRatio(accent, ink)).toBeGreaterThanOrEqual(3);
    }
  });

  it('sets data-tone and --on-accent from computed theme colors', () => {
    const root = document.documentElement;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => (name === '--bg' ? '#fdf6e3' : '#00ff41'),
    } as unknown as CSSStyleDeclaration);
    applyThemeContrast(root);
    expect(root.dataset.tone).toBe('light');
    expect(root.style.getPropertyValue('--on-accent')).toBe('#0c0c0e');
  });
});
