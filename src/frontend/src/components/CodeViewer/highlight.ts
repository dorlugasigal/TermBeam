import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import cssLang from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ini from 'highlight.js/lib/languages/ini';
import diff from 'highlight.js/lib/languages/diff';
import type { DiffHunk } from '@/services/api';
import './syntax.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', cssLang);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('diff', diff);

// Aliases
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('py', python);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('htm', xml);
hljs.registerLanguage('yml', yaml);

export function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    py: 'python',
    pyw: 'python',
    json: 'json',
    jsonc: 'json',
    css: 'css',
    scss: 'css',
    less: 'css',
    html: 'xml',
    htm: 'xml',
    xml: 'xml',
    svg: 'xml',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    md: 'markdown',
    mdx: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cs: 'csharp',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    c: 'cpp',
    h: 'cpp',
    hpp: 'cpp',
    dockerfile: 'dockerfile',
    ini: 'ini',
    toml: 'ini',
    cfg: 'ini',
    diff: 'diff',
    patch: 'diff',
  };

  const fullName = fileName.toLowerCase();
  if (fullName === 'dockerfile' || fullName.startsWith('dockerfile.')) return 'dockerfile';
  if (fullName === 'makefile' || fullName === 'gnumakefile') return 'bash';
  if (fullName === '.env' || fullName.startsWith('.env.')) return 'ini';

  return map[ext] || '';
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Split highlight.js HTML into one fragment per source line. Spans still open
 * at a line break are closed there and reopened on the next line, so tokens
 * that cover several lines (template literals, block comments, docstrings)
 * keep their colour on every line and each fragment stays balanced.
 */
export function splitHighlightedLines(html: string): string[] {
  const token = /<span[^>]*>|<\/span>|\n/g;
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html)) !== null) {
    line += html.slice(last, match.index);
    last = match.index + match[0].length;
    if (match[0] === '\n') {
      lines.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else {
      if (match[0] === '</span>') open.pop();
      else open.push(match[0]);
      line += match[0];
    }
  }
  lines.push(line + html.slice(last));
  return lines;
}

/** Highlight a whole file (auto-detecting unknown languages), one HTML fragment per line. */
export function highlightToLines(content: string, language: string): string[] {
  let html: string;
  try {
    html =
      language && hljs.getLanguage(language)
        ? hljs.highlight(content, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(content).value;
  } catch {
    html = escapeHtml(content);
  }
  return splitHighlightedLines(html);
}

/**
 * Highlight diff hunks, returning HTML for every hunk line (or null when the
 * language is unknown). Each hunk's old side (context and removed lines) and
 * new side (context and added lines) are highlighted as contiguous code, so
 * tokens that span several lines inside the hunk keep their colour.
 */
export function highlightDiff(hunks: DiffHunk[], language: string): string[][] | null {
  if (!language || !hljs.getLanguage(language)) return null;
  const highlightSide = (lines: string[]) => {
    const text = lines.join('\n');
    try {
      return splitHighlightedLines(hljs.highlight(text, { language, ignoreIllegals: true }).value);
    } catch {
      return splitHighlightedLines(escapeHtml(text));
    }
  };
  return hunks.map((hunk) => {
    const before = highlightSide(hunk.lines.filter((l) => l.type !== 'add').map((l) => l.content));
    const after = highlightSide(
      hunk.lines.filter((l) => l.type !== 'remove').map((l) => l.content),
    );
    let oldIdx = 0;
    let newIdx = 0;
    return hunk.lines.map((line) => {
      if (line.type === 'remove') return before[oldIdx++] ?? '';
      if (line.type === 'add') return after[newIdx++] ?? '';
      oldIdx++;
      return after[newIdx++] ?? '';
    });
  });
}
