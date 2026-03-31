import { create } from 'zustand';

export type TunnelState =
  | { kind: 'hidden' }
  | { kind: 'disconnected'; provider?: string }
  | { kind: 'reconnecting' }
  | { kind: 'failed' };

interface TunnelStore {
  state: TunnelState;
  setState: (state: TunnelState) => void;
}

export const useTunnelStore = create<TunnelStore>((set) => ({
  state: { kind: 'hidden' },
  setState: (state) => set({ state }),
}));
