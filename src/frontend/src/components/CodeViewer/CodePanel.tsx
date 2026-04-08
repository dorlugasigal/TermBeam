import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { usePinch } from '@use-gesture/react';
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
import type { GitBlame } from '@/services/api';
import BlameGutter from './BlameGutter';
import styles from './CodePanel.module.css';

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

interface CodePanelProps {
  content: string;
  language: string;
  fileName: string;
  scrollTop?: number;
  onScroll?: (scrollTop: number) => void;
  blame?: GitBlame | null;
  blameEnabled?: boolean;
  blameLoading?: boolean;
}

function isBinary(content: string): boolean {
  return content.includes('\0');
}

export default function CodePanel({
  content,
  language,
  fileName,
  scrollTop,
  onScroll,
  blame,
  blameEnabled,
  blameLoading,
}: CodePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isRestoringScroll = useRef(false);

  const BASE_FONT_SIZE = 13;
  const MIN_FONT_SIZE = 9;
  const MAX_FONT_SIZE = 24;

  const [fontSize, setFontSize] = useState(BASE_FONT_SIZE);

  const clampFontSize = useCallback(
    (scale: number) =>
      Math.min(
        MAX_FONT_SIZE,
        Math.max(MIN_FONT_SIZE, Math.round(BASE_FONT_SIZE * scale * 10) / 10),
      ),
    [],
  );

  usePinch(
    ({ offset: [scale] }) => {
      setFontSize(clampFontSize(scale));
    },
    {
      target: containerRef,
      scaleBounds: { min: MIN_FONT_SIZE / BASE_FONT_SIZE, max: MAX_FONT_SIZE / BASE_FONT_SIZE },
      from: () => [fontSize / BASE_FONT_SIZE, 0],
      eventOptions: { passive: false },
    },
  );

  const resolvedLang = language || detectLanguage(fileName);

  const highlightedLines = useMemo(() => {
    if (!content || isBinary(content)) return [];
    const lines = content.split('\n');
    return lines.map((line) => {
      try {
        if (resolvedLang && hljs.getLanguage(resolvedLang)) {
          return hljs.highlight(line, { language: resolvedLang, ignoreIllegals: true }).value;
        }
        return hljs.highlightAuto(line).value;
      } catch {
        return line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
    });
  }, [content, resolvedLang]);

  // Restore scroll position
  useEffect(() => {
    if (containerRef.current && scrollTop != null && scrollTop > 0) {
      isRestoringScroll.current = true;
      containerRef.current.scrollTop = scrollTop;
      requestAnimationFrame(() => {
        isRestoringScroll.current = false;
      });
    }
  }, [scrollTop, fileName]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onScroll) return;

    const handleScroll = () => {
      if (!isRestoringScroll.current) {
        onScroll(el.scrollTop);
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onScroll]);

  if (isBinary(content)) {
    return <div className={styles.empty}>Binary file — cannot display</div>;
  }

  if (!content) {
    return <div className={styles.empty}>Empty file</div>;
  }

  return (
    <div className={styles.wrapper}>
      {blameEnabled && blame && <BlameGutter blame={blame} />}
      {blameEnabled && blameLoading && !blame && (
        <div className={styles.blameLoading}>Loading blame…</div>
      )}
      <div
        className={styles.container}
        ref={containerRef}
        style={fontSize !== BASE_FONT_SIZE ? { fontSize: `${fontSize}px` } : undefined}
      >
        <div className={styles.table}>
          {highlightedLines.map((lineHtml, i) => (
            <div key={i} className={styles.row}>
              <span className={styles.lineNumber}>{i + 1}</span>
              <span
                className={styles.lineContent}
                dangerouslySetInnerHTML={{ __html: lineHtml || ' ' }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
