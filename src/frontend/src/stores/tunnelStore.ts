import { create } from 'zustand';

export type TunnelState =
  | { kind: 'hidden' }
  | { kind: 'expiring'; expiresIn: number; provider?: string }
  | { kind: 'expired'; provider?: string }
  | { kind: 'renewing'; url: string; code: string }
  | { kind: 'renewed' }
  | { kind: 'failed' };

interface TunnelStore {
  state: TunnelState;
  setState: (state: TunnelState) => void;
}

export const useTunnelStore = create<TunnelStore>((set) => ({
  state: { kind: 'hidden' },
  setState: (state) => set({ state }),
}));
