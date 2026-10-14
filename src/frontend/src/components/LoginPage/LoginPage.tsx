import { useState } from 'react';
import { Wordmark } from '@/components/common/Wordmark';
import ThemePicker from '@/components/common/ThemePicker';
import type { AuthStatus } from '@/services/api';
import { UnlockForm, type UnlockMethod } from './UnlockForm';
import styles from './LoginPage.module.css';

interface LoginPageProps {
  status: AuthStatus | null;
  onSignedIn: (method: UnlockMethod) => void;
}

/** Hand the app over after the panel has had a moment to leave. */
const EXIT_MS = 280;

function describeHost(): { kind: string; secure: boolean } {
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return { kind: 'This computer', secure: true };
  }
  if (hostname.endsWith('.devtunnels.ms')) return { kind: 'Secure tunnel', secure: true };
  return protocol === 'https:'
    ? { kind: 'Secure link', secure: true }
    : { kind: 'Local network', secure: false };
}

const LockGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="currentColor" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="2.4" />
  </svg>
);

const ThemeGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.45-.17-.83-.43-1.12a1.6 1.6 0 0 1 1.2-2.7h1.9A4.73 4.73 0 0 0 21 10.84C21 6.5 17 3 12 3Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
    <circle cx="10.5" cy="7" r="1.2" fill="currentColor" />
    <circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
  </svg>
);

export default function LoginPage({ status, onSignedIn }: LoginPageProps) {
  const [themeOpen, setThemeOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isTouch =
    typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  const host = describeHost();

  const handleSuccess = (method: UnlockMethod) => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setLeaving(true);
    window.setTimeout(() => onSignedIn(method), reduced ? 0 : EXIT_MS);
  };

  return (
    <div className={styles.page} data-testid="login-page" data-leaving={leaving || undefined}>
      <header className={styles.top}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setThemeOpen(true)}
          aria-label="Switch theme"
          title="Theme"
        >
          <ThemeGlyph />
        </button>
      </header>

      <main className={styles.main}>
        <div className={styles.brand}>
          <Wordmark size="md" className={styles.wordmark} />
        </div>

        <section className={styles.panel} aria-labelledby="login-title">
          <div className={styles.heading}>
            <h1 id="login-title" className={styles.title}>
              Unlock TermBeam
            </h1>
            <p className={styles.host}>
              <span className={styles.hostKind} data-secure={host.secure || undefined}>
                {host.secure && <LockGlyph />}
                {host.kind}
              </span>
              <span className={styles.hostName}>{window.location.host}</span>
            </p>
          </div>
          <UnlockForm status={status} onSuccess={handleSuccess} autoFocus={!isTouch} />
        </section>
      </main>

      <ThemePicker open={themeOpen} onClose={() => setThemeOpen(false)} hideTrigger />
    </div>
  );
}
