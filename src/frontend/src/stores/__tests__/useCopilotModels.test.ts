// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  fetchCopilotModels: vi.fn(),
}));

import { fetchCopilotModels } from '@/services/api';
import { useCopilotModels, useCopilotModelsStore } from '../copilotModelsStore';

const fetchModels = fetchCopilotModels as unknown as ReturnType<typeof vi.fn>;
const LIST = [{ id: 'gpt-5.5', name: 'GPT-5.5' }];

describe('useCopilotModels', () => {
  beforeEach(() => {
    fetchModels.mockReset();
    useCopilotModelsStore.setState({ models: [], status: 'idle', fetchedAt: 0 });
  });

  // No vitest globals here, so Testing Library can't register its own cleanup.
  afterEach(cleanup);

  it('retries a failed load when the app comes back online or regains focus', async () => {
    fetchModels
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValueOnce(LIST);
    const { result } = renderHook(() => useCopilotModels());
    await waitFor(() => expect(result.current.status).toBe('error'));

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(2));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(result.current.models).toEqual(LIST));
    expect(result.current.status).toBe('ready');
  });

  it('does not refetch a fresh list, and stops listening when unmounted', async () => {
    fetchModels.mockResolvedValue(LIST);
    const { result, unmount } = renderHook(() => useCopilotModels());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      result.current.refresh();
    });
    expect(fetchModels).toHaveBeenCalledTimes(1);

    unmount();
    useCopilotModelsStore.setState({ fetchedAt: 0 }); // stale, but nobody is listening
    window.dispatchEvent(new Event('focus'));
    expect(fetchModels).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', () => {
    renderHook(() => useCopilotModels(false));
    window.dispatchEvent(new Event('focus'));
    expect(fetchModels).not.toHaveBeenCalled();
  });
});
