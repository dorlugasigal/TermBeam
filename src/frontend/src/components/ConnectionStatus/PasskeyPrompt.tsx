import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { AuthStatus } from '@/services/api';
import {
  hasLocalPasskey,
  hasPlatformAuthenticator,
  isCancellation,
  isPasskeyCapable,
  isPromptSnoozed,
  registerPasskey,
  snoozePrompt,
} from '@/services/passkeys';
import { Sheet } from '@/components/common/Sheet';
import form from '@/styles/forms.module.css';
import styles from './Sheets.module.css';

const CheckGlyph = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

interface PasskeyPromptProps {
  /** How the user just signed in ('password' | 'qr'), or null. */
  method: string | null;
  status: AuthStatus | null;
  onDone: () => void;
}

/**
 * One-time, non-blocking offer after a password / QR sign-in: register a
 * passkey so the next unlock is a single Face ID / Touch ID tap.
 */
export function PasskeyPrompt({ method, status, onDone }: PasskeyPromptProps) {
  const [platform, setPlatform] = useState<boolean | null>(null);
  useEffect(() => {
    if (!method) return;
    let cancelled = false;
    void hasPlatformAuthenticator().then((ok) => {
      if (!cancelled) setPlatform(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [method]);

  const eligible =
    platform === true &&
    !!method &&
    method !== 'passkey' &&
    !!status?.passwordRequired &&
    !!status?.passkeys.enabled &&
    isPasskeyCapable() &&
    !hasLocalPasskey() &&
    !isPromptSnoozed();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!method || !status || platform === null) return;
    if (!eligible) {
      onDone();
      return;
    }
    const id = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(id);
  }, [eligible, method, status, platform, onDone]);

  function finish() {
    setOpen(false);
    onDone();
  }

  async function add() {
    setBusy(true);
    try {
      await registerPasskey();
      toast.success('Passkey added — next time, unlock with Face ID, Touch ID or your PIN.');
      finish();
    } catch (err) {
      if ((err as { name?: string })?.name === 'InvalidStateError') {
        toast.info('This device already has a passkey for TermBeam.');
        finish();
      } else if (!isCancellation(err)) {
        toast.error(err instanceof Error ? err.message : 'Could not add a passkey');
      }
    } finally {
      setBusy(false);
    }
  }

  const dismiss = () => {
    snoozePrompt();
    finish();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && dismiss()}
      size="sm"
      testId="passkey-prompt"
      title="Unlock with a passkey next time?"
      description="Skip the password: confirm with Face ID, Touch ID, a fingerprint or your device PIN."
      footer={
        <>
          <button
            type="button"
            className={`${form.btn} ${form.tonal} ${form.grow}`}
            onClick={dismiss}
          >
            Not now
          </button>
          <button
            type="button"
            className={`${form.btn} ${form.primary} ${form.grow}`}
            onClick={add}
            disabled={busy}
          >
            {busy ? 'Waiting for your device…' : 'Add passkey'}
          </button>
        </>
      }
    >
      <ul className={styles.benefits}>
        <li>
          <CheckGlyph />
          Phishing-resistant: it only works for this TermBeam, which stores just a public key.
        </li>
        <li>
          <CheckGlyph />
          Keeps working after TermBeam restarts or the password changes.
        </li>
        <li>
          <CheckGlyph />
          Remove it any time in Settings › Security.
        </li>
      </ul>
    </Sheet>
  );
}

export default PasskeyPrompt;
