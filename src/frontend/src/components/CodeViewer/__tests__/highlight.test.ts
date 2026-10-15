import { describe, expect, it } from 'vitest';
import hljs from 'highlight.js/lib/core';
import type { DiffHunk, DiffLine } from '@/services/api';
import { detectLanguage, escapeHtml, highlightDiff, splitHighlightedLines } from '../highlight';

describe('splitHighlightedLines', () => {
  it('returns one fragment per source line, including a trailing empty line', () => {
    expect(splitHighlightedLines('a\nb\n')).toEqual(['a', 'b', '']);
  });

  it('closes and reopens a span that crosses a line break', () => {
    expect(splitHighlightedLines('<span class="s">`a\nb`</span>;')).toEqual([
      '<span class="s">`a</span>',
      '<span class="s">b`</span>;',
    ]);
  });

  it('keeps nested spans balanced on every line', () => {
    expect(splitHighlightedLines('<span class="a">x<span class="b">y\nz</span>w</span>')).toEqual([
      '<span class="a">x<span class="b">y</span></span>',
      '<span class="a"><span class="b">z</span>w</span>',
    ]);
  });

  it('keeps every line of a multi-line template literal coloured as a string', () => {
    const source = 'console.log(`\nUsage: termbeam [options]\n`);';
    const html = hljs.highlight(source, { language: 'javascript' }).value;
    const lines = splitHighlightedLines(html);
    expect(lines).toHaveLength(source.split('\n').length);
    expect(lines[1]).toBe('<span class="hljs-string">Usage: termbeam [options]</span>');
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d');
  });
});

describe('highlightDiff', () => {
  const line = (type: DiffLine['type'], content: string) => ({
    type,
    content,
    oldLine: null,
    newLine: null,
  });

  it('maps each side of a hunk back onto its rows', () => {
    const hunk: DiffHunk = {
      header: '@@ -1,3 +1,3 @@',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      lines: [
        line('context', 'const a = 1;'),
        line('remove', "const b = 'old';"),
        line('add', '/* new'),
        line('add', '   value */ const b = 2;'),
      ],
    };
    const [rows] = highlightDiff([hunk], 'javascript')!;
    expect(rows).toHaveLength(4);
    expect(rows![1]).toContain('<span class="hljs-string">&#x27;old&#x27;</span>');
    // The comment opened on the first added line continues on the next one.
    expect(rows![3]).toMatch(/^<span class="hljs-comment">\s+value \*\/<\/span>/);
  });

  it('returns null for languages it cannot highlight', () => {
    expect(highlightDiff([], '')).toBeNull();
  });
});

describe('detectLanguage', () => {
  it('maps extensions and well-known file names', () => {
    expect(detectLanguage('src/payments/retry.ts')).toBe('typescript');
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('LICENSE')).toBe('');
  });

  it('looks only at the file name of a repo-relative path', () => {
    expect(detectLanguage('deploy/Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('build/Makefile')).toBe('bash');
    expect(detectLanguage('config/.env.production')).toBe('ini');
    expect(detectLanguage('docs/v1.2/NOTES')).toBe('');
    expect(detectLanguage('src\\win\\app.py')).toBe('python');
  });
});
