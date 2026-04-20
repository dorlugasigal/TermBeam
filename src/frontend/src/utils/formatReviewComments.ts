import { sanitizeTerminalInput } from './sanitizeTerminalInput';

export type ReviewLineKind = 'add' | 'remove' | 'context';

export interface ReviewComment {
  id: string;
  file: string;
  /** Inclusive 1-based line number — uses the *new* line number for adds/context, *old* for removes. */
  startLine: number;
  endLine: number;
  lineKind: ReviewLineKind;
  /** The selected lines exactly as displayed (with leading +/-/space preserved). */
  selectedText: string;
  comment: string;
  createdAt: number;
}

const MAX_COMMENT_CHARS = 4 * 1024;
const MAX_BATCH_CHARS = 64 * 1024;
const MAX_QUOTED_CHARS = 8 * 1024;
const QUOTE_TRUNCATION_MARKER = '> …(truncated)';

const KIND_LABEL: Record<ReviewLineKind, string> = {
  add: 'new',
  remove: 'old',
  context: 'unchanged',
};

function formatRange(c: ReviewComment): string {
  return c.startLine === c.endLine
    ? `${c.file}:${c.startLine}`
    : `${c.file}:${c.startLine}-${c.endLine}`;
}

function quoteLines(text: string): string {
  const clean = sanitizeTerminalInput(text);
  const lines = clean.replace(/\n+$/, '').split('\n');
  const quoted = lines.map((l) => `> ${l}`);
  let out = quoted.join('\n');
  if (out.length <= MAX_QUOTED_CHARS) return out;
  // Truncate by whole lines so we never cut a line mid-way and always
  // keep the batch under the per-comment quote cap.
  const acc: string[] = [];
  let size = 0;
  for (const q of quoted) {
    if (size + q.length + 1 + QUOTE_TRUNCATION_MARKER.length + 1 > MAX_QUOTED_CHARS) break;
    acc.push(q);
    size += q.length + 1;
  }
  acc.push(QUOTE_TRUNCATION_MARKER);
  out = acc.join('\n');
  return out;
}

export function formatSingleComment(c: ReviewComment): string {
  const head = `[${formatRange(c)}] (${KIND_LABEL[c.lineKind]})`;
  const body = sanitizeTerminalInput(c.comment.trim()).slice(0, MAX_COMMENT_CHARS);
  const quote = quoteLines(c.selectedText);
  return `${head}\n${quote}\n${body}\n`;
}

export interface FormattedBatch {
  text: string;
  truncated: boolean;
  includedCount: number;
}

/**
 * Build the pastable batch text. Comments are grouped by file to keep
 * related feedback together. Output is hard-capped at MAX_BATCH_CHARS; any
 * comments that would overflow are dropped and `truncated` is set.
 */
export function formatReviewBatch(
  comments: ReviewComment[],
  opts: { header?: string } = {},
): FormattedBatch {
  if (comments.length === 0) return { text: '', truncated: false, includedCount: 0 };

  const header = opts.header ?? 'Review comments on working changes:';

  const byFile = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    const list = byFile.get(c.file) ?? [];
    list.push(c);
    byFile.set(c.file, list);
  }
  for (const list of byFile.values()) {
    list.sort((a, b) => a.startLine - b.startLine || a.createdAt - b.createdAt);
  }

  const chunks: string[] = [header, ''];
  let size = chunks.reduce((n, s) => n + s.length + 1, 0);
  let included = 0;
  let truncated = false;

  outer: for (const [, list] of byFile) {
    for (const c of list) {
      const piece = formatSingleComment(c);
      if (size + piece.length + 1 > MAX_BATCH_CHARS) {
        truncated = true;
        break outer;
      }
      chunks.push(piece);
      size += piece.length + 1;
      included += 1;
    }
  }

  if (truncated) chunks.push('…(additional comments omitted — batch size cap reached)');

  return { text: chunks.join('\n'), truncated, includedCount: included };
}
