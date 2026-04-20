import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useReviewCommentsStore } from '@/stores/reviewCommentsStore';
import { formatReviewBatch, type ReviewComment } from '@/utils/formatReviewComments';
import { wrapBracketedPaste, sanitizeTerminalInput } from '@/utils/sanitizeTerminalInput';
import styles from './ReviewCommentsPanel.module.css';

interface ReviewCommentsPanelProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

type SendTarget = 'session' | 'clipboard';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy path.
  }
  // Legacy fallback for non-secure contexts (http://) where the async API
  // is unavailable. Uses a hidden textarea + document.execCommand('copy').
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function ReviewCommentsPanel({
  sessionId,
  open,
  onClose,
}: ReviewCommentsPanelProps) {
  const load = useReviewCommentsStore((s) => s.load);
  const allComments = useReviewCommentsStore((s) => s.bySession.get(sessionId));
  const comments = useMemo(() => allComments ?? [], [allComments]);
  const removeComment = useReviewCommentsStore((s) => s.removeComment);
  const clearForSession = useReviewCommentsStore((s) => s.clearForSession);

  useEffect(() => {
    load(sessionId);
  }, [sessionId, load]);

  const sessions = useSessionStore((s) => s.sessions);
  const session = sessions.get(sessionId);
  const closeCodeViewer = useUIStore((s) => s.closeCodeViewer);

  const grouped = useMemo(() => groupByFile(comments), [comments]);
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const hasComments = comments.length > 0;
  const sessionLabel = session?.name ?? sessionId.slice(0, 8);
  const defaultTarget: SendTarget = 'session';

  async function handleSend(target: SendTarget) {
    if (!hasComments) return;
    setSending(true);
    try {
      const { text, truncated, includedCount } = formatReviewBatch(comments);
      if (!text || includedCount === 0) {
        toast.error('Nothing to send');
        return;
      }

      if (target === 'clipboard') {
        const ok = await copyToClipboard(text);
        if (!ok) {
          toast.error('Clipboard not available');
          return;
        }
      } else {
        const sent = sendToSession(sessionId, text);
        if (!sent) {
          toast.error('Session not ready — try Copy instead');
          return;
        }
      }

      if (truncated) toast.warning('Some comments were omitted (batch size cap)');

      // Snapshot the originals (ids, createdAt, etc) so Undo restores them
      // faithfully rather than creating new comments with fresh metadata.
      const snapshot = comments.map((c) => ({ ...c }));
      clearForSession(sessionId);
      onClose();
      if (target === 'session') {
        closeCodeViewer();
      } else {
        toast.success(
          `Copied ${includedCount} comment${includedCount === 1 ? '' : 's'} to clipboard`,
          {
            duration: 6000,
            action: {
              label: 'Undo clear',
              onClick: () => {
                restoreSnapshot(sessionId, snapshot);
              },
            },
          },
        );
      }
    } catch (err) {
      toast.error('Failed to send comments');
      console.error('[review] send failed', err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Review comments"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>
            Review comments
            <span className={styles.count}>
              ({comments.length} · {grouped.size} file{grouped.size === 1 ? '' : 's'})
            </span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close review panel"
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          {!hasComments && (
            <div className={styles.empty}>
              No comments yet. Enable review mode in the diff viewer, tap lines, and add comments.
            </div>
          )}
          {[...grouped.entries()].map(([file, fileComments]) => (
            <div key={file} className={styles.fileGroup}>
              <div className={styles.fileName}>{file}</div>
              {fileComments.map((c) => (
                <div key={c.id} className={styles.comment}>
                  <div className={styles.commentHeader}>
                    <span>
                      L{c.startLine}
                      {c.endLine !== c.startLine ? `–${c.endLine}` : ''} ({kindLabel(c.lineKind)})
                    </span>
                    <button
                      type="button"
                      className={styles.commentRemove}
                      onClick={() => removeComment(sessionId, c.id)}
                      aria-label="Remove comment"
                    >
                      Remove
                    </button>
                  </div>
                  <div className={styles.commentSnippet}>{c.selectedText}</div>
                  <div className={styles.commentBody}>{c.comment}</div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={`${styles.btn} ${styles.sendBtn}`}
            onClick={() => handleSend(defaultTarget)}
            disabled={!hasComments || sending}
          >
            {sending ? 'Sending…' : `Send ${comments.length} to ${sessionLabel}`}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => handleSend('clipboard')}
            disabled={!hasComments || sending}
            title="Copy formatted comments to clipboard"
          >
            Copy
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.clearBtn}`}
            onClick={() => {
              if (comments.length > 1 && !window.confirm(`Clear ${comments.length} comments?`)) {
                return;
              }
              const snapshot = comments.map((c) => ({ ...c }));
              clearForSession(sessionId);
              toast.success(
                `Cleared ${snapshot.length} comment${snapshot.length === 1 ? '' : 's'}`,
                {
                  duration: 6000,
                  action: {
                    label: 'Undo',
                    onClick: () => {
                      restoreSnapshot(sessionId, snapshot);
                    },
                  },
                },
              );
            }}
            disabled={!hasComments}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function restoreSnapshot(sessionId: string, snapshot: ReviewComment[]): void {
  // Preserve original ids & createdAt so Undo is a true restore rather than
  // a fresh create with new metadata.
  useReviewCommentsStore.setState((state) => {
    const next = new Map(state.bySession);
    const current = next.get(sessionId) ?? [];
    const byId = new Map(current.map((c) => [c.id, c]));
    for (const c of snapshot) byId.set(c.id, c);
    const merged = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
    next.set(sessionId, merged);
    try {
      const key = `termbeam-review-comments:${sessionId}`;
      localStorage.setItem(key, JSON.stringify(merged));
    } catch {
      // best-effort persistence
    }
    return { bySession: next };
  });
}

function groupByFile(comments: ReviewComment[]): Map<string, ReviewComment[]> {
  const out = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    const list = out.get(c.file) ?? [];
    list.push(c);
    out.set(c.file, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.startLine - b.startLine || a.createdAt - b.createdAt);
  }
  return out;
}

function kindLabel(kind: ReviewComment['lineKind']): string {
  return kind === 'add' ? 'new' : kind === 'remove' ? 'old' : 'unchanged';
}

function sendToSession(sessionId: string, text: string): boolean {
  const safe = sanitizeTerminalInput(text);
  const { sessions } = useSessionStore.getState();
  const ms = sessions.get(sessionId);
  if (!ms?.send || !ms.connected) return false;
  // Bracketed-paste so multiline text lands as one block.
  ms.send(wrapBracketedPaste(safe));
  return true;
}
