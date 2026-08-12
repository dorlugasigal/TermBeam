import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FitAddon as GhosttyFitAddon,
  Ghostty,
  Terminal as GhosttyTerminal,
} from 'ghostty-web';
import type { Terminal as XTermTerminal, IDisposable } from '@xterm/xterm';
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
import { useThemeStore } from '@/stores/themeStore';
import { useUIStore } from '@/stores/uiStore';
import { getTerminalTheme } from '@/themes/terminalThemes';
import nerdFontUrl from '@/assets/JetBrainsMonoNerdFont-Regular.ttf?url';
import type { UseXTermOptions, UseXTermReturn } from './useXTerm';

interface LoadedGhostty {
  FitAddon: typeof import('ghostty-web').FitAddon;
  Terminal: typeof import('ghostty-web').Terminal;
  instance: Ghostty;
}

let ghosttyInitialization: Promise<LoadedGhostty> | undefined;

function ensureGhosttyInitialized(): Promise<LoadedGhostty> {
  ghosttyInitialization ??= Promise.all([
    import('ghostty-web'),
    import('ghostty-web/ghostty-vt.wasm?url'),
  ]).then(async ([ghosttyModule, wasmModule]) => ({
    FitAddon: ghosttyModule.FitAddon,
    Terminal: ghosttyModule.Terminal,
    instance: await ghosttyModule.Ghostty.load(wasmModule.default),
  }));
  return ghosttyInitialization;
}

type CompatibleGhosttyTerminal = GhosttyTerminal & {
  refresh: (start: number, end: number) => void;
  onWriteParsed: (listener: () => void) => IDisposable;
};

export function useGhosttyTerminal(options: UseXTermOptions = {}): UseXTermReturn {
  const { enabled = true, fontSize = 14, onData, onResize, onSelectionChange } = options;
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<CompatibleGhosttyTerminal | null>(null);
  const fitRef = useRef<GhosttyFitAddon | null>(null);
  const [terminal, setTerminal] = useState<XTermTerminal | null>(null);
  const [fitAddon, setFitAddon] = useState<XTermFitAddon | null>(null);
  const themeId = useThemeStore((state) => state.themeId);

  const fit = useCallback(() => {
    fitRef.current?.fit();
  }, []);

  const write = useCallback((data: string) => {
    termRef.current?.write(data);
  }, []);

  const getSelection = useCallback(() => termRef.current?.getSelection() ?? '', []);

  useEffect(() => {
    if (!enabled) return;
    const container = terminalRef.current;
    if (!container) return;

    let disposed = false;
    let term: CompatibleGhosttyTerminal | undefined;
    let fitAddonInstance: GhosttyFitAddon | undefined;
    const disposables: IDisposable[] = [];

    void ensureGhosttyInitialized()
      .then(({ FitAddon, Terminal, instance }) => {
        if (disposed) return;

        const theme = getTerminalTheme(themeId);
        term = new Terminal({
          cursorBlink: true,
          fontFamily:
            "'NerdFont', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', 'Consolas', monospace",
          fontSize,
          scrollback: 10_000,
          theme,
          ghostty: instance,
        }) as CompatibleGhosttyTerminal;
        term.refresh = () => {
          // Ghostty-Web owns a continuous render loop.
        };
        term.focus = () => {
          term?.textarea?.focus({ preventScroll: true });
        };
        term.onWriteParsed = (listener) => term!.onRender(() => listener());

        fitAddonInstance = new FitAddon();
        term.loadAddon(fitAddonInstance);
        term.open(container);
        fitAddonInstance.fit();
        fitAddonInstance.observeResize();

        term.attachCustomKeyEventHandler((event) => {
          if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'f')) {
            return true;
          }
          if (event.key === 'Escape') {
            const ui = useUIStore.getState();
            if (ui.toolsPanelOpen || ui.searchBarOpen || ui.copyOverlayOpen) return true;
          }
          return false;
        });

        if (onData) disposables.push(term.onData(onData));
        if (onResize) {
          disposables.push(term.onResize(({ cols, rows }) => onResize(cols, rows)));
        }
        if (onSelectionChange) {
          disposables.push(
            term.onSelectionChange(() => onSelectionChange(term?.getSelection() ?? '')),
          );
        }

        termRef.current = term;
        fitRef.current = fitAddonInstance;
        setTerminal(term as unknown as XTermTerminal);
        setFitAddon(fitAddonInstance as unknown as XTermFitAddon);

        const font = new FontFace('NerdFont', `url(${nerdFontUrl})`);
        void font
          .load()
          .then((loadedFont) => {
            if (disposed || !term) return;
            document.fonts.add(loadedFont);
            term.options.fontFamily =
              "'NerdFont', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', 'Consolas', monospace";
            fitAddonInstance?.fit();
          })
          .catch(() => {
            // Keep system monospace fallback.
          });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error('Failed to initialize experimental Ghostty terminal', error);
        }
      });

    return () => {
      disposed = true;
      for (const disposable of disposables) disposable.dispose();
      fitAddonInstance?.dispose();
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
      setTerminal(null);
      setFitAddon(null);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !termRef.current) return;
    termRef.current.options.theme = getTerminalTheme(themeId);
  }, [enabled, themeId]);

  useEffect(() => {
    if (!enabled || !termRef.current) return;
    termRef.current.options.fontSize = fontSize;
    fit();
  }, [enabled, fontSize, fit]);

  return {
    terminalRef,
    terminal,
    fitAddon,
    searchAddon: null,
    fit,
    write,
    getSelection,
  };
}
