import { describe, it, beforeEach, expect, vi } from 'vitest';

vi.mock('@/services/api', () => ({
  fetchCopilotModels: vi.fn(),
}));

import { fetchCopilotModels } from '@/services/api';
import { useCopilotModelsStore } from '../copilotModelsStore';

const fetchModels = fetchCopilotModels as unknown as ReturnType<typeof vi.fn>;
const LIST = [{ id: 'gpt-5.5', name: 'GPT-5.5' }];

describe('copilotModelsStore', () => {
  beforeEach(() => {
    fetchModels.mockReset();
    useCopilotModelsStore.setState({ models: [], status: 'idle', fetchedAt: 0 });
  });

  it('loads once and shares an in-flight request', async () => {
    fetchModels.mockResolvedValue(LIST);
    const { load } = useCopilotModelsStore.getState();
    await Promise.all([load(), load()]);
    await load(); // fresh: answered from the store
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(useCopilotModelsStore.getState()).toMatchObject({ models: LIST, status: 'ready' });
  });

  it('refetches once the list is stale', async () => {
    fetchModels.mockResolvedValueOnce(LIST).mockResolvedValueOnce([]);
    await useCopilotModelsStore.getState().load();
    useCopilotModelsStore.setState({ fetchedAt: 0 });
    await useCopilotModelsStore.getState().load();
    expect(fetchModels).toHaveBeenCalledTimes(2);
    expect(useCopilotModelsStore.getState().models).toEqual([]);
  });

  it('reports an error when nothing could be loaded, and retries next time', async () => {
    fetchModels.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(LIST);
    await useCopilotModelsStore.getState().load();
    expect(useCopilotModelsStore.getState().status).toBe('error');
    await useCopilotModelsStore.getState().load();
    expect(useCopilotModelsStore.getState()).toMatchObject({ models: LIST, status: 'ready' });
  });

  it('keeps showing a loaded list when a refresh fails', async () => {
    fetchModels.mockResolvedValueOnce(LIST).mockRejectedValueOnce(new Error('offline'));
    await useCopilotModelsStore.getState().load();
    useCopilotModelsStore.setState({ fetchedAt: 0 });
    await useCopilotModelsStore.getState().load();
    expect(useCopilotModelsStore.getState()).toMatchObject({ models: LIST, status: 'ready' });
  });
});
