import { useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import ThemePanel from './ThemePanel';
import styles from './CommandPalette.module.css';

export default function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const close = useUIStore((s) => s.closeCommandPalette);
  const [showThemes, setShowThemes] = useState(false);
  const [search, setSearch] = useState('');

  const run = useCallback(
    (fn: () => void) => {
      fn();
      close();
      setSearch('');
      setShowThemes(false);
    },
    [close],
  );

  if (!open) return null;

  if (showThemes) {
    return (
      <>
        <div className={styles.backdrop} onClick={close} />
        <div className={styles.panel}>
          <ThemePanel onBack={() => setShowThemes(false)} />
        </div>
      </>
    );
  }

  const actions: { id: string; label: string; action: () => void }[] = [
    {
      id: 'new-tab',
      label: 'New Tab',
      action: () => run(() => useUIStore.getState().openNewSessionModal()),
    },
    {
      id: 'close-tab',
      label: 'Close Tab',
      action: () =>
        run(() => {
          const { activeId, removeSession } = useSessionStore.getState();
          if (activeId) removeSession(activeId);
        }),
    },
    {
      id: 'upload',
      label: 'Upload File',
      action: () => run(() => useUIStore.getState().openUploadModal()),
    },
    {
      id: 'split',
      label: 'Split View',
      action: () => run(() => useSessionStore.getState().toggleSplit()),
    },
    {
      id: 'theme',
      label: 'Toggle Theme',
      action: () => setShowThemes(true),
    },
    {
      id: 'search',
      label: 'Search Terminal',
      action: () => run(() => useUIStore.getState().openSearchBar()),
    },
    {
      id: 'select',
      label: 'Select / Copy',
      action: () => run(() => useUIStore.getState().setSelectMode(true)),
    },
    {
      id: 'zoom-in',
      label: 'Zoom In',
      action: () =>
        run(() => {
          const { sessions, activeId } = useSessionStore.getState();
          if (!activeId) return;
          const ms = sessions.get(activeId);
          if (ms?.term) {
            ms.term.options.fontSize = (ms.term.options.fontSize ?? 14) + 1;
            ms.fitAddon?.fit();
          }
        }),
    },
    {
      id: 'zoom-out',
      label: 'Zoom Out',
      action: () =>
        run(() => {
          const { sessions, activeId } = useSessionStore.getState();
          if (!activeId) return;
          const ms = sessions.get(activeId);
          if (ms?.term) {
            ms.term.options.fontSize = Math.max(
              8,
              (ms.term.options.fontSize ?? 14) - 1,
            );
            ms.fitAddon?.fit();
          }
        }),
    },
    {
      id: 'zoom-reset',
      label: 'Reset Zoom',
      action: () =>
        run(() => {
          const { sessions, activeId } = useSessionStore.getState();
          if (!activeId) return;
          const ms = sessions.get(activeId);
          if (ms?.term) {
            ms.term.options.fontSize = 14;
            ms.fitAddon?.fit();
          }
        }),
    },
    {
      id: 'preview',
      label: 'Preview Port',
      action: () => run(() => useUIStore.getState().openPreviewModal()),
    },
    {
      id: 'refresh',
      label: 'Refresh',
      action: () =>
        run(() => {
          if ('caches' in window) {
            caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
          }
          location.reload();
        }),
    },
    {
      id: 'share',
      label: 'Share URL',
      action: () =>
        run(() => {
          navigator.clipboard
            .writeText(window.location.href)
            .then(() => toast.success('URL copied to clipboard'))
            .catch(() => toast.error('Failed to copy URL'));
        }),
    },
    {
      id: 'fullscreen',
      label: 'Full Screen',
      action: () =>
        run(() => {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
        }),
    },
    {
      id: 'clear',
      label: 'Clear Terminal',
      action: () =>
        run(() => {
          const { sessions, activeId } = useSessionStore.getState();
          if (!activeId) return;
          const ms = sessions.get(activeId);
          if (ms?.ws?.readyState === WebSocket.OPEN) {
            ms.ws.send(JSON.stringify({ type: 'input', data: 'clear\r' }));
          }
        }),
    },
    {
      id: 'disconnect',
      label: 'Disconnect',
      action: () =>
        run(() => {
          const { sessions } = useSessionStore.getState();
          sessions.forEach((ms) => ms.ws?.close());
          window.location.href = '/';
        }),
    },
  ];

  return (
    <>
      <div className={styles.backdrop} onClick={close} />
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>Command Palette</span>
          <button className={styles.closeBtn} onClick={close}>
            ✕
          </button>
        </div>
        <Command label="Command palette" shouldFilter>
          <Command.Input
            className={styles.searchInput}
            placeholder="Type a command…"
            value={search}
            onValueChange={setSearch}
            autoFocus
          />
          <Command.List className={styles.list}>
            <Command.Empty style={{ padding: '12px', color: 'var(--text-muted, #666)' }}>
              No results
            </Command.Empty>
            {actions.map((a) => (
              <Command.Item
                key={a.id}
                className={styles.item}
                value={a.label}
                onSelect={a.action}
              >
                {a.label}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </>
  );
}
