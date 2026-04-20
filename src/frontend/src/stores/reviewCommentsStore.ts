import { create } from 'zustand';
import type { ReviewComment, ReviewLineKind } from '@/utils/formatReviewComments';

const STORAGE_KEY_PREFIX = 'termbeam-review-comments';
const MAX_COMMENTS_PER_SESSION = 200;

function storageKey(sessionId: string): string {
  return `${STORAGE_KEY_PREFIX}:${sessionId}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function isValidLineKind(v: unknown): v is ReviewLineKind {
  return v === 'add' || v === 'remove' || v === 'context';
}

function isValidComment(v: unknown): v is ReviewComment {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.file === 'string' &&
    typeof o.startLine === 'number' &&
    typeof o.endLine === 'number' &&
    isValidLineKind(o.lineKind) &&
    typeof o.selectedText === 'string' &&
    typeof o.comment === 'string' &&
    typeof o.createdAt === 'number'
  );
}

function loadForSession(sessionId: string): ReviewComment[] {
  try {
    const raw = storage()?.getItem(storageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidComment);
    // Enforce cap on load — keep the newest MAX_COMMENTS_PER_SESSION.
    return valid.length > MAX_COMMENTS_PER_SESSION
      ? valid.slice(-MAX_COMMENTS_PER_SESSION)
      : valid;
  } catch {
    return [];
  }
}

function persistForSession(sessionId: string, comments: ReviewComment[]): void {
  try {
    const s = storage();
    if (!s) return;
    if (comments.length === 0) {
      s.removeItem(storageKey(sessionId));
    } else {
      s.setItem(storageKey(sessionId), JSON.stringify(comments));
    }
  } catch {
    // storage full or unavailable — silently drop persistence.
  }
}

export interface NewComment {
  file: string;
  startLine: number;
  endLine: number;
  lineKind: ReviewLineKind;
  selectedText: string;
  comment: string;
}

interface ReviewState {
  /** sessionId -> ordered comments (oldest first). */
  bySession: Map<string, ReviewComment[]>;
  /** Active session's review mode toggle. */
  reviewModeEnabled: Map<string, boolean>;

  load: (sessionId: string) => ReviewComment[];
  addComment: (sessionId: string, c: NewComment) => ReviewComment;
  updateComment: (sessionId: string, id: string, comment: string) => void;
  removeComment: (sessionId: string, id: string) => void;
  clearForSession: (sessionId: string) => void;
  getForSession: (sessionId: string) => ReviewComment[];
  getForFile: (sessionId: string, file: string) => ReviewComment[];
  setReviewMode: (sessionId: string, enabled: boolean) => void;
  isReviewMode: (sessionId: string) => boolean;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `rc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useReviewCommentsStore = create<ReviewState>((set, get) => ({
  bySession: new Map(),
  reviewModeEnabled: new Map(),

  load(sessionId) {
    const existing = get().bySession.get(sessionId);
    if (existing) return existing;
    const fromDisk = loadForSession(sessionId);
    set((s) => {
      const next = new Map(s.bySession);
      next.set(sessionId, fromDisk);
      return { bySession: next };
    });
    return fromDisk;
  },

  addComment(sessionId, c) {
    const now = Date.now();
    const comment: ReviewComment = {
      id: genId(),
      file: c.file,
      startLine: c.startLine,
      endLine: c.endLine,
      lineKind: c.lineKind,
      selectedText: c.selectedText,
      comment: c.comment,
      createdAt: now,
    };
    set((s) => {
      const next = new Map(s.bySession);
      const current = next.get(sessionId) ?? loadForSession(sessionId);
      const updated = [...current, comment].slice(-MAX_COMMENTS_PER_SESSION);
      next.set(sessionId, updated);
      persistForSession(sessionId, updated);
      return { bySession: next };
    });
    return comment;
  },

  updateComment(sessionId, id, body) {
    set((s) => {
      const next = new Map(s.bySession);
      const current = next.get(sessionId) ?? loadForSession(sessionId);
      const updated = current.map((c) => (c.id === id ? { ...c, comment: body } : c));
      next.set(sessionId, updated);
      persistForSession(sessionId, updated);
      return { bySession: next };
    });
  },

  removeComment(sessionId, id) {
    set((s) => {
      const next = new Map(s.bySession);
      const current = next.get(sessionId) ?? loadForSession(sessionId);
      const updated = current.filter((c) => c.id !== id);
      next.set(sessionId, updated);
      persistForSession(sessionId, updated);
      return { bySession: next };
    });
  },

  clearForSession(sessionId) {
    set((s) => {
      const next = new Map(s.bySession);
      next.set(sessionId, []);
      try {
        storage()?.removeItem(storageKey(sessionId));
      } catch {
        // ignore
      }
      return { bySession: next };
    });
  },

  getForSession(sessionId) {
    return get().bySession.get(sessionId) ?? loadForSession(sessionId);
  },

  getForFile(sessionId, file) {
    return get()
      .getForSession(sessionId)
      .filter((c) => c.file === file);
  },

  setReviewMode(sessionId, enabled) {
    set((s) => {
      const next = new Map(s.reviewModeEnabled);
      next.set(sessionId, enabled);
      return { reviewModeEnabled: next };
    });
  },

  isReviewMode(sessionId) {
    return get().reviewModeEnabled.get(sessionId) ?? false;
  },
}));
