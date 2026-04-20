import { describe, it, expect } from 'vitest';
import {
  formatSingleComment,
  formatReviewBatch,
  type ReviewComment,
} from '../formatReviewComments';

function mk(partial: Partial<ReviewComment>): ReviewComment {
  return {
    id: 'c1',
    file: 'src/foo.ts',
    startLine: 10,
    endLine: 10,
    lineKind: 'add',
    selectedText: '+  const x = 1;',
    comment: 'this leaks',
    createdAt: 0,
    ...partial,
  };
}

describe('formatSingleComment', () => {
  it('formats a single-line add comment', () => {
    const out = formatSingleComment(mk({}));
    expect(out).toContain('[src/foo.ts:10] (new)');
    expect(out).toContain('> +  const x = 1;');
    expect(out).toContain('this leaks');
  });

  it('formats a multi-line range', () => {
    const out = formatSingleComment(
      mk({ startLine: 10, endLine: 12, selectedText: '+a\n+b\n+c' }),
    );
    expect(out).toContain('[src/foo.ts:10-12] (new)');
    expect(out).toContain('> +a\n> +b\n> +c');
  });

  it('translates remove → old, context → unchanged', () => {
    expect(formatSingleComment(mk({ lineKind: 'remove' }))).toContain('(old)');
    expect(formatSingleComment(mk({ lineKind: 'context' }))).toContain('(unchanged)');
  });

  it('strips ANSI from both quote and comment body', () => {
    const out = formatSingleComment(
      mk({ selectedText: '\x1b[31m+x\x1b[0m', comment: 'hi\x1b[1mbold' }),
    );
    expect(out).not.toMatch(/\x1b/);
    expect(out).toContain('> +x');
    expect(out).toContain('hibold');
  });

  it('truncates oversized comment body', () => {
    const big = 'x'.repeat(5000);
    const out = formatSingleComment(mk({ comment: big }));
    // Body portion should be capped at 4096 chars.
    expect(out.length).toBeLessThan(big.length + 200);
  });
});

describe('formatReviewBatch', () => {
  it('returns empty for empty input', () => {
    const r = formatReviewBatch([]);
    expect(r.text).toBe('');
    expect(r.includedCount).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it('groups by file and sorts within file by line', () => {
    const r = formatReviewBatch([
      mk({ id: 'a', file: 'src/b.ts', startLine: 5 }),
      mk({ id: 'b', file: 'src/a.ts', startLine: 20 }),
      mk({ id: 'c', file: 'src/a.ts', startLine: 3 }),
      mk({ id: 'd', file: 'src/b.ts', startLine: 1 }),
    ]);
    expect(r.includedCount).toBe(4);
    // First-seen file comes first (src/b.ts).
    const bFirst = r.text.indexOf('src/b.ts:1');
    const bSecond = r.text.indexOf('src/b.ts:5');
    const aFirst = r.text.indexOf('src/a.ts:3');
    const aSecond = r.text.indexOf('src/a.ts:20');
    // Within each file entries are sorted by line.
    expect(bFirst).toBeGreaterThan(-1);
    expect(bFirst).toBeLessThan(bSecond);
    expect(aFirst).toBeGreaterThan(-1);
    expect(aFirst).toBeLessThan(aSecond);
    // src/b.ts was inserted first, so its block appears first.
    expect(bSecond).toBeLessThan(aFirst);
  });

  it('includes the header by default', () => {
    const r = formatReviewBatch([mk({})]);
    expect(r.text.startsWith('Review comments on working changes:')).toBe(true);
  });

  it('accepts a custom header', () => {
    const r = formatReviewBatch([mk({})], { header: 'Hi AI:' });
    expect(r.text.startsWith('Hi AI:')).toBe(true);
  });

  it('truncates when batch exceeds 64 KB', () => {
    const big = 'y'.repeat(5000);
    const many: ReviewComment[] = Array.from({ length: 20 }, (_, i) =>
      mk({ id: `c${i}`, startLine: i + 1, endLine: i + 1, comment: big }),
    );
    const r = formatReviewBatch(many);
    expect(r.truncated).toBe(true);
    expect(r.includedCount).toBeLessThan(20);
    expect(r.text).toContain('additional comments omitted');
  });
});
