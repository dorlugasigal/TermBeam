import { describe, it, expect } from 'vitest';
import { HUB_TIPS, pickRandomTip, pickRandomTipIndex, getTipAt } from '../tips';

describe('HUB_TIPS', () => {
  it('has at least 35 curated tips', () => {
    expect(HUB_TIPS.length).toBeGreaterThanOrEqual(35);
  });

  it('every tip has icon, title, and body', () => {
    for (const tip of HUB_TIPS) {
      expect(tip.icon).toBeTruthy();
      expect(tip.title).toBeTruthy();
      expect(tip.body).toBeTruthy();
      expect(tip.body.length).toBeLessThanOrEqual(200);
    }
  });

  it('tips have unique titles (no duplicates)', () => {
    const titles = HUB_TIPS.map((t) => t.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  // The hub renders most often on a phone, so tips that hinge on a
  // hardware keyboard would be misleading. Catches regressions where
  // someone adds a desktop-only shortcut tip.
  it('no tip references a desktop-only keyboard shortcut', () => {
    const forbidden = [
      /\bcmd\s*[+/]/i,
      /\bctrl\s*\+/i,
      /\bcmd\/ctrl\b/i,
      /\bbluetooth keyboard\b/i,
      /\bhardware keyboard\b/i,
    ];
    for (const tip of HUB_TIPS) {
      const haystack = `${tip.title} ${tip.body}`;
      for (const pattern of forbidden) {
        expect(haystack, `tip "${tip.title}" must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

describe('pickRandomTip', () => {
  it('returns a deterministic tip when given a seed', () => {
    expect(pickRandomTip(0)).toBe(HUB_TIPS[0]);
    // 0.9999 * length floors to length-1
    expect(pickRandomTip(0.9999)).toBe(HUB_TIPS[HUB_TIPS.length - 1]);
  });

  it('always returns a valid tip object', () => {
    for (let seed = 0; seed < 1; seed += 0.05) {
      const tip = pickRandomTip(seed);
      expect(HUB_TIPS).toContain(tip);
    }
  });

  it('without a seed returns one of the curated tips', () => {
    expect(HUB_TIPS).toContain(pickRandomTip());
  });
});

describe('pickRandomTipIndex', () => {
  it('returns a deterministic index when given a seed', () => {
    expect(pickRandomTipIndex(0)).toBe(0);
    expect(pickRandomTipIndex(0.9999)).toBe(HUB_TIPS.length - 1);
  });

  it('always returns an index inside HUB_TIPS bounds', () => {
    for (let seed = 0; seed < 1; seed += 0.05) {
      const i = pickRandomTipIndex(seed);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(HUB_TIPS.length);
    }
  });
});

describe('getTipAt', () => {
  it('returns the tip at the given index', () => {
    expect(getTipAt(0)).toBe(HUB_TIPS[0]);
    expect(getTipAt(2)).toBe(HUB_TIPS[2]);
    expect(getTipAt(HUB_TIPS.length - 1)).toBe(HUB_TIPS[HUB_TIPS.length - 1]);
  });

  it('wraps positive indexes past the end back to the start', () => {
    expect(getTipAt(HUB_TIPS.length)).toBe(HUB_TIPS[0]);
    expect(getTipAt(HUB_TIPS.length + 3)).toBe(HUB_TIPS[3]);
    expect(getTipAt(HUB_TIPS.length * 5 + 1)).toBe(HUB_TIPS[1]);
  });

  it('wraps negative indexes to the end of the list', () => {
    expect(getTipAt(-1)).toBe(HUB_TIPS[HUB_TIPS.length - 1]);
    expect(getTipAt(-HUB_TIPS.length)).toBe(HUB_TIPS[0]);
    expect(getTipAt(-(HUB_TIPS.length + 1))).toBe(HUB_TIPS[HUB_TIPS.length - 1]);
  });
});
