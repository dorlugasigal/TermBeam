import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConnectionStore } from '@/stores/connectionStore';
import { fetchAuthStatus, type AuthStatus } from '@/services/api';
import { UnlockForm } from '@/components/LoginPage/UnlockForm';
import { Sheet } from '@/components/common/Sheet';

/**
 * In-place re-authentication: the app (terminals, tabs, split, drafts) stays
 * mounted underneath; unlocking just resumes the paused sockets.
 */
export function UnlockSheet() {
  const open = useConnectionStore((s) => s.unlockOpen);
  const closeUnlock = useConnectionStore((s) => s.closeUnlock);
  const unlocked = useConnectionStore((s) => s.unlocked);
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchAuthStatus().then((st) => {
      if (cancelled) return;
      setStatus(st);
      // Signed in again elsewhere (another tab) — nothing to ask.
      if (st?.authenticated) unlocked();
    });
    return () => {
      cancelled = true;
    };
  }, [open, unlocked]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && closeUnlock()}
      size="sm"
      layer="system"
      testId="unlock-sheet"
      title="Unlock TermBeam"
      description="Your terminals kept running. Unlock to pick up right where you left off."
    >
      <UnlockForm
        status={status}
        variant="sheet"
        onSuccess={() => {
          unlocked();
          toast.success('Unlocked — reconnecting your terminals');
        }}
      />
    </Sheet>
  );
}

export default UnlockSheet;
