import { toast } from 'sonner';
import { useConnectionStore, type TunnelStatus } from '@/stores/connectionStore';
import { describeLink } from './copy';
import { useSecondsLeft } from './ConnectionPill';
import { Breakable } from '@/components/common/Breakable';
import { Sheet } from '@/components/common/Sheet';
import form from '@/styles/forms.module.css';
import styles from './Sheets.module.css';

interface TunnelNote {
  title: string;
  body: string;
  command?: string;
  url?: string;
}

function tunnelNote(t: TunnelStatus | null): TunnelNote | null {
  if (!t) return null;
  switch (t.state) {
    case 'connected':
      return t.urlChanged && t.url && /^https?:\/\//i.test(t.url)
        ? {
            title: 'Remote address changed',
            body: 'Your computer had to create a new tunnel. Other devices need the new link.',
            url: t.url,
          }
        : null;
    case 'reconnecting':
    case 'disconnected':
      return {
        title: 'Remote access is reconnecting',
        body: 'The tunnel on your computer is reconnecting. This connection still works.',
      };
    case 'waiting-network':
      return {
        title: 'Remote access paused',
        body: 'Your computer lost its internet connection. The tunnel resumes on its own.',
      };
    case 'auth-expired':
      return {
        title: 'Tunnel login expired on your computer',
        body: 'Remote devices can’t connect until you sign in again on the host:',
        command: 'devtunnel user login',
      };
    case 'failed':
      return {
        title: 'Remote access couldn’t reconnect',
        body: 'TermBeam keeps retrying in the background.',
      };
    default:
      return null;
  }
}

/** Expanded explanation + the one action that helps, for the current link state. */
export function ConnectionSheet() {
  const open = useConnectionStore((s) => s.sheetOpen);
  const kind = useConnectionStore((s) => s.kind);
  const rttMs = useConnectionStore((s) => s.rttMs);
  const attempt = useConnectionStore((s) => s.attempt);
  const nextRetryAt = useConnectionStore((s) => s.nextRetryAt);
  const phase = useConnectionStore((s) => s.updatingPhase);
  const tunnel = useConnectionStore((s) => s.tunnel);
  const diagnosing = useConnectionStore((s) => s.diagnosing);
  const closeSheet = useConnectionStore((s) => s.closeSheet);
  const retryNow = useConnectionStore((s) => s.retryNow);
  const openUnlock = useConnectionStore((s) => s.openUnlock);
  const secondsLeft = useSecondsLeft(nextRetryAt);

  const copy = describeLink(kind, { rttMs, attempt, secondsLeft, phase });
  const note = tunnelNote(tunnel);
  const linked = kind === 'online';
  const retryable = kind === 'reconnecting' || kind === 'host-unreachable' || kind === 'offline';

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('New link copied');
    } catch {
      toast.error('Could not copy — long-press the link instead');
    }
  }

  const facts: Array<[string, string, boolean?]> = [['Address', window.location.host, true]];
  if (linked && rttMs !== null) facts.push(['Latency', `${rttMs} ms`]);
  if (retryable) {
    facts.push(['Next try', diagnosing ? 'Checking…' : secondsLeft ? `In ${secondsLeft}s` : 'Now']);
  }
  if (attempt > 1 && !linked) facts.push(['Attempts', String(attempt)]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && closeSheet()}
      size="sm"
      layer="system"
      testId="connection-sheet"
      title={
        <span className={styles.statusTitle}>
          <i className={styles.statusDot} data-tone={copy.tone} aria-hidden="true" />
          {copy.title}
        </span>
      }
      description={copy.body}
      footer={
        <>
          <button
            type="button"
            className={`${form.btn} ${form.tonal} ${form.grow}`}
            onClick={closeSheet}
          >
            {linked ? 'Done' : 'Close'}
          </button>
          {retryable && (
            <button
              type="button"
              className={`${form.btn} ${form.primary} ${form.grow}`}
              onClick={retryNow}
              disabled={diagnosing}
            >
              {diagnosing ? 'Checking…' : kind === 'offline' ? 'Try again' : 'Retry now'}
            </button>
          )}
          {kind === 'tunnel-auth' && (
            <button
              type="button"
              className={`${form.btn} ${form.primary} ${form.grow}`}
              onClick={() => window.location.reload()}
            >
              Sign in again
            </button>
          )}
          {kind === 'auth-expired' && (
            <button
              type="button"
              className={`${form.btn} ${form.primary} ${form.grow}`}
              onClick={openUnlock}
            >
              Unlock
            </button>
          )}
        </>
      }
    >
      <div className={styles.stack}>
        <dl className={styles.facts}>
          {facts.map(([term, value, mono]) => (
            <div key={term} className={styles.fact}>
              <dt>{term}</dt>
              <dd data-mono={mono || undefined}>{value}</dd>
            </div>
          ))}
        </dl>

        {note && (
          <div className={styles.note} role="note">
            <span className={styles.noteTitle}>{note.title}</span>
            <span className={styles.noteBody}>{note.body}</span>
            {note.command && <code className={styles.code}>{note.command}</code>}
            {note.url && (
              <>
                {/* Shown as a real link: tap to open the new address, or
                    long-press / select it where the clipboard is unavailable. */}
                <a className={styles.noteLink} href={note.url} rel="noreferrer">
                  <Breakable text={note.url} />
                </a>
                <button
                  type="button"
                  className={`${form.btn} ${form.tonal} ${styles.noteAction}`}
                  onClick={() => copyLink(note.url!)}
                >
                  Copy new link
                </button>
              </>
            )}
          </div>
        )}

        {!linked && kind !== 'connecting' && (
          <button
            type="button"
            className={`${form.btn} ${form.quiet} ${styles.reload}`}
            onClick={() => window.location.reload()}
          >
            Still stuck? Reload TermBeam
          </button>
        )}
      </div>
    </Sheet>
  );
}

export default ConnectionSheet;
