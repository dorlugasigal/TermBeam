import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useThemeStore } from '@/stores/themeStore';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';
import { deleteSession, renameSession, fetchVersion, getShareUrl } from '@/services/api';
import { playNotificationSound, setNotificationsEnabled } from '@/services/audio';
import { isPushSubscribedSync } from '@/services/pushSubscription';
import { AboutModal } from '@/components/Modals/AboutModal';
import styles from './CommandPalette.module.css';

/* ---------- inline SVG icons (16×16, stroke-based) ---------- */

const iconNewTab = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <line x1="8" y1="5" x2="8" y2="11" />
    <line x1="5" y1="8" x2="11" y2="8" />
  </svg>
);

const iconUpload = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
    <polyline points="5 5 8 2 11 5" />
    <line x1="8" y1="2" x2="8" y2="10" />
  </svg>
);

const iconDownload = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
    <polyline points="5 11 8 14 11 11" />
    <line x1="8" y1="14" x2="8" y2="6" />
  </svg>
);

const iconMarkdown = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="1" y="3" width="14" height="10" rx="2" />
    <polyline points="4 9 5.5 7 7 9" />
    <line x1="9" y1="9" x2="9" y2="7" />
    <polyline points="9 7 10.5 8.5 12 7" />
  </svg>
);

const iconCloseTab = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
    <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" />
  </svg>
);

const iconRename = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M11 2l3 3-8 8H3v-3z" />
    <line x1="9" y1="4" x2="12" y2="7" />
  </svg>
);

const iconSplit = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <line x1="8" y1="2" x2="8" y2="14" />
  </svg>
);

const iconSplitHorizontal = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <line x1="2" y1="8" x2="14" y2="8" />
  </svg>
);

const iconSplitOff = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="2" width="12" height="12" rx="2" />
  </svg>
);

const iconStop = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="10" height="10" rx="1" />
  </svg>
);

const iconSearch = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="7" cy="7" r="4" />
    <line x1="10" y1="10" x2="14" y2="14" />
  </svg>
);

const iconFontUp = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 13L8 3l5 10" />
    <line x1="5" y1="9" x2="11" y2="9" />
    <line x1="13" y1="5" x2="13" y2="1" />
    <line x1="11" y1="3" x2="15" y2="3" />
  </svg>
);

const iconFontDown = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 13L8 3l5 10" />
    <line x1="5" y1="9" x2="11" y2="9" />
    <line x1="11" y1="3" x2="15" y2="3" />
  </svg>
);

const iconTheme = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="8" cy="8" r="6" />
    <path d="M8 2a6 6 0 000 12z" fill="currentColor" opacity=".3" />
  </svg>
);

const iconPreview = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="1" y="3" width="14" height="10" rx="2" />
    <line x1="5" y1="13" x2="11" y2="13" />
    <line x1="8" y1="13" x2="8" y2="15" />
  </svg>
);

const iconCopyLink = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6.5 9.5a3 3 0 004 .5l2-2a3 3 0 00-4.24-4.24L7 5" />
    <path d="M9.5 6.5a3 3 0 00-4-.5l-2 2a3 3 0 004.24 4.24L9 11" />
  </svg>
);

const iconBell = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 6a4 4 0 018 0c0 4 2 5 2 5H2s2-1 2-5" />
    <path d="M6.5 13a1.5 1.5 0 003 0" />
  </svg>
);

const iconCode = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="5 4 1 8 5 12" />
    <polyline points="11 4 15 8 11 12" />
    <line x1="9" y1="2" x2="7" y2="14" />
  </svg>
);

const iconGitChanges = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="4" cy="4" r="2" />
    <circle cx="4" cy="12" r="2" />
    <circle cx="12" cy="8" r="2" />
    <path d="M4 6v4" />
    <path d="M6 4.5c3 0 4 1.5 4 3.5" />
  </svg>
);

const iconRefresh = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 8a6 6 0 0110.47-4" />
    <polyline points="12 1 13 4 10 5" />
    <path d="M14 8a6 6 0 01-10.47 4" />
    <polyline points="4 15 3 12 6 11" />
  </svg>
);

const iconClear = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 4h10" />
    <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" />
    <path d="M4 4l1 10a1 1 0 001 1h4a1 1 0 001-1l1-10" />
  </svg>
);

const iconAbout = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="8" cy="8" r="6" />
    <line x1="8" y1="7" x2="8" y2="11" />
    <circle cx="8" cy="5" r=".5" fill="currentColor" />
  </svg>
);

/* ---------- clipboard fallback for non-secure (HTTP) contexts ---------- */

function fallbackCopy(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    toast.success('URL copied to clipboard');
  } catch {
    toast.error('Failed to copy URL');
  }
  document.body.removeChild(textarea);
}

/* ---------- component ---------- */

export default function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const close = useUIStore((s) => s.closeCommandPalette);
  const [showThemes, setShowThemes] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(
    () => localStorage.getItem('termbeam-notifications') !== 'false',
  );
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutVersion, setAboutVersion] = useState('');
  const [pushActive, setPushActive] = useState(() => isPushSubscribedSync());

  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const themeName = themeId.charAt(0).toUpperCase() + themeId.slice(1);

  // Animate open: render always, toggle class
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) {
      // Force a reflow before adding the open class so the transition fires
      requestAnimationFrame(() => setMounted(true));
      // Refresh push status when palette opens
      import('@/services/pushSubscription').then(({ isPushSubscribed }) => {
        isPushSubscribed().then(setPushActive).catch(() => {});
      });
    } else {
      setMounted(false);
    }
  }, [open]);

  const run = useCallback(
    (fn: () => void) => {
      fn();
      close();
      setShowThemes(false);
    },
    [close],
  );

  if (!open) {
    return (
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} version={aboutVersion} />
    );
  }

  const panelCls = `${styles.panel} ${mounted ? styles.panelOpen : ''}`;

  if (showThemes) {
    return (
      <>
        <div
          className={styles.themeBackdrop}
          onClick={() => {
            close();
            setShowThemes(false);
          }}
        />
        <div className={styles.themeFloating} data-testid="theme-subpanel" data-open="true">
          <div className={styles.header}>
            <button className={styles.closeBtn} onClick={() => setShowThemes(false)}>
              ←
            </button>
            <span className={styles.title}>Theme</span>
            <button
              className={styles.closeBtn}
              onClick={() => {
                close();
                setShowThemes(false);
              }}
            >
              ✕
            </button>
          </div>
          <div className={styles.list}>
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                className={styles.item}
                data-selected={theme.id === themeId}
                data-testid="theme-item"
                data-tid={theme.id}
                onClick={() => setTheme(theme.id as ThemeId)}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: theme.bg,
                    border: '1px solid var(--border, #555)',
                    flexShrink: 0,
                  }}
                />
                <span>{theme.name}</span>
                {theme.id === themeId && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.6 }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} version={aboutVersion} />
      </>
    );
  }

  /* ---- action handlers for new items ---- */

  const handleRename = () => {
    const { activeId, sessions, updateSession } = useSessionStore.getState();
    if (!activeId) return;
    const ms = sessions.get(activeId);
    const newName = prompt('Rename session:', ms?.name ?? '');
    if (!newName || newName === ms?.name) return;
    renameSession(activeId, newName)
      .then(() => {
        updateSession(activeId, { name: newName });
        toast.success('Session renamed');
      })
      .catch(() => toast.error('Failed to rename session'));
    close();
  };

  const handleStop = () => {
    const { activeId, removeSession: remove } = useSessionStore.getState();
    if (!activeId) return;
    if (!confirm('Stop this session? The process will be killed.')) return;
    deleteSession(activeId)
      .catch(() => toast.error('Failed to stop session'))
      .finally(() => remove(activeId));
    close();
  };

  const handleNotifications = async () => {
    const next = !notificationsOn;
    setNotificationsOn(next);
    setNotificationsEnabled(next);

    if (next) {
      playNotificationSound();

      // Request notification permission
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          setPushActive(false);
          toast('Notifications enabled (browser permission denied, using in-app only)');
          close();
          return;
        }
      }

      // Try to set up push subscription
      try {
        const { initPushSubscription } = await import('@/services/pushSubscription');
        const success = await initPushSubscription();
        setPushActive(success);
        if (success) {
          toast('Notifications enabled with push support');
        } else {
          toast('Notifications enabled (push not available)');
        }
      } catch {
        toast('Notifications enabled (push setup failed, using fallback)');
      }
    } else {
      // Disable: also remove push subscription
      try {
        const { removePushSubscription } = await import('@/services/pushSubscription');
        await removePushSubscription();
      } catch {
        // Ignore cleanup errors
      }
      setPushActive(false);
      toast('Notifications disabled');
    }
    close();
  };

  const handleAbout = () => {
    fetchVersion().then((version) => {
      setAboutVersion(version);
      setAboutOpen(true);
    });
    close();
  };

  /* ---- split view helpers ---- */
  const splitMode = useSessionStore.getState().splitMode;
  const splitLabel =
    splitMode === 'off'
      ? 'Split vertical'
      : splitMode === 'vertical'
        ? 'Split horizontal'
        : 'Close split';
  const splitIcon =
    splitMode === 'off' ? iconSplit : splitMode === 'vertical' ? iconSplitHorizontal : iconSplitOff;

  /* ---- section definitions ---- */

  type Action = { id: string; label: string; icon: React.ReactNode; action: () => void };
  type Section = { title: string; actions: Action[] };

  const sections: Section[] = [
    {
      title: 'SESSION',
      actions: [
        {
          id: 'new-tab',
          label: 'New tab',
          icon: iconNewTab,
          action: () => run(() => useUIStore.getState().openNewSessionModal()),
        },
        {
          id: 'upload',
          label: 'Upload files',
          icon: iconUpload,
          action: () => run(() => useUIStore.getState().openUploadModal()),
        },
        {
          id: 'download',
          label: 'Download file',
          icon: iconDownload,
          action: () => run(() => useUIStore.getState().openDownloadModal()),
        },
        {
          id: 'markdown',
          label: 'View markdown',
          icon: iconMarkdown,
          action: () => run(() => useUIStore.getState().openMarkdownModal()),
        },
        {
          id: 'close-tab',
          label: 'Close tab',
          icon: iconCloseTab,
          action: () =>
            run(() => {
              const {
                activeId,
                sessions: sess,
                removeSession: remove,
              } = useSessionStore.getState();
              if (!activeId) return;
              const ms = sess.get(activeId);
              if (!confirm(`Close session "${ms?.name ?? activeId}"?`)) return;
              deleteSession(activeId).catch(() => {});
              remove(activeId);
            }),
        },
        {
          id: 'rename',
          label: 'Rename session',
          icon: iconRename,
          action: handleRename,
        },
        {
          id: 'split',
          label: splitLabel,
          icon: splitIcon,
          action: () => run(() => useSessionStore.getState().toggleSplit()),
        },
        {
          id: 'stop',
          label: 'Stop session',
          icon: iconStop,
          action: handleStop,
        },
      ],
    },
    {
      title: 'SEARCH',
      actions: [
        {
          id: 'find',
          label: 'Find in terminal',
          icon: iconSearch,
          action: () => run(() => useUIStore.getState().openSearchBar()),
        },
      ],
    },
    {
      title: 'VIEW',
      actions: [
        {
          id: 'font-up',
          label: 'Increase font size',
          icon: iconFontUp,
          action: () =>
            run(() => {
              const { fontSize: current, setFontSize } = useUIStore.getState();
              setFontSize(current + 1);
            }),
        },
        {
          id: 'font-down',
          label: 'Decrease font size',
          icon: iconFontDown,
          action: () =>
            run(() => {
              const { fontSize: current, setFontSize } = useUIStore.getState();
              setFontSize(current - 1);
            }),
        },
        {
          id: 'theme',
          label: `Theme (${themeName})`,
          icon: iconTheme,
          action: () => setShowThemes(true),
        },
        {
          id: 'preview',
          label: 'Preview port',
          icon: iconPreview,
          action: () => run(() => useUIStore.getState().openPreviewModal()),
        },
        {
          id: 'view-code',
          label: 'View code',
          icon: iconCode,
          action: () =>
            run(() => {
              const { activeId } = useSessionStore.getState();
              if (activeId) window.location.href = `/code/${activeId}`;
            }),
        },
        {
          id: 'git-changes',
          label: 'Git changes',
          icon: iconGitChanges,
          action: () =>
            run(() => {
              const { activeId } = useSessionStore.getState();
              if (activeId) {
                window.location.href = `/code/${activeId}?view=changes`;
              }
            }),
        },
      ],
    },
    {
      title: 'SHARE',
      actions: [
        {
          id: 'copy-link',
          label: 'Copy link',
          icon: iconCopyLink,
          action: () => {
            // Start fetch immediately so the clipboard write stays in the
            // user-gesture context (required by Safari / iOS).
            const urlPromise = getShareUrl();

            if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
              const blobPromise = urlPromise.then((u) => new Blob([u], { type: 'text/plain' }));
              navigator.clipboard
                .write([new ClipboardItem({ 'text/plain': blobPromise })])
                .then(() => toast.success('Link copied!'))
                .catch(() => urlPromise.then((url) => fallbackCopy(url)));
            } else {
              urlPromise.then((url) => {
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard
                    .writeText(url)
                    .then(() => toast.success('Link copied!'))
                    .catch(() => fallbackCopy(url));
                } else {
                  fallbackCopy(url);
                }
              });
            }
            close();
          },
        },
      ],
    },
    {
      title: 'NOTIFICATIONS',
      actions: [
        {
          id: 'notifications',
          label: notificationsOn
            ? pushActive
              ? 'Notifications (on) — Push active ✓'
              : 'Notifications (on) — Push unavailable'
            : 'Notifications (off)',
          icon: iconBell,
          action: handleNotifications,
        },
      ],
    },
    {
      title: 'SYSTEM',
      actions: [
        {
          id: 'refresh',
          label: 'Refresh',
          icon: iconRefresh,
          action: () =>
            run(() => {
              if ('caches' in window) {
                caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
              }
              location.reload();
            }),
        },
        {
          id: 'clear',
          label: 'Clear terminal',
          icon: iconClear,
          action: () =>
            run(() => {
              const { sessions, activeId } = useSessionStore.getState();
              if (!activeId) return;
              const ms = sessions.get(activeId);
              ms?.term?.clear();
            }),
        },
        {
          id: 'about',
          label: 'About',
          icon: iconAbout,
          action: handleAbout,
        },
      ],
    },
  ];

  return (
    <>
      <div className={styles.backdrop} onClick={close} />
      <div className={panelCls} data-testid="palette-panel" data-open="true">
        <div className={styles.header}>
          <span className={styles.title}>Tools</span>
          <button className={styles.closeBtn} onClick={close}>
            ✕
          </button>
        </div>
        <div className={styles.body}>
          {sections.map((sec) => (
            <div key={sec.title} className={styles.section}>
              <div className={styles.sectionTitle}>{sec.title}</div>
              {sec.actions.map((a) => (
                <button
                  key={a.id}
                  className={styles.btn}
                  onClick={a.action}
                  data-testid="palette-action"
                >
                  {a.icon}
                  {a.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} version={aboutVersion} />
    </>
  );
}
