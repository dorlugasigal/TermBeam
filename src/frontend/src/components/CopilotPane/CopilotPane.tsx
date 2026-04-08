import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import type { ExtraProps } from 'react-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCopilotSdk } from '@/hooks/useCopilotSdk';
import type { CopilotChatMessage, CopilotToolCall } from '@/hooks/useCopilotSdk';
import { useMobileKeyboard } from '@/hooks/useMobileKeyboard';
import { AgentCodeBlock } from '@/components/AgentView/AgentCodeBlock';
import { CopilotLogo } from '@/components/common/CopilotLogo';
import { TerminalPane } from '@/components/TerminalPane/TerminalPane';
import { DiffViewer } from './DiffViewer';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { fetchSessions, uploadImage } from '@/services/api';
import { toast } from 'sonner';
import styles from './CopilotPane.module.css';

// ── Internal tools that should never appear in chat ──

const HIDDEN_TOOLS = new Set([
  'report_intent',
  'sql',
  'store_memory',
  'ask_user',
  'sequentialthinking-sequentialthinking',
  'fetch_copilot_cli_documentation',
]);

// ── Session metadata ──

interface SessionMeta {
  cwd?: string;
  branch?: string;
  repository?: string;
}

function truncatePath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
}

// ── Props ──

interface CopilotPaneProps {
  sessionId: string;
  active: boolean;
}

const COPILOT_MODELS = [
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
  { id: 'claude-opus-4.5', label: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.2', label: 'GPT-5.2' },
  { id: 'gpt-5.1', label: 'GPT-5.1' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
];

// ── Octicon SVGs (16×16) ──

const OCTICONS: Record<string, ReactNode> = {
  terminal: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.749.749 0 0 1-.22.53l-2.25 2.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L5.44 8 3.72 6.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z" />
    </svg>
  ),
  task: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5.75 7.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Zm5.25.75a.75.75 0 0 0-1.5 0v1.5a.75.75 0 0 0 1.5 0v-1.5Z" />
      <path d="M6.25 0h2A.75.75 0 0 1 9 .75V3.5h3.25a2.25 2.25 0 0 1 2.25 2.25V8h.75a.75.75 0 0 1 0 1.5h-.75v2.75a2.25 2.25 0 0 1-2.25 2.25h-8.5a2.25 2.25 0 0 1-2.25-2.25V9.5H.75a.75.75 0 0 1 0-1.5h.75V5.75A2.25 2.25 0 0 1 3.75 3.5H7.5v-2H6.25a.75.75 0 0 1 0-1.5ZM3 5.75v6.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-6.5a.75.75 0 0 0-.75-.75h-8.5a.75.75 0 0 0-.75.75Z" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
    </svg>
  ),
  pencil: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="#C79026">
      <path d="M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" />
    </svg>
  ),
  fileAdded: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="#57AB5A">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073Zm4.48 3.758a.75.75 0 0 1 .755.745l.01 1.497h1.497a.75.75 0 0 1 0 1.5H9v1.507a.75.75 0 0 1-1.5 0V9.005l-1.502.01a.75.75 0 0 1-.01-1.5l1.507-.01-.01-1.492a.75.75 0 0 1 .745-.755Z" />
    </svg>
  ),
  question: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.92 6.085h.001a.749.749 0 1 1-1.342-.67c.169-.339.436-.701.849-.977C6.845 4.16 7.369 4 8 4a2.756 2.756 0 0 1 1.637.525c.503.377.863.965.863 1.725 0 .448-.115.83-.329 1.15-.205.307-.47.513-.692.662-.109.072-.22.138-.313.195l-.006.004a6.24 6.24 0 0 0-.26.16.952.952 0 0 0-.276.245.75.75 0 0 1-1.248-.832c.184-.264.42-.489.692-.661.103-.067.207-.132.313-.195l.007-.004c.1-.061.182-.11.258-.161a.969.969 0 0 0 .277-.245C8.96 6.514 9 6.427 9 6.25a.612.612 0 0 0-.262-.525A1.27 1.27 0 0 0 8 5.5c-.369 0-.595.09-.74.187a1.01 1.01 0 0 0-.34.398ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
    </svg>
  ),
  file: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
    </svg>
  ),
  globe: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM5.78 8.75a9.64 9.64 0 0 0 .2 2.086c.21.856.514 1.56.889 2.024.195.24.4.413.6.504.206.095.388.1.54.009.038-.023.086-.067.14-.14a.753.753 0 0 1-.017-.166V11.5a.75.75 0 0 1 .75-.75h1.29c.396 0 .77-.086 1.106-.243a.75.75 0 0 1 1.064.622c.088.5.143 1.023.163 1.565.017.39-.034.78-.152 1.153A6.504 6.504 0 0 0 14.5 8a6.52 6.52 0 0 0-.485-2.485.75.75 0 0 1-.023-.065 3.233 3.233 0 0 0-.3-.505 2.228 2.228 0 0 0-.936-.73 1.99 1.99 0 0 0-1.008-.159h-.044a3.25 3.25 0 0 1-2.419-1.071A3.25 3.25 0 0 1 8.34 1.506a6.504 6.504 0 0 0-2.56 7.244Z" />
    </svg>
  ),
  plug: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 8H2.5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1H4V3a1 1 0 0 1 1-1h1.5V.75a.75.75 0 0 1 1.5 0V2H9.5a1 1 0 0 1 1 1v1.5h1.5a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1H10.5v1a3.5 3.5 0 0 1-2.75 3.425V15.25a.75.75 0 0 1-1.5 0v-2.825A3.5 3.5 0 0 1 3.5 9V8Z" />
    </svg>
  ),
  tools: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5.433 2.304A4.492 4.492 0 0 0 3.5 6c0 1.598.832 3.002 2.09 3.802.518.329.886.857.986 1.46l.272 1.63a1.5 1.5 0 0 0 1.479 1.258h.344a1.5 1.5 0 0 0 1.48-1.258l.271-1.63a1.993 1.993 0 0 1 .987-1.46A4.501 4.501 0 0 0 12.5 6a4.49 4.49 0 0 0-1.933-3.696A.75.75 0 1 1 11.43.954 5.998 5.998 0 0 1 14 6a5.999 5.999 0 0 1-2.642 4.972.499.499 0 0 0-.247.365l-.272 1.63A3.001 3.001 0 0 1 7.872 15.15h-.344a3.001 3.001 0 0 1-2.967-2.183l-.272-1.63a.499.499 0 0 0-.247-.365A5.998 5.998 0 0 1 1.5 6c0-2.015.995-3.8 2.519-4.886a.75.75 0 1 1 .864 1.19Z" />
    </svg>
  ),
  chevronRight: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
  ),
  chevronDown: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
    </svg>
  ),
  copilot: <CopilotLogo size={16} />,
  person: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M10.561 8.073a6 6 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6 6 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
    </svg>
  ),
};

// ── Markdown components ──

const markdownComponents: Components = {
  a({ href, children, ...props }: React.ComponentProps<'a'> & ExtraProps) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  code({ className, children, ...props }: React.ComponentProps<'code'> & ExtraProps) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match) {
      return <AgentCodeBlock code={codeString} language={match[1]} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

// ── Helpers ──

function getToolIcon(toolName: string): ReactNode {
  const name = toolName.toLowerCase();
  if (name.includes('bash') || name.includes('shell') || name.includes('powershell'))
    return OCTICONS.terminal;
  if (name.includes('grep') || name.includes('glob') || name.includes('search'))
    return OCTICONS.search;
  if (name === 'create' || name.includes('file_create') || name.includes('file_added'))
    return OCTICONS.fileAdded;
  if (name.includes('edit') || name.includes('write')) return OCTICONS.pencil;
  if (name.includes('read') || name.includes('view')) return OCTICONS.file;
  if (name.includes('web_search') || name.includes('web_fetch') || name.includes('fetch'))
    return OCTICONS.globe;
  if (name.includes('ask_user') || name.includes('question')) return OCTICONS.question;
  if (name.includes('subagent') || name === 'task') return OCTICONS.task;
  if (name.includes('mcp')) return OCTICONS.plug;
  return OCTICONS.tools;
}

function getToolHeaderLabel(
  toolName: string,
  input?: Record<string, unknown>,
): { action: string; detail: string } {
  const name = (toolName || '').toLowerCase();

  if (
    name === 'edit' ||
    name === 'write' ||
    name === 'create' ||
    name.includes('file_edit') ||
    name.includes('file_write')
  ) {
    const filePath = input?.file_path || input?.path || '';
    const action = name === 'create' ? 'Create' : 'Edit';
    return { action, detail: String(filePath) };
  }

  if (name === 'read' || name === 'view' || name.includes('file_read')) {
    const filePath = input?.file_path || input?.path || '';
    const lineRange = input?.view_range ? `:${input.view_range}` : '';
    return { action: 'View', detail: String(filePath) + lineRange };
  }

  if (name === 'bash' || name.includes('shell') || name.includes('powershell')) {
    const cmd = input?.command || input?.fullCommandText || '';
    const firstLine = String(cmd).split('\n')[0] || '';
    return { action: '', detail: firstLine.slice(0, 80) || toolName };
  }

  if (name === 'grep' || name.includes('search') || name === 'glob') {
    const pattern = input?.pattern || input?.query || '';
    const path = input?.path ? ` in ${input.path}` : '';
    return { action: 'Search', detail: String(pattern) + path };
  }

  if (name === 'task') {
    const taskName = String(input?.description || input?.name || 'Task');
    const agentType = input?.agent_type ? String(input.agent_type) : '';
    const prefix = agentType
      ? `${agentType.charAt(0).toUpperCase() + agentType.slice(1)}:`
      : 'Task:';
    return { action: prefix, detail: taskName };
  }

  if (name.startsWith('subagent:')) {
    const displayName = toolName.replace(/^subagent:/, '');
    return { action: `${displayName}:`, detail: '' };
  }

  if (
    name.includes('mcp') ||
    name.includes('github-mcp') ||
    name.includes('ado-') ||
    name.includes('bing')
  ) {
    return { action: 'Call to', detail: toolName };
  }

  return { action: 'Call to', detail: toolName };
}

function createSimpleDiff(oldStr: string, newStr: string, filePath: string): string {
  const oldLines = oldStr ? oldStr.split('\n') : [];
  const newLines = newStr ? newStr.split('\n') : [];
  const result: string[] = [];
  result.push(`--- a/${filePath}`);
  result.push(`+++ b/${filePath}`);
  result.push(`@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@`);
  for (const line of oldLines) {
    result.push('-' + line);
  }
  for (const line of newLines) {
    result.push('+' + line);
  }
  return result.join('\n');
}

function isEditToolName(toolName: string): boolean {
  return ['edit', 'write', 'create', 'file_edit', 'file_write'].some((t) =>
    toolName?.toLowerCase().includes(t),
  );
}

function hasDiffContent(content: string): boolean {
  return content.includes('@@') || content.includes('diff --git') || content.includes('+++');
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null) return '';
  const seconds = ms / 1000;
  if (seconds < 1) return `${Math.round(ms)}ms`;
  return `${seconds.toFixed(1)}s`;
}

// ── Sub-components ──

function isSubagentTool(toolName: string): boolean {
  const name = (toolName || '').toLowerCase();
  return name === 'task' || name.startsWith('subagent:');
}

function PaneSubagentBlock({ tc }: { tc: CopilotToolCall }) {
  const isComplete = tc.status === 'complete';
  const [expanded, setExpanded] = useState(!isComplete);
  const toggle = useCallback(() => setExpanded((e) => !e), []);

  const name = tc.input?.name ? String(tc.input.name) : '';
  const description = tc.input?.description ? String(tc.input.description) : '';
  const prompt = tc.input?.prompt ? String(tc.input.prompt) : '';
  const agentType = tc.input?.agent_type ? String(tc.input.agent_type) : '';
  const childCalls = (tc.children ?? []).filter((c) => !HIDDEN_TOOLS.has(c.toolName || ''));

  // Derive display name from subagent:DisplayName or task description
  const displayName = tc.toolName.startsWith('subagent:')
    ? tc.toolName.slice('subagent:'.length)
    : agentType || 'Task';
  const headerDetail = description || name || '';

  // Auto-collapse when task completes
  useEffect(() => {
    if (isComplete) setExpanded(false);
  }, [isComplete]);

  return (
    <div className={styles.taskBlock}>
      <div
        className={styles.taskHeader}
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') toggle();
        }}
      >
        <span className={styles.toolIcon}>{OCTICONS.task}</span>
        <span className={styles.taskLabel}>{displayName}:</span>
        <span className={styles.taskName}>{headerDetail}</span>
        {childCalls.length > 0 && (
          <span className={styles.toolDuration}>{childCalls.length} calls</span>
        )}
        {isComplete && tc.duration !== undefined && (
          <span className={styles.toolDuration}>{formatDuration(tc.duration)}</span>
        )}
        {tc.status === 'running' && (
          <span className={styles.toolRunning}>running…</span>
        )}
        <span className={styles.taskChevron}>
          {expanded ? OCTICONS.chevronDown : OCTICONS.chevronRight}
        </span>
      </div>
      {expanded && (
        <div className={styles.taskContent}>
          {/* Agent prompt */}
          {prompt && (
            <div className={styles.taskPrompt}>
              <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {prompt}
              </Markdown>
            </div>
          )}
          {/* Nested tool calls from the sub-agent */}
          {childCalls.map((child) => (
            <PaneToolCallBlock key={child.id} tc={child} />
          ))}
          {/* Agent result */}
          {tc.result?.content && (
            <div className={styles.taskResult}>
              <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {tc.result.content}
              </Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaneToolCallBlock({ tc }: { tc: CopilotToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const icon = getToolIcon(tc.toolName);
  const { action, detail } = getToolHeaderLabel(tc.toolName, tc.input);
  const toggle = useCallback(() => setExpanded((e) => !e), []);

  return (
    <div className={styles.toolBlock}>
      <div
        className={styles.toolHeader}
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') toggle();
        }}
      >
        <span className={`${styles.toolChevron} ${expanded ? styles.toolChevronOpen : ''}`}>
          {OCTICONS.chevronRight}
        </span>
        <span className={styles.toolIcon}>{icon}</span>
        {action && <span className={styles.toolAction}>{action}</span>}
        <span className={styles.toolDetail}>{detail}</span>
        {tc.duration !== undefined && (
          <span className={styles.toolDuration}>{formatDuration(tc.duration)}</span>
        )}
        {tc.status === 'running' && <span className={styles.toolRunning}>running…</span>}
      </div>
      {expanded && (() => {
        const isFileOp =
          (tc.toolName?.toLowerCase().includes('edit') ||
           tc.toolName?.toLowerCase().includes('write') ||
           tc.toolName?.toLowerCase() === 'create') &&
          (tc.input?.path || tc.input?.file_path);
        return (
        <div className={styles.toolContent}>
          <div className={`${styles.toolContentInner} ${isFileOp ? styles.toolContentDiff : ''}`}>
            {tc.input && Object.keys(tc.input).length > 0 && (
              <>
                {tc.toolName?.toLowerCase().includes('bash') && tc.input?.command && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                      Command:
                    </div>
                    <pre>
                      <code>{String(tc.input.command)}</code>
                    </pre>
                  </div>
                )}
                {(tc.toolName?.toLowerCase().includes('edit') ||
                  tc.toolName?.toLowerCase().includes('write')) &&
                  (tc.input?.path || tc.input?.file_path) && (
                    <div>
                      {/* Show ONE diff: prefer result detailedContent, fallback to synthetic from input */}
                      {tc.result?.detailedContent &&
                      hasDiffContent(tc.result.detailedContent) ? (
                        <DiffViewer
                          diff={tc.result.detailedContent}
                          filePath={String(tc.input.path || tc.input.file_path || '')}
                        />
                      ) : (tc.input.old_str || tc.input.old_string) !== undefined &&
                        (tc.input.new_str || tc.input.new_string) !== undefined ? (
                        <DiffViewer
                          diff={createSimpleDiff(
                            String(tc.input.old_str || tc.input.old_string || ''),
                            String(tc.input.new_str || tc.input.new_string || ''),
                            String(tc.input.path || tc.input.file_path || ''),
                          )}
                          filePath={String(tc.input.path || tc.input.file_path || '')}
                        />
                      ) : (tc.result?.content || tc.result?.detailedContent) ? (
                        <pre style={{ maxHeight: 300, overflow: 'auto' }}>
                          <code>
                            {String(tc.result?.content || tc.result?.detailedContent || '').slice(
                              0,
                              2000,
                            )}
                            {String(tc.result?.content || '').length > 2000
                              ? '\n... (truncated)'
                              : ''}
                          </code>
                        </pre>
                      ) : null}
                    </div>
                  )}
                {/* Create file — show content as all-green diff */}
                {tc.toolName?.toLowerCase() === 'create' &&
                  (tc.input?.path || tc.input?.file_path) && (
                    <div>
                      {tc.input?.file_text ? (
                        <DiffViewer
                          diff={createSimpleDiff(
                            '',
                            String(tc.input.file_text),
                            String(tc.input.path || tc.input.file_path || ''),
                          )}
                          filePath={String(tc.input.path || tc.input.file_path || '')}
                        />
                      ) : (tc.result?.content || tc.result?.detailedContent) ? (
                        <DiffViewer
                          diff={createSimpleDiff(
                            '',
                            String(tc.result.content || tc.result.detailedContent),
                            String(tc.input.path || tc.input.file_path || ''),
                          )}
                          filePath={String(tc.input.path || tc.input.file_path || '')}
                        />
                      ) : null}
                    </div>
                  )}
                {tc.toolName?.toLowerCase().includes('grep') && (
                  <div style={{ fontSize: 12 }}>
                    Pattern: <code>{String(tc.input?.pattern || '')}</code>
                    {tc.input?.path ? <span> in {String(tc.input.path)}</span> : null}
                  </div>
                )}
                {tc.toolName?.toLowerCase().includes('glob') && tc.input?.pattern && (
                  <div style={{ fontSize: 12 }}>
                    Pattern: <code>{String(tc.input.pattern)}</code>
                    {tc.input?.path ? <span> in {String(tc.input.path)}</span> : null}
                  </div>
                )}
                {!['bash', 'edit', 'write', 'grep', 'read', 'view', 'glob', 'create'].some((t) =>
                  tc.toolName?.toLowerCase().includes(t),
                ) && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                      Input
                    </div>
                    <pre>
                      <code>{JSON.stringify(tc.input, null, 2)}</code>
                    </pre>
                  </div>
                )}
              </>
            )}
            {/* Result section — skip for edit tools (diff already shown above) */}
            {(tc.result?.content || tc.result?.detailedContent) &&
              !isEditToolName(tc.toolName) && (
                <div
                  style={{
                    marginTop: 8,
                    borderTop: '1px solid var(--border)',
                    paddingTop: 8,
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                    Result:
                  </div>
                  <pre style={{ maxHeight: 300, overflow: 'auto' }}>
                    <code>
                      {String(tc.result?.content || tc.result?.detailedContent || '').slice(
                        0,
                        2000,
                      )}
                      {String(tc.result?.content || '').length > 2000
                        ? '\n... (truncated)'
                        : ''}
                    </code>
                  </pre>
                </div>
              )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

function PaneUserMessage({ message }: { message: CopilotChatMessage }) {
  return (
    <div className={styles.userMsg}>
      <div className={styles.userBubble}>{message.content}</div>
      <div className={styles.userAvatar}>
        <span className={styles.avatarCircle}>{OCTICONS.person}</span>
      </div>
    </div>
  );
}

function PaneAssistantMessage({ message }: { message: CopilotChatMessage }) {
  const markdownContent = message.content.replace(/\n/g, '  \n');

  return (
    <div className={styles.assistantMsg}>
      <div className={styles.assistantContent}>
        {message.content && (
          <div className={`${styles.markdownWrapper} markdown-body`}>
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {markdownContent}
            </Markdown>
            {message.isStreaming && <span className={styles.cursor}>▊</span>}
          </div>
        )}
        {!message.content && message.isStreaming && <span className={styles.cursor}>▊</span>}
        {(message.toolCalls || [])
          .filter((tc) => !HIDDEN_TOOLS.has(tc.toolName || ''))
          .map((tc) =>
            isSubagentTool(tc.toolName) ? (
              <PaneSubagentBlock key={tc.id} tc={tc} />
            ) : (
              <PaneToolCallBlock key={tc.id} tc={tc} />
            ),
          )}
      </div>
    </div>
  );
}

function PaneSystemMessage({ message }: { message: CopilotChatMessage }) {
  return (
    <div className={styles.systemMsg}>
      <div className={styles.systemContent}>
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.content}
        </Markdown>
      </div>
    </div>
  );
}

function InputRequestUI({
  inputRequest,
  onRespond,
}: {
  inputRequest: NonNullable<CopilotChatMessage['inputRequest']>;
  onRespond: (answer: string) => void;
}) {
  const [freeformText, setFreeformText] = useState('');

  return (
    <div className={styles.inputRequest}>
      <div className={styles.inputRequestQuestion}>{inputRequest.question}</div>
      {inputRequest.choices && inputRequest.choices.length > 0 && (
        <div className={styles.inputRequestChoices}>
          {inputRequest.choices.map((choice, i) => (
            <button key={i} onClick={() => onRespond(choice)} className={styles.inputRequestChoice}>
              {choice}
            </button>
          ))}
        </div>
      )}
      {inputRequest.allowFreeform && (
        <div className={styles.inputRequestFreeform}>
          <input
            type="text"
            value={freeformText}
            onChange={(e) => setFreeformText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && freeformText.trim()) {
                onRespond(freeformText.trim());
                setFreeformText('');
              }
            }}
            placeholder="Type your response…"
            className={styles.inputRequestInput}
          />
          <button
            onClick={() => {
              if (freeformText.trim()) {
                onRespond(freeformText.trim());
                setFreeformText('');
              }
            }}
            disabled={!freeformText.trim()}
            className={styles.inputRequestSend}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className={styles.thinking}>
      <div
        className={styles.assistantContent}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0' }}
      >
        <span className={styles.thinkingDots}>
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Thinking…</span>
      </div>
    </div>
  );
}

// ── Touch device detection (computed once at module level) ──

const isTouchDevice =
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

// ── Speech Recognition API ──

const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

// ── Main component ──

export function CopilotPane({ sessionId, active }: CopilotPaneProps) {
  const initialModel = useSessionStore(
    (s) => s.sessions.get(sessionId)?.model,
  );
  const { messages, status, sendMessage, sessionReady, connected, respondToInput, currentModel, setModel, cancelSession } = useCopilotSdk(
    { sessionId, autoCreate: true, model: initialModel },
  );
  const { keyboardOpen } = useMobileKeyboard();
  const fontSize = useUIStore((s) => s.fontSize);

  const [inputText, setInputText] = useState('');
  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [textareaFocused, setTextareaFocused] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  // Read companion terminal ID from the session store (set at creation time)
  const companionTermId = useSessionStore(
    (s) => s.sessions.get(sessionId)?.companionTermId ?? null,
  );

  // Re-fit embedded terminal when toggling
  useEffect(() => {
    if (showTerminal && companionTermId) {
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showTerminal, companionTermId]);

  // Clean up speech recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          /* ignore */
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  // Sync showTerminal state to UI store so TouchBar can show terminal keys
  useEffect(() => {
    useUIStore.getState().setShowingAgentTerminal(showTerminal);
    return () => {
      useUIStore.getState().setShowingAgentTerminal(false);
    };
  }, [showTerminal]);

  // Fetch session metadata (CWD, git branch, repo)
  useEffect(() => {
    if (!sessionReady) return;
    const store = useSessionStore.getState();
    const ms = store.sessions.get(sessionId);
    if (ms) {
      setSessionMeta({
        cwd: ms.cwd || undefined,
        branch: ms.git?.branch || undefined,
        repository: ms.git?.repoName || undefined,
      });
    }
    // Also try the API for richer copilot metadata
    fetchSessions()
      .then((sessions) => {
        const match = sessions.find((s) => s.id === sessionId);
        if (match) {
          setSessionMeta((prev) => ({
            cwd: match.cwd || prev?.cwd,
            branch: match.git?.branch || prev?.branch,
            repository: match.git?.repoName || prev?.repository,
          }));
        }
      })
      .catch(() => {});
  }, [sessionId, sessionReady]);

  // Auto-scroll when messages change
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  // Focus textarea when pane becomes active (desktop only — avoids keyboard popup on mobile)
  useEffect(() => {
    if (active && sessionReady && !showTerminal && window.innerWidth > 768) {
      textareaRef.current?.focus();
    }
  }, [active, sessionReady, showTerminal]);

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed || status === 'streaming') return;
    sendMessage(trimmed);
    setInputText('');
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) el.style.height = 'auto';
    });
  }, [inputText, status, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // On mobile: Enter = newline (default behavior), no special handling
      // On desktop: Enter = send, Shift+Enter = newline
      if (!isTouchDevice && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Check for pasted images first
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item?.type?.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const toastId = toast.loading('Uploading image… 0%');
          try {
            const data = await uploadImage(blob, item.type, (pct: number) => {
              toast.loading(`Uploading image… ${pct}%`, { id: toastId });
            });
            if (data.path) {
              setInputText((prev) => prev + data.path + ' ');
            }
            toast.success('Image uploaded', { id: toastId });
          } catch {
            toast.error('Image upload failed', { id: toastId });
          }
          return;
        }
      }
    }
    // Plain text paste — let browser handle it natively
  }, []);

  // ── Speech recognition (mic button) ──

  const startRecording = useCallback(() => {
    if (isRecording || !SpeechRecognitionAPI) return;
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (transcript) setInputText((prev) => prev + transcript);
    };
    recognition.onerror = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };
    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
    } catch {
      // Failed to start
    }
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const micButton = SpeechRecognitionAPI ? (
    <button
      className={`${styles.micBtn} ${isRecording ? styles.micBtnRecording : ''}`}
      onMouseDown={isRecording ? stopRecording : startRecording}
      aria-label={isRecording ? 'Stop recording' : 'Voice input'}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 0ZM4 7a.75.75 0 0 0-1.5 0A5.504 5.504 0 0 0 7.25 12.473V14.5a.75.75 0 0 0 1.5 0v-2.027A5.504 5.504 0 0 0 13.5 7a.75.75 0 0 0-1.5 0 4 4 0 1 1-8 0Z" />
      </svg>
    </button>
  ) : null;

  const isWorking = status === 'thinking' || status === 'streaming';
  const isInputDisabled = !sessionReady || status === 'streaming';

  const statusLabel = useMemo(() => {
    if (!connected) return 'Connecting…';
    if (!sessionReady) return 'Starting Copilot…';
    if (isWorking) return 'Thinking…';
    return 'Ready';
  }, [connected, sessionReady, isWorking]);

  const statusKey = useMemo(() => {
    if (!connected) return 'disconnected';
    if (isWorking) return status;
    return 'idle';
  }, [connected, isWorking, status]);

  const placeholder = useMemo(() => {
    if (!connected) return 'Connecting…';
    if (!sessionReady) return 'Starting session…';
    if (isWorking) return 'Copilot is working…';
    return 'Send a message to the CLI session…';
  }, [connected, sessionReady, isWorking]);

  const toggleTerminal = useCallback(() => {
    if (!companionTermId) return; // No companion terminal available
    setShowTerminal((prev) => !prev);
  }, [companionTermId]);

  return (
    <div className={styles.container}>
      {/* Status bar */}
      <div className={styles.statusBar}>
        <span className={styles.statusDot} data-status={statusKey} />
        <span>{statusLabel}</span>
        <select
          className={styles.modelSelect}
          value={currentModel}
          onChange={(e) => setModel(e.target.value)}
          disabled={!sessionReady}
        >
          {COPILOT_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button
          className={styles.terminalBtn}
          onClick={toggleTerminal}
          title={showTerminal ? 'Show chat' : 'Show terminal'}
          aria-label={showTerminal ? 'Show chat' : 'Show terminal'}
        >
          {showTerminal ? OCTICONS.copilot : OCTICONS.terminal}
        </button>
      </div>

      {/* Terminal view — always mounted once available, hidden off-screen to preserve connection */}
      {companionTermId && (
        <div style={showTerminal ? {
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        } : {
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          visibility: 'hidden',
          pointerEvents: 'none',
        }}>
          <TerminalPane
            sessionId={companionTermId}
            active={active && showTerminal}
            visible={showTerminal}
            fontSize={fontSize}
          />
        </div>
      )}

      {/* Chat view */}
      {!showTerminal && (
        <>
          {/* Session metadata bar */}
          {sessionMeta && (sessionMeta.cwd || sessionMeta.branch || sessionMeta.repository) && (
        <div className={styles.metaBar}>
          {sessionMeta.cwd && (
            <span className={styles.metaItem}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>
              </svg>
              {truncatePath(sessionMeta.cwd)}
            </span>
          )}
          {sessionMeta.branch && (
            <span className={styles.metaItem}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"/>
              </svg>
              {sessionMeta.branch}
            </span>
          )}
          {sessionMeta.repository && (
            <span className={styles.metaItem}>{sessionMeta.repository}</span>
          )}
        </div>
      )}

      {/* Message list */}
      <div className={styles.messages}>
        <div className={styles.messagesInner}>
          {messages.length === 0 && status === 'idle' ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>{OCTICONS.copilot}</span>
              <span className={styles.emptyTitle}>
                {sessionReady ? 'Start a conversation' : 'Connecting…'}
              </span>
              <span className={styles.emptyHint}>
                {sessionReady
                  ? 'Ask GitHub Copilot anything. Messages are streamed in real time.'
                  : 'Setting up your Copilot session…'}
              </span>
            </div>
          ) : (
            <>
              {messages.map((msg) => {
                switch (msg.role) {
                  case 'user':
                    return <PaneUserMessage key={msg.id} message={msg} />;
                  case 'assistant':
                    return (
                      <div key={msg.id}>
                        <PaneAssistantMessage message={msg} />
                        {msg.inputRequest && (
                          <InputRequestUI
                            inputRequest={msg.inputRequest}
                            onRespond={respondToInput}
                          />
                        )}
                      </div>
                    );
                  case 'system':
                    return <PaneSystemMessage key={msg.id} message={msg} />;
                  default:
                    return null;
                }
              })}
              {status === 'thinking' &&
                (() => {
                  const lastMsg = messages[messages.length - 1];
                  return !(lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming);
                })() && <ThinkingIndicator />}
            </>
          )}
          <div ref={scrollRef} className={styles.scrollAnchor} />
        </div>
      </div>

      {/* Input bar */}
      <div className={`${styles.inputBar} ${keyboardOpen ? styles.inputBarKeyboardOpen : ''}`}>
        <div className={`${styles.inputContainer} ${textareaFocused ? styles.inputContainerFocused : ''}`}>
          <textarea
            ref={textareaRef}
            className={styles.input}
            value={inputText}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => {
              setTextareaFocused(true);
              // On mobile, scroll the input into view after keyboard appears
              setTimeout(() => textareaRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
            }}
            onBlur={() => setTextareaFocused(false)}
            placeholder={placeholder}
            disabled={isInputDisabled}
            rows={1}
          />
          <div className={styles.inputActions}>
            {isWorking && (
              <button className={styles.stopBtn} onClick={cancelSession} aria-label="Stop">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="2" />
                </svg>
              </button>
            )}
            {micButton}
            <button
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={!inputText.trim() || isInputDisabled}
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M.989 8 .064 2.68a1.342 1.342 0 0 1 1.85-1.462l13.402 5.744a1.13 1.13 0 0 1 0 2.076L1.913 14.782a1.343 1.343 0 0 1-1.85-1.463L.99 8Zm.603-5.075L2.38 7.25h3.87a.75.75 0 0 1 0 1.5H2.38l-.788 4.325L13.929 8Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
