import { describe, it, expect } from 'vitest';
import type { TouchBarKey } from '@/stores/preferencesStore';
import { DEFAULT_TOUCHBAR_KEYS, sortKeysByCol } from '../defaultKeys';

describe('sortKeysByCol', () => {
  it('returns a new array (does not mutate input)', () => {
    const input: TouchBarKey[] = [
      { id: 'a', label: 'A', send: 'a', col: 3 },
      { id: 'b', label: 'B', send: 'b', col: 1 },
    ];
    const out = sortKeysByCol(input);
    expect(out).not.toBe(input);
    expect(input.map((k) => k.id)).toEqual(['a', 'b']);
  });

  it('sorts by ascending col', () => {
    const input: TouchBarKey[] = [
      { id: 'tab', label: 'Tab', send: '\t', col: 6 },
      { id: 'ctrl', label: 'Ctrl', send: '', col: 1 },
      { id: 'shift', label: 'Shift', send: '', col: 2 },
      { id: 'down', label: '↓', send: '\x1b[B', col: 3 },
    ];
    expect(sortKeysByCol(input).map((k) => k.id)).toEqual([
      'ctrl',
      'shift',
      'down',
      'tab',
    ]);
  });

  it('treats missing col as col 1', () => {
    const input: TouchBarKey[] = [
      { id: 'b', label: 'B', send: 'b', col: 5 },
      { id: 'a', label: 'A', send: 'a' },
      { id: 'c', label: 'C', send: 'c', col: 8 },
    ];
    expect(sortKeysByCol(input).map((k) => k.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps stable order for equal cols (assumes typed sort is stable)', () => {
    const input: TouchBarKey[] = [
      { id: 'x', label: 'X', send: '', col: 4 },
      { id: 'y', label: 'Y', send: '', col: 4 },
      { id: 'z', label: 'Z', send: '', col: 1 },
    ];
    expect(sortKeysByCol(input).map((k) => k.id)).toEqual(['z', 'x', 'y']);
  });

  it('regression: a swapped row layout still renders all keys L→R by col', () => {
    // Reproduces the bug from the user's screenshot: Tab (col 3) and
    // ↓ (col 6) were swapped via drag-and-drop. The persisted array
    // order doesn't change, only their row+col fields. Without sorting,
    // CSS Grid pushes col-3 ↓ onto a phantom row 2 where the bar's
    // JS-computed height clips it. With sorting, DOM order is L→R.
    const row2BeforeSwap = DEFAULT_TOUCHBAR_KEYS.filter((k) => k.row === 2);
    const swapped = row2BeforeSwap.map((k) => {
      if (k.id === 'tab') return { ...k, col: 6 };
      if (k.id === 'down') return { ...k, col: 3 };
      return k;
    });
    // Pre-sort: array order is Ctrl(1), Shift(2), Tab(6), ^C(4), ←(5),
    // ↓(3), →(7), Mic(8) — out of column order.
    const preSortCols = swapped.map((k) => k.col);
    expect(preSortCols).toEqual([1, 2, 6, 4, 5, 3, 7, 8]);
    // Post-sort: DOM order matches grid columns.
    const sorted = sortKeysByCol(swapped);
    expect(sorted.map((k) => k.col)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sorted.map((k) => k.id)).toEqual([
      'ctrl',
      'shift',
      'down',
      'ctrl-c',
      'left',
      'tab',
      'right',
      'mic',
    ]);
  });
});
