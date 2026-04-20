import { describe, it, expect } from 'vitest';
import { sanitizeTerminalInput, wrapBracketedPaste } from '../sanitizeTerminalInput';

describe('sanitizeTerminalInput', () => {
  it('returns empty for empty/null input', () => {
    expect(sanitizeTerminalInput('')).toBe('');
  });

  it('passes plain text through', () => {
    expect(sanitizeTerminalInput('hello world')).toBe('hello world');
  });

  it('preserves newlines and tabs', () => {
    expect(sanitizeTerminalInput('a\nb\tc')).toBe('a\nb\tc');
  });

  it('strips CSI color sequences', () => {
    expect(sanitizeTerminalInput('\x1b[31mred\x1b[0m text')).toBe('red text');
  });

  it('strips OSC sequences (BEL-terminated)', () => {
    expect(sanitizeTerminalInput('\x1b]0;title\x07after')).toBe('after');
  });

  it('strips OSC sequences (ST-terminated)', () => {
    expect(sanitizeTerminalInput('\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\')).toBe('link');
  });

  it('strips raw control chars (SIGINT, EOF, etc)', () => {
    expect(sanitizeTerminalInput('safe\x03danger\x04more')).toBe('safedangermore');
  });

  it('strips other ESC sequences', () => {
    expect(sanitizeTerminalInput('a\x1bZb')).toBe('ab');
  });
});

describe('wrapBracketedPaste', () => {
  it('wraps text in paste markers', () => {
    expect(wrapBracketedPaste('hi')).toBe('\x1b[200~hi\x1b[201~');
  });

  it('wraps empty string', () => {
    expect(wrapBracketedPaste('')).toBe('\x1b[200~\x1b[201~');
  });
});
