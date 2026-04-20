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
  const addComment = useReviewCommentsStore((s) => s.addComment);

  useEffect(() => {
    load(sessionId);
  }, [sessionId, load]);

  const sessions = useSessionStore((s) => s.sessions);
  const session = sessions.get(sessionId);
  const chatInputHandler = useUIStore((s) => s.chatInputHandler);
  const closeCodeViewer = useUIStore((s) => s.closeCodeViewer);

  const grouped = useMemo(() => groupByFile(comments), [comments]);
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const hasComments = comments.length > 0;
  const sessionLabel = session?.name ?? sessionId.slice(0, 8);
  const isCopilot = session?.type === 'copilot';
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
        if (!navigator.clipboard) {
          toast.error('Clipboard not available');
          return;
        }
        await navigator.clipboard.writeText(text);
      } else {
        const sent = sendToSession(sessionId, text, { isCopilot, chatInputHandler });
        if (!sent) {
          toast.error('Session not ready — try Copy instead');
          return;
        }
      }

      if (truncated) toast.warning('Some comments were omitted (batch size cap)');

      // Clear the review state and dismiss the whole git view so the user
      // lands back in the terminal/agent where the comments were just sent.
      clearForSession(sessionId);
      onClose();
      if (target === 'session') {
        closeCodeViewer();
      } else {
        // Clipboard path: keep the git view open, but still give the user a
        // brief confirmation (can't reasonably paste without a target yet).
        const snapshot = comments.map((c) => ({ ...c }));
        toast.success(`Copied ${includedCount} comment${includedCount === 1 ? '' : 's'} to clipboard`, {
          duration: 6000,
          action: {
            label: 'Undo clear',
            onClick: () => {
              for (const c of snapshot) {
                addComment(sessionId, {
                  file: c.file,
                  startLine: c.startLine,
                  endLine: c.endLine,
                  lineKind: c.lineKind,
                  selectedText: c.selectedText,
                  comment: c.comment,
                });
              }
              toast.success('Comments restored');
            },
          },
        });
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
            {sending
              ? 'Sending…'
              : `Send ${comments.length} to ${isCopilot ? 'agent chat' : sessionLabel}`}
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
              toast.success(`Cleared ${snapshot.length} comment${snapshot.length === 1 ? '' : 's'}`, {
                duration: 6000,
                action: {
                  label: 'Undo',
                  onClick: () => {
                    for (const c of snapshot) {
                      addComment(sessionId, {
                        file: c.file,
                        startLine: c.startLine,
                        endLine: c.endLine,
                        lineKind: c.lineKind,
                        selectedText: c.selectedText,
                        comment: c.comment,
                      });
                    }
                  },
                },
              });
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

interface SendContext {
  isCopilot: boolean;
  chatInputHandler: ((text: string) => void) | null;
}

function sendToSession(sessionId: string, text: string, ctx: SendContext): boolean {
  const safe = sanitizeTerminalInput(text);
  if (ctx.isCopilot) {
    if (ctx.chatInputHandler) {
      ctx.chatInputHandler(safe);
      return true;
    }
    return false;
  }
  const { sessions } = useSessionStore.getState();
  const ms = sessions.get(sessionId);
  if (!ms?.send || !ms.connected) return false;
  // Bracketed-paste so multiline text lands as one block.
  ms.send(wrapBracketedPaste(safe));
  return true;
}
