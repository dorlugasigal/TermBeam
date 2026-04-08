import { useRef, useEffect, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { CanvasAddon } from '@xterm/addon-canvas';
import { useThemeStore } from '@/stores/themeStore';
import { useUIStore } from '@/stores/uiStore';
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
  const customFitRef = useRef<() => void>(() => {});
  const searchRef = useRef<SearchAddon | null>(null);

  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);

  const themeId = useThemeStore((s) => s.themeId);

  const isMobile =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
    window.innerWidth < 768;

  const fit = useCallback(() => {
    try {
      if (!isMobile) {
        fitRef.current?.fit();
        return;
      }
      // On mobile, FitAddon subtracts scrollBarWidth from available width,
      // resulting in fewer columns than actually fit on screen. We bypass
      // this by calculating dimensions using the full container width.
      const term = termRef.current;
      const fa = fitRef.current;
      if (!term || !fa) return;
      const core = (term as any)._core;
      if (!core) {
        fa.fit();
        return;
      }
      const dims = core._renderService?.dimensions;
      if (!dims || dims.css.cell.width === 0 || dims.css.cell.height === 0) {
        fa.fit();
        return;
      }
      const el = term.element;
      if (!el?.parentElement) {
        fa.fit();
        return;
      }
      const parentStyle = window.getComputedStyle(el.parentElement);
      const parentH = parseInt(parentStyle.height);
      const parentW = Math.max(0, parseInt(parentStyle.width));
      const elStyle = window.getComputedStyle(el);
      const availH = parentH - parseInt(elStyle.paddingTop) - parseInt(elStyle.paddingBottom);
      const availW = parentW - parseInt(elStyle.paddingLeft) - parseInt(elStyle.paddingRight);
      const cols = Math.max(2, Math.floor(availW / dims.css.cell.width));
      const rows = Math.max(1, Math.floor(availH / dims.css.cell.height));
      if (term.rows !== rows || term.cols !== cols) {
        core._renderService.clear();
        term.resize(cols, rows);
      }
    } catch {
      // Container may not be visible yet
    }
  }, [isMobile]);

  // Keep a ref so callbacks created inside useEffect can call the latest fit
  customFitRef.current = fit;

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

    const FONT_FAMILY =
      "'NerdFont', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', 'Consolas', monospace";
    const theme = getTerminalTheme(themeId);
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: FONT_FAMILY,
      fontSize,
      scrollback: 10_000,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      letterSpacing: 0,
      lineHeight: 1.0,
      allowProposedApi: true,
      theme,
    });

    const fitAddonInstance = new FitAddon();
    const search = new SearchAddon();
    const webLinks = new WebLinksAddon();

    term.loadAddon(fitAddonInstance);
    term.loadAddon(search);
    term.loadAddon(webLinks);

    // Let Ctrl+K, Ctrl+F, and Escape (when overlays are open) propagate to the document
    term.attachCustomKeyEventHandler((e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) return false;
      if (e.key === 'Escape') {
        const ui = useUIStore.getState();
        if (ui.commandPaletteOpen || ui.searchBarOpen || ui.copyOverlayOpen) return false;
      }
      return true;
    });

    let disposed = false;

    // Suppress xterm.js async "dimensions" error from disposed terminals
    // (StrictMode double-mount in dev: first terminal is disposed while its
    // internal setTimeout is still pending — harmless, but noisy in console)
    const suppressXtermError = (e: ErrorEvent) => {
      if (e.message?.includes('dimensions')) e.preventDefault();
    };

    const openTerminal = () => {
      if (disposed) return;
      window.addEventListener('error', suppressXtermError);
      try {
        term.open(container);
      } catch {
        window.removeEventListener('error', suppressXtermError);
        return;
      }
      // Remove after xterm's internal async init completes
      setTimeout(() => window.removeEventListener('error', suppressXtermError), 50);
      // GPU-accelerated canvas renderer for sharper text.
      // Skip on small touchscreen devices — the DOM renderer is flicker-free
      // and fast enough for mobile-sized terminals (fewer cells to render).
      // The CanvasAddon's 2D canvas clear→redraw cycle causes visible flicker
      // on mobile GPUs during rapid output (e.g. TUI apps redrawing).
      const isMobileDevice =
        ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth < 768;
      if (!navigator.webdriver && !isMobileDevice) {
        try {
          const canvas = new CanvasAddon();
          term.loadAddon(canvas);
        } catch {
          // Canvas not supported — DOM renderer fallback (default)
        }
      }
      try {
        fit();
      } catch {
        // ignore
      }

      // Stretch xterm-screen and row divs to fill 100% width.
      // xterm.js sizes these to cols×cellWidth, leaving a sub-cell gap on the
      // right. Setting width via JS overrides the inline styles xterm applies.
      const xtScreen = container.querySelector('.xterm-screen') as HTMLElement | null;
      if (xtScreen) xtScreen.style.width = '100%';
      const xtRows = container.querySelector('.xterm-rows') as HTMLElement | null;
      if (xtRows) {
        xtRows.style.width = '100%';
        // Also observe row mutations to fix newly-added rows
        const rowObs = new MutationObserver(() => {
          for (const child of xtRows.children) {
            (child as HTMLElement).style.width = '100%';
          }
        });
        rowObs.observe(xtRows, { childList: true });
        // Fix existing rows
        for (const child of xtRows.children) {
          (child as HTMLElement).style.width = '100%';
        }
      }
    };

    termRef.current = term;
    fitRef.current = fitAddonInstance;
    searchRef.current = search;

    let initRo: ResizeObserver | null = null;
    if (container.offsetWidth > 0 && container.offsetHeight > 0) {
      openTerminal();
    } else {
      initRo = new ResizeObserver(() => {
        if (container.offsetWidth > 0 && container.offsetHeight > 0) {
          initRo!.disconnect();
          initRo = null;
          openTerminal();
        }
      });
      initRo.observe(container);
    }

    setTerminal(term);
    setFitAddon(fitAddonInstance);
    setSearchAddon(search);

    // Load NerdFont asynchronously
    const font = new FontFace(
      'NerdFont',
      'url(https://cdn.jsdelivr.net/gh/ryanoasis/nerd-fonts@latest/patched-fonts/JetBrainsMono/Ligatures/Regular/JetBrainsMonoNerdFont-Regular.ttf)',
    );
    font
      .load()
      .then((f) => {
        if (disposed) return;
        document.fonts.add(f);
        if (termRef.current) {
          termRef.current.options.fontFamily = FONT_FAMILY;
          try {
            customFitRef.current();
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // NerdFont unavailable — keep default monospace
      });

    // ResizeObserver for container size changes.
    // Guard against 0-dimension containers (display:none on an ancestor)
    // to prevent fit() from resizing the terminal to minimum dimensions.
    // Debounced to prevent resize loops: rapid container changes (e.g.
    // keyboard open/close, orientation change) can trigger fit → sendResize
    // → SIGWINCH → output → layout shift → ResizeObserver again.
    let roTimer: ReturnType<typeof setTimeout> | undefined;
    let prevRoWidth = 0;
    let prevRoHeight = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      // Skip if container dimensions haven't changed meaningfully (±1px
      // tolerance avoids sub-pixel oscillations from CSS calc rounding).
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (Math.abs(w - prevRoWidth) <= 1 && Math.abs(h - prevRoHeight) <= 1) return;
      prevRoWidth = w;
      prevRoHeight = h;
      clearTimeout(roTimer);
      roTimer = setTimeout(() => {
        try {
          customFitRef.current();
        } catch {
          // ignore
        }
      }, 150);
    });
    observer.observe(container);

    return () => {
      disposed = true;
      clearTimeout(roTimer);
      initRo?.disconnect();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      setTerminal(null);
      setFitAddon(null);
      setSearchAddon(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window resize listener (covers cases ResizeObserver may miss)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          customFitRef.current();
        } catch {
          // ignore
        }
      }, 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, []);

  // Screen orientation change listener (mobile rotation)
  useEffect(() => {
    const orientation = screen.orientation;
    if (!orientation) return;
    let timer: ReturnType<typeof setTimeout>;
    const onChange = () => {
      timer = setTimeout(() => {
        try {
          customFitRef.current();
        } catch {
          // ignore
        }
      }, 150);
    };
    orientation.addEventListener('change', onChange);
    return () => {
      orientation.removeEventListener('change', onChange);
      clearTimeout(timer);
    };
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
