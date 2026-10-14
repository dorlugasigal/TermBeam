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

/** Copilot's model list, loaded on first use and refreshed when stale. */
export function useCopilotModels(enabled = true): { models: CopilotModel[]; status: Status } {
  const models = useCopilotModelsStore((s) => s.models);
  const status = useCopilotModelsStore((s) => s.status);
  const load = useCopilotModelsStore((s) => s.load);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  return { models, status };
}
