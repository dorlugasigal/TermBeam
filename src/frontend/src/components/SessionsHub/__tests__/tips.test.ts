import { describe, it, expect } from 'vitest';
import { HUB_TIPS, pickRandomTip } from '../tips';

describe('HUB_TIPS', () => {
  it('has at least 8 curated tips', () => {
    expect(HUB_TIPS.length).toBeGreaterThanOrEqual(8);
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
