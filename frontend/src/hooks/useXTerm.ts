import { useRef, useEffect, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { CanvasAddon } from '@xterm/addon-canvas';
import { useThemeStore } from '@/stores/themeStore';
import { getTerminalTheme } from '@/themes/terminalThemes';
import '@xterm/xterm/css/xterm.css';

export interface UseXTermOptions {
  fontSize?: number;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onSelectionChange?: (selection: string) => void;
}

export interface UseXTermReturn {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  terminal: Terminal | null;
  fitAddon: FitAddon | null;
  searchAddon: SearchAddon | null;
  fit: () => void;
  write: (data: string) => void;
  getSelection: () => string;
}

export function useXTerm(options: UseXTermOptions = {}): UseXTermReturn {
  const { fontSize = 14, onData, onResize, onSelectionChange } = options;
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const mountedRef = useRef(false);

  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);

  const themeId = useThemeStore((s) => s.themeId);

  const fit = useCallback(() => {
    try {
      fitRef.current?.fit();
    } catch {
      // Container may not be visible yet
    }
  }, []);

  const write = useCallback((data: string) => {
    termRef.current?.write(data);
  }, []);

  const getSelection = useCallback((): string => {
    return termRef.current?.getSelection() ?? '';
  }, []);

  // Create and mount terminal
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    // StrictMode guard: skip second mount if already initialized
    if (mountedRef.current) return;
    mountedRef.current = true;

    const theme = getTerminalTheme(themeId);
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize,
      scrollback: 10_000,
      theme,
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    const webLinks = new WebLinksAddon();

    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(webLinks);

    term.open(container);

    // CanvasAddon must be loaded after open()
    try {
      term.loadAddon(new CanvasAddon());
    } catch {
      // Canvas addon may fail in some environments; fall back to DOM renderer
    }

    try {
      fit.fit();
    } catch {
      // Container may not be sized yet
    }

    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    setTerminal(term);
    setFitAddon(fit);
    setSearchAddon(search);

    // Load NerdFont asynchronously
    const font = new FontFace(
      'NerdFont',
      'url(https://cdn.jsdelivr.net/gh/ryanoasis/nerd-fonts@latest/patched-fonts/JetBrainsMono/Ligatures/Regular/JetBrainsMonoNerdFont-Regular.ttf)',
    );
    font.load().then((f) => {
      document.fonts.add(f);
      if (termRef.current) {
        termRef.current.options.fontFamily = "'NerdFont', monospace";
        try {
          fitRef.current?.fit();
        } catch {
          // ignore
        }
      }
    }).catch(() => {
      // NerdFont unavailable — keep default monospace
    });

    // ResizeObserver for container size changes
    const observer = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // ignore
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      mountedRef.current = false;
      setTerminal(null);
      setFitAddon(null);
      setSearchAddon(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme changes
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = getTerminalTheme(themeId);
  }, [themeId]);

  // Apply font size changes
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = fontSize;
    fit();
  }, [fontSize, fit]);

  // Wire up onData callback
  useEffect(() => {
    if (!termRef.current || !onData) return;
    const disposable = termRef.current.onData(onData);
    return () => disposable.dispose();
  }, [terminal, onData]);

  // Wire up onResize callback
  useEffect(() => {
    if (!termRef.current || !onResize) return;
    const disposable = termRef.current.onResize(({ cols, rows }) => onResize(cols, rows));
    return () => disposable.dispose();
  }, [terminal, onResize]);

  // Wire up onSelectionChange callback
  useEffect(() => {
    if (!termRef.current || !onSelectionChange) return;
    const disposable = termRef.current.onSelectionChange(() => {
      const selection = termRef.current?.getSelection() ?? '';
      if (selection) onSelectionChange(selection);
    });
    return () => disposable.dispose();
  }, [terminal, onSelectionChange]);

  return { terminalRef, terminal, fitAddon, searchAddon, fit, write, getSelection };
}
