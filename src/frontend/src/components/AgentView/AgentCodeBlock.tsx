import { useState, useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import cssLang from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bashLang from 'highlight.js/lib/languages/bash';
import markdownLang from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import diff from 'highlight.js/lib/languages/diff';
import styles from './AgentView.module.css';

// Register languages (idempotent — safe if CodePanel already registered them)
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', cssLang);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('bash', bashLang);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('diff', diff);

// Common aliases
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('py', python);
hljs.registerLanguage('sh', bashLang);
hljs.registerLanguage('shell', bashLang);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('yml', yaml);

function fallbackCopy(text: string, setCopied: (v: boolean) => void) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  } catch {
    // silent — copy not available in this context
  }
}

interface AgentCodeBlockProps {
  code: string;
  language?: string;
}

export function AgentCodeBlock({ code, language }: AgentCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const highlighted = useMemo(() => {
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [code, language]);

  const handleCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {
          fallbackCopy(code, setCopied);
        });
    } else {
      fallbackCopy(code, setCopied);
    }
  };

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{language || 'text'}</span>
        <button
          className={styles.copyButton}
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy code'}
          aria-label={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? '✓' : '⎘'}
        </button>
      </div>
      <pre className={styles.codePre}>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
