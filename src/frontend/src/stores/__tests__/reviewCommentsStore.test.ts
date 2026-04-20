// @vitest-environment jsdom
import { describe, it, beforeEach, expect } from 'vitest';
import { useReviewCommentsStore } from '../reviewCommentsStore';

const SID = 'sess-1';

describe('reviewCommentsStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useReviewCommentsStore.setState({
      bySession: new Map(),
      reviewModeEnabled: new Map(),
    });
  });

  it('adds and lists comments for a session', () => {
    const s = useReviewCommentsStore.getState();
    const c = s.addComment(SID, {
      file: 'src/a.ts',
      startLine: 3,
      endLine: 3,
      lineKind: 'add',
      selectedText: '+x',
      comment: 'leaks',
    });
    expect(c.id).toBeTruthy();
    expect(useReviewCommentsStore.getState().getForSession(SID)).toHaveLength(1);
  });

  it('filters comments by file', () => {
    const s = useReviewCommentsStore.getState();
    s.addComment(SID, {
      file: 'a.ts',
      startLine: 1,
      endLine: 1,
      lineKind: 'add',
      selectedText: '+x',
      comment: 'x',
    });
    s.addComment(SID, {
      file: 'b.ts',
      startLine: 1,
      endLine: 1,
      lineKind: 'add',
      selectedText: '+y',
      comment: 'y',
    });
    expect(useReviewCommentsStore.getState().getForFile(SID, 'a.ts')).toHaveLength(1);
    expect(useReviewCommentsStore.getState().getForFile(SID, 'b.ts')).toHaveLength(1);
  });

  it('removes comments by id', () => {
    const s = useReviewCommentsStore.getState();
    const c = s.addComment(SID, {
      file: 'a.ts',
      startLine: 1,
      endLine: 1,
      lineKind: 'add',
      selectedText: '+x',
      comment: 'x',
    });
    useReviewCommentsStore.getState().removeComment(SID, c.id);
    expect(useReviewCommentsStore.getState().getForSession(SID)).toHaveLength(0);
  });

  it('updates a comment body', () => {
    const s = useReviewCommentsStore.getState();
    const c = s.addComment(SID, {
      file: 'a.ts',
      startLine: 1,
      endLine: 1,
      lineKind: 'add',
      selectedText: '+x',
      comment: 'old',
    });
    useReviewCommentsStore.getState().updateComment(SID, c.id, 'new body');
    expect(useReviewCommentsStore.getState().getForSession(SID)[0]?.comment).toBe('new body');
  });

  it('clears all for session', () => {
    const s = useReviewCommentsStore.getState();
    s.addComment(SID, {
      file: 'a.ts',
      startLine: 1,
      endLine: 1,
      lineKind: 'add',
      selectedText: '+x',
      comment: 'x',
    });
    useReviewCommentsStore.getState().clearForSession(SID);
    expect(useReviewCommentsStore.getState().getForSession(SID)).toHaveLength(0);
  });

  it('persists across reload via sessionStorage', () => {
    const s = useReviewCommentsStore.getState();
    s.addComment(SID, {
      file: 'a.ts',
      startLine: 1,
      endLine: 1,
      lineKind: 'add',
      selectedText: '+x',
      comment: 'x',
    });
    // Simulate reload by clearing in-memory state only.
    useReviewCommentsStore.setState({
      bySession: new Map(),
      reviewModeEnabled: new Map(),
    });
    expect(useReviewCommentsStore.getState().load(SID)).toHaveLength(1);
  });

  it('toggles review mode per session', () => {
    const s = useReviewCommentsStore.getState();
    expect(s.isReviewMode(SID)).toBe(false);
    s.setReviewMode(SID, true);
    expect(useReviewCommentsStore.getState().isReviewMode(SID)).toBe(true);
  });
});
