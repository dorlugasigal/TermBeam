// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '../api';

vi.mock('../api', () => ({ getConfig: vi.fn() }));

describe('loadTerminalFont', () => {
  const addFont = vi.fn();
  let failFamilies: string[];
  let faces: { family: string; source: string }[];

  beforeEach(() => {
    vi.resetModules();
    vi.mocked(getConfig).mockReset();
    vi.mocked(getConfig).mockResolvedValue({ passwordRequired: false });
    addFont.mockReset();
    failFamilies = [];
    faces = [];
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: addFont } });
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(
          public family: string,
          public source: string,
        ) {
          faces.push(this);
        }
        async load() {
          if (failFamilies.includes(this.family)) throw new Error('Font failed');
          return this;
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the bundled font when no custom font is configured', async () => {
    const { loadTerminalFont, DEFAULT_FONT_FAMILY } = await import('../terminalFont');
    expect(await loadTerminalFont()).toBe(DEFAULT_FONT_FAMILY);
    expect(faces.map((face) => face.family)).toEqual(['NerdFont']);
    expect(addFont).toHaveBeenCalledTimes(1);
  });

  it('loads the same-origin custom font ahead of the bundled glyph fallback', async () => {
    vi.mocked(getConfig).mockResolvedValue({
      passwordRequired: false,
      terminalFontUrl: '/api/terminal-font/hash.woff2',
    });
    const { loadTerminalFont } = await import('../terminalFont');
    expect(await loadTerminalFont()).toMatch(/^'TermBeamCustomFont', 'NerdFont'/);
    expect(faces.find((face) => face.family === 'TermBeamCustomFont')?.source).toBe(
      'url(/api/terminal-font/hash.woff2)',
    );
    expect(addFont).toHaveBeenCalledTimes(2);
  });

  it('keeps the bundled font if the custom font fails to load', async () => {
    vi.mocked(getConfig).mockResolvedValue({
      passwordRequired: false,
      terminalFontUrl: '/api/terminal-font/hash.woff2',
    });
    failFamilies = ['TermBeamCustomFont'];
    const { loadTerminalFont, DEFAULT_FONT_FAMILY } = await import('../terminalFont');
    expect(await loadTerminalFont()).toBe(DEFAULT_FONT_FAMILY);
    expect(addFont).toHaveBeenCalledTimes(1);
    expect(addFont.mock.calls[0]![0].family).toBe('NerdFont');
  });

  it('still uses the custom font if the bundled fallback fails to load', async () => {
    vi.mocked(getConfig).mockResolvedValue({
      passwordRequired: false,
      terminalFontUrl: '/api/terminal-font/hash.woff2',
    });
    failFamilies = ['NerdFont'];
    const { loadTerminalFont } = await import('../terminalFont');
    expect(await loadTerminalFont()).toMatch(/^'TermBeamCustomFont'/);
  });

  it('shares a single configuration request and font load across terminal panes', async () => {
    const { loadTerminalFont } = await import('../terminalFont');
    const first = loadTerminalFont();
    expect(loadTerminalFont()).toBe(first);
    await first;
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(addFont).toHaveBeenCalledTimes(1);
  });
});
