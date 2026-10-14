import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { login, LoginError, type AuthStatus } from '@/services/api';
import { isCancellation, isPasskeyCapable, unlockWithPasskey } from '@/services/passkeys';
import styles from './UnlockForm.module.css';

export type UnlockMethod = 'password' | 'passkey';

interface UnlockFormProps {
  status: AuthStatus | null;
  onSuccess: (method: UnlockMethod) => void;
  /** Focus the password field on mount (desktop page). */
  autoFocus?: boolean;
  variant?: 'page' | 'sheet';
}

function KeyGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="4.25" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M11 11l8.5 8.5M16 16.5l2-2M18.5 19l2-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EyeGlyph({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.7" />
      {!open && (
        <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function UnlockForm({
  status,
  onSuccess,
  autoFocus = false,
  variant = 'page',
}: UnlockFormProps) {
  const passkeyReady =
    isPasskeyCapable() && !!status?.passkeys.enabled && !!status?.passkeys.registered;
  const [mode, setMode] = useState<UnlockMethod>(passkeyReady ? 'passkey' : 'password');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; tunnel?: boolean } | null>(null);
  const [shakes, setShakes] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = { pw: useId(), remember: useId(), err: useId() };

  // Status can arrive after mount — prefer passkey once we know it's available.
  useEffect(() => {
    if (passkeyReady) setMode((m) => (m === 'password' && !password ? 'passkey' : m));
  }, [passkeyReady, password]);

  useEffect(() => {
    if (mode === 'password' && autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [mode, autoFocus]);

  function showError(err: unknown) {
    if (err instanceof LoginError) {
      setError({ text: err.message, tunnel: err.kind === 'tunnel-auth' });
      if (err.kind === 'wrong-password') {
        setPassword('');
        setShakes((n) => n + 1);
        inputRef.current?.focus();
      }
      return;
    }
    setError({ text: 'Sign-in failed. Please try again.' });
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { ok } = await login(password, remember);
      if (ok) onSuccess('password');
      else setError({ text: 'Incorrect password' });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function usePasskey() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlockWithPasskey(remember);
      onSuccess('passkey');
    } catch (err) {
      if (!isCancellation(err)) {
        setError({
          text:
            err instanceof Error && err.message
              ? `${err.message}. You can use your password instead.`
              : 'Passkey sign-in failed. You can use your password instead.',
        });
        setMode('password');
      }
    } finally {
      setBusy(false);
    }
  }

  const insecure = typeof window !== 'undefined' && !window.isSecureContext;

  return (
    <div className={`${styles.form} ${variant === 'sheet' ? styles.sheet : ''}`}>
      {mode === 'passkey' ? (
        <>
          <button
            type="button"
            className={styles.primary}
            onClick={usePasskey}
            disabled={busy}
            data-testid="passkey-unlock"
          >
            <KeyGlyph />
            {busy ? 'Waiting for your device…' : 'Unlock with passkey'}
          </button>
          <p className={styles.hint}>Face ID, Touch ID, fingerprint or your device PIN.</p>
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              setError(null);
              setMode('password');
            }}
          >
            Use password instead
          </button>
        </>
      ) : (
        <form onSubmit={submitPassword} className={styles.passwordForm} noValidate>
          <label className={styles.label} htmlFor={ids.pw}>
            Password
          </label>
          <div
            className={styles.field}
            data-shake={shakes === 0 ? undefined : shakes % 2 ? 'a' : 'b'}
          >
            <input
              id={ids.pw}
              ref={inputRef}
              className={styles.input}
              type={reveal ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="From your computer's terminal"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ids.err : undefined}
              data-testid="login-password"
            />
            <button
              type="button"
              className={styles.reveal}
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              aria-pressed={reveal}
            >
              <EyeGlyph open={reveal} />
            </button>
          </div>
          <label className={styles.remember} htmlFor={ids.remember}>
            <span className={styles.rememberText}>
              Remember this device
              <span className={styles.rememberHint}>
                Stay signed in for 30 days. Turn off on shared devices.
              </span>
            </span>
            <input
              id={ids.remember}
              type="checkbox"
              role="switch"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span className={styles.switch} aria-hidden="true" />
          </label>
          <button
            type="submit"
            className={styles.primary}
            disabled={busy || !password}
            data-testid="login-submit"
          >
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
          {passkeyReady && (
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                setError(null);
                setMode('passkey');
              }}
            >
              Use a passkey instead
            </button>
          )}
        </form>
      )}

      {error && (
        <div className={styles.error} id={ids.err} role="alert">
          <span>{error.text}</span>
          {error.tunnel && (
            <button
              type="button"
              className={styles.errorAction}
              onClick={() => window.location.reload()}
            >
              Sign in again
            </button>
          )}
        </div>
      )}

      {insecure && (
        <p className={styles.note}>
          Passkeys need a secure address — open your HTTPS tunnel link or localhost to use Face ID
          or Touch ID.
        </p>
      )}
    </div>
  );
}

export default UnlockForm;
