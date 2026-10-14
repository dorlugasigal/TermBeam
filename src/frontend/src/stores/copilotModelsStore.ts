import { useEffect } from 'react';
import { create } from 'zustand';
import { fetchCopilotModels, type CopilotModel } from '@/services/api';

// The server refreshes its own copy every 30 min; re-asking every 10 keeps a
// long-lived tab in step without polling.
const REFRESH_MS = 10 * 60 * 1000;

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface CopilotModelsState {
  models: CopilotModel[];
  status: Status;
  fetchedAt: number;
  load: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useCopilotModelsStore = create<CopilotModelsState>((set, get) => ({
  models: [],
  status: 'idle',
  fetchedAt: 0,
  load: () => {
    if (inflight) return inflight;
    const { status, fetchedAt, models } = get();
    if (status === 'ready' && Date.now() - fetchedAt < REFRESH_MS) return Promise.resolve();
    if (!models.length) set({ status: 'loading' });
    inflight = fetchCopilotModels()
      .then((next) => set({ models: next, status: 'ready', fetchedAt: Date.now() }))
      // Keep showing a list we already have; otherwise fall back to "Copilot default".
      .catch(() => set((s) => ({ status: s.models.length ? 'ready' : 'error' })))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },
}));

/**
 * Copilot's model list, loaded on first use. Long-lived pickers (the Copilot
 * pane keeps one mounted) also re-check when the app regains focus or comes
 * back online — `load()` only fetches when the list is missing or stale.
 */
export function useCopilotModels(enabled = true): {
  models: CopilotModel[];
  status: Status;
  refresh: () => void;
} {
  const models = useCopilotModelsStore((s) => s.models);
  const status = useCopilotModelsStore((s) => s.status);
  const load = useCopilotModelsStore((s) => s.load);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, load]);
  return { models, status, refresh: () => void load() };
}
