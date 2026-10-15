import { describe, expect, it } from 'vitest';
import { getFileIconUrl } from '../fileIcons';

describe('getFileIconUrl', () => {
  const file = getFileIconUrl('notes', false, false);
  const folder = getFileIconUrl('notes', true, false);

  it('maps known names and extensions', () => {
    expect(getFileIconUrl('app.ts', false, false)).not.toBe(file);
    expect(getFileIconUrl('Dockerfile', false, false)).not.toBe(file);
  });

  it('falls back to the generic icons for Object.prototype keys', () => {
    for (const name of ['constructor', '__proto__', 'x.toString', 'hasOwnProperty']) {
      expect(getFileIconUrl(name, false, false)).toBe(file);
      expect(getFileIconUrl(name, true, false)).toBe(folder);
    }
  });
});
