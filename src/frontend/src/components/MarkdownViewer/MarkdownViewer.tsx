import { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkGemoji from 'remark-gemoji';
import rehypeRaw from 'rehype-raw';
import mermaid from 'mermaid';
import { fetchFileContent } from '@/services/api';
import { useContentPinchZoom } from '@/hooks/useContentPinchZoom';
import styles from './MarkdownViewer.module.css';

interface MarkdownViewerProps {
  sessionId: string;
  filePath: string;
  fileName: string;
  onClose: () => void;
  onNavigate?: (filePath: string, fileName: string) => void;
}

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
});

let mermaidCounter = 0;

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const id = `mermaid-${++mermaidCounter}`;
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg;
      })
      .catch(() => {
        if (ref.current) {
          ref.current.textContent = code;
          ref.current.style.whiteSpace = 'pre';
        }
      });
  }, [code]);

  return <div ref={ref} className={styles.mermaid} />;
}

function resolveRelativePath(base: string, relative: string): string {
  if (relative.startsWith('/')) return relative;
  const baseDir = base.substring(0, base.lastIndexOf('/'));
  const parts = (baseDir + '/' + relative).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.' && part !== '') resolved.push(part);
  }
  return '/' + resolved.join('/');
}

function isExternalUrl(src: string): boolean {
  return /^https?:\/\/|^data:|^blob:/i.test(src);
}

export function MarkdownViewer({
  sessionId,
  filePath,
  fileName,
  onClose,
  onNavigate,
}: MarkdownViewerProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchFileContent(sessionId, filePath)
      .then((data) => setContent(data.content))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load file'))
      .finally(() => setLoading(false));
  }, [sessionId, filePath]);

  const contentRef = useRef<HTMLDivElement>(null);
  const markdownRef = useRef<HTMLDivElement>(null);
  const { scale, resetZoom } = useContentPinchZoom(contentRef, markdownRef);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose} title="Back to files">
          ←
        </button>
        <span className={styles.fileName}>📄 {fileName}</span>
        {scale !== 1 && (
          <button className={styles.zoomReset} onClick={resetZoom} title="Reset zoom">
            {Math.round(scale * 100)}%
          </button>
        )}
      </div>
      <div className={styles.content} ref={contentRef}>
        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : (
          <div
            className={styles.zoomWrapper}
            style={scale > 1 ? { width: `${scale * 100}%`, height: `${scale * 100}%` } : undefined}
          >
            <div className={styles.markdown} ref={markdownRef}>
            <Markdown
              remarkPlugins={[remarkGfm, remarkGemoji]}
              rehypePlugins={[rehypeRaw]}
              components={{
                img: ({ src, alt, ...props }) => {
                  if (!src || isExternalUrl(src)) {
                    return <img src={src} alt={alt} {...props} />;
                  }
                  const resolved = resolveRelativePath(filePath, src);
                  const url = `/api/sessions/${sessionId}/file-raw?file=${encodeURIComponent(resolved)}`;
                  return <img src={url} alt={alt} {...props} />;
                },
                a: ({ href, children, ...props }) => {
                  const h = href || '';
                  const mdTarget = h ? h.split('#')[0] || '' : '';
                  if (h && !isExternalUrl(h) && /\.(md|markdown)$/i.test(mdTarget)) {
                    return (
                      <a
                        href={h}
                        onClick={(e) => {
                          e.preventDefault();
                          const resolved = resolveRelativePath(filePath, mdTarget);
                          const name = resolved.split('/').pop() || resolved;
                          if (onNavigate) onNavigate(resolved, name);
                        }}
                        {...props}
                      >
                        {children}
                      </a>
                    );
                  }
                  return (
                    <a href={href} {...props}>
                      {children}
                    </a>
                  );
                },
                code: ({ className, children, ...props }) => {
                  const match = /language-mermaid/i.exec(className || '');
                  if (match) {
                    return <MermaidBlock code={String(children).trim()} />;
                  }
                  // Check if this is a block-level code (inside <pre>)
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {content}
            </Markdown>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
