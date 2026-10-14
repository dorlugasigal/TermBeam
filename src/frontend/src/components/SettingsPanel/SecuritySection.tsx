import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  deletePasskey,
  fetchAuthDevices,
  fetchAuthStatus,
  fetchPasskeys,
  logout,
  renamePasskey,
  revokeAuthDevice,
  revokeOtherDevices,
  type AuthDevice,
  type AuthStatus,
  type PasskeyInfo,
} from '@/services/api';
import {
  forgetLocalPasskey,
  isCancellation,
  isPasskeyCapable,
  registerPasskey,
} from '@/services/passkeys';
import styles from './SecuritySection.module.css';

function timeAgo(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function timeUntil(ts: number): string {
  const s = Math.max(0, Math.round((ts - Date.now()) / 1000));
  const h = Math.round(s / 3600);
  if (h < 36) return `${Math.max(1, h)}h`;
  return `${Math.round(h / 24)}d`;
}

function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function DeviceGlyph({ device }: { device: string }) {
  const handheld = /iPhone|iPad|Android/.test(device);
  return handheld ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect
        x="6.5"
        y="2.5"
        width="11"
        height="19"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="11.5"
        rx="1.8"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M2 19.5h20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const METHOD_LABEL: Record<string, string> = {
  password: 'Password',
  qr: 'QR code',
  passkey: 'Passkey',
};

type Load<T> =
  { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

export default function SecuritySection() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [devices, setDevices] = useState<Load<AuthDevice[]>>({ state: 'loading' });
  const [passkeys, setPasskeys] = useState<Load<PasskeyInfo[]>>({ state: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    void fetchAuthStatus().then(setStatus);
    fetchAuthDevices()
      .then((data) => setDevices({ state: 'ready', data }))
      .catch((e: Error) => setDevices({ state: 'error', message: e.message }));
    fetchPasskeys()
      .then((data) => setPasskeys({ state: 'ready', data }))
      .catch((e: Error) => setPasskeys({ state: 'error', message: e.message }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (status && !status.passwordRequired) {
    return (
      <p className={styles.empty}>
        Authentication is off. Start TermBeam with a password (the default) to use passkeys and
        manage signed-in devices.
      </p>
    );
  }

  const canAddPasskey = isPasskeyCapable() && !!status?.passkeys.enabled;
  const passkeyHint = !window.isSecureContext
    ? 'Passkeys need your HTTPS tunnel link or localhost.'
    : !isPasskeyCapable()
      ? 'This browser does not support passkeys.'
      : status && !status.passkeys.enabled
        ? 'Passkeys are not available on this address.'
        : 'Unlock with Face ID, Touch ID, fingerprint or your device PIN.';

  async function addPasskey() {
    setBusy('add');
    try {
      const pk = await registerPasskey();
      toast.success(`Passkey "${pk.name}" added`);
      void refresh();
    } catch (err) {
      if ((err as { name?: string })?.name === 'InvalidStateError') {
        toast.info('This device already has a passkey for TermBeam');
      } else if (!isCancellation(err)) {
        toast.error(err instanceof Error ? err.message : 'Could not add passkey');
      }
    } finally {
      setBusy(null);
    }
  }

  async function rename(pk: PasskeyInfo) {
    const name = (window.prompt('Rename passkey', pk.name) ?? '').trim();
    if (!name || name === pk.name) return;
    try {
      await renamePasskey(pk.id, name);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    }
  }

  async function removePasskey(pk: PasskeyInfo) {
    if (!window.confirm(`Remove passkey "${pk.name}"? Devices signed in with it are signed out.`)) {
      return;
    }
    setBusy(pk.id);
    try {
      await deletePasskey(pk.id);
      const remaining =
        passkeys.state === 'ready' ? passkeys.data.filter((p) => p.id !== pk.id) : [];
      if (!remaining.some((p) => p.rpId === window.location.hostname)) forgetLocalPasskey();
      toast.success('Passkey removed');
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove passkey');
    } finally {
      setBusy(null);
    }
  }

  async function signOutDevice(d: AuthDevice) {
    const label = d.current ? 'this device' : d.device;
    if (!window.confirm(`Sign out ${label}? Its terminals keep running.`)) return;
    setBusy(d.id);
    try {
      await revokeAuthDevice(d.id);
      if (d.current) {
        window.location.assign('/login');
        return;
      }
      toast.success(`Signed out ${d.device}`);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign out device');
    } finally {
      setBusy(null);
    }
  }

  async function signOutEverywhere() {
    if (
      !window.confirm(
        'Sign out every device, including this one? Running terminals keep running. Passkeys stay registered.',
      )
    ) {
      return;
    }
    setBusy('all');
    try {
      await revokeOtherDevices();
      await logout();
      window.location.assign('/login');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-out not confirmed — retry');
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy('self');
    await logout();
    window.location.assign('/login');
  }

  return (
    <div className={styles.root} data-testid="security-section">
      <div className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Passkeys</span>
          <span className={styles.groupHint}>{passkeyHint}</span>
        </div>
        {passkeys.state === 'loading' && <p className={styles.muted}>Loading…</p>}
        {passkeys.state === 'error' && (
          <p className={styles.error}>Couldn’t load passkeys: {passkeys.message}</p>
        )}
        {passkeys.state === 'ready' && passkeys.data.length === 0 && (
          <p className={styles.muted}>No passkeys yet.</p>
        )}
        {passkeys.state === 'ready' && passkeys.data.length > 0 && (
          <ul className={styles.list}>
            {passkeys.data.map((pk) => (
              <li key={pk.id} className={styles.item}>
                <span className={styles.itemGlyph} aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="8" cy="8" r="4.25" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="M11 11l8.5 8.5M16 16.5l2-2M18.5 19l2-2"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className={styles.itemText}>
                  <span className={styles.itemName}>
                    {pk.name}
                    {pk.synced && <span className={styles.badge}>Synced</span>}
                  </span>
                  <span className={styles.itemMeta}>
                    Added {shortDate(pk.createdAt)} · used {timeAgo(pk.lastUsedAt)}
                    {pk.rpId !== window.location.hostname && ` · ${pk.rpId}`}
                  </span>
                </span>
                <span className={styles.itemActions}>
                  <button type="button" className={styles.textBtn} onClick={() => rename(pk)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className={`${styles.textBtn} ${styles.danger}`}
                    onClick={() => removePasskey(pk)}
                    disabled={busy === pk.id}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className={styles.addBtn}
          onClick={addPasskey}
          disabled={!canAddPasskey || busy === 'add'}
          data-testid="add-passkey"
        >
          {busy === 'add' ? 'Waiting for your device…' : 'Add a passkey for this device'}
        </button>
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Signed-in devices</span>
          <span className={styles.groupHint}>
            Remembered devices stay signed in for up to 30 days, or 7 days without use.
          </span>
        </div>
        {devices.state === 'loading' && <p className={styles.muted}>Loading…</p>}
        {devices.state === 'error' && (
          <p className={styles.error}>Couldn’t load devices: {devices.message}</p>
        )}
        {devices.state === 'ready' && devices.data.length === 0 && (
          <p className={styles.muted}>No browser sessions.</p>
        )}
        {devices.state === 'ready' && devices.data.length > 0 && (
          <ul className={styles.list}>
            {devices.data.map((d) => (
              <li key={d.id} className={styles.item} data-current={d.current || undefined}>
                <span className={styles.itemGlyph} aria-hidden="true">
                  <DeviceGlyph device={d.device} />
                </span>
                <span className={styles.itemText}>
                  <span className={styles.itemName}>
                    {d.device}
                    {d.current && <span className={styles.badgeAccent}>This device</span>}
                  </span>
                  <span className={styles.itemMeta}>
                    {METHOD_LABEL[d.method] ?? d.method} · seen {timeAgo(d.lastSeenAt)} ·{' '}
                    {d.remember ? `expires in ${timeUntil(d.expiresAt)}` : 'this browser session'}
                    {d.ip && ` · ${d.ip}`}
                  </span>
                </span>
                <span className={styles.itemActions}>
                  <button
                    type="button"
                    className={`${styles.textBtn} ${styles.danger}`}
                    onClick={() => signOutDevice(d)}
                    disabled={busy === d.id}
                  >
                    Sign out
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.secondaryBtn} onClick={signOut} disabled={!!busy}>
          Sign out
        </button>
        <button
          type="button"
          className={`${styles.secondaryBtn} ${styles.dangerBtn}`}
          onClick={signOutEverywhere}
          disabled={!!busy}
        >
          Sign out everywhere
        </button>
      </div>
    </div>
  );
}
