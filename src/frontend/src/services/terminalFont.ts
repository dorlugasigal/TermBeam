import nerdFontUrl from '@/assets/JetBrainsMonoNerdFont-Regular.ttf?url';
import { getConfig } from './api';

export const DEFAULT_FONT_FAMILY =
  "'NerdFont', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', 'Consolas', monospace";
const CUSTOM_FONT_FAMILY = `'TermBeamCustomFont', ${DEFAULT_FONT_FAMILY}`;

let fontFamilyPromise: Promise<string> | undefined;

async function loadFace(family: string, url: string): Promise<void> {
  const font = await new FontFace(family, `url(${url})`).load();
  document.fonts.add(font);
}

async function loadFontFamily(): Promise<string> {
  // Keep the bundled font for missing glyphs, including Nerd Font icons.
  const bundledFont = loadFace('NerdFont', nerdFontUrl).catch(() => {});
  const { terminalFontUrl } = await getConfig();
  let family = DEFAULT_FONT_FAMILY;
  if (terminalFontUrl) {
    try {
      await loadFace('TermBeamCustomFont', terminalFontUrl);
      family = CUSTOM_FONT_FAMILY;
    } catch {
      // A font/network error must not prevent the terminal from opening.
    }
  }
  await bundledFont;
  return family;
}

/** Share configuration and loaded fonts across panes and StrictMode mounts. */
export function loadTerminalFont(): Promise<string> {
  return (fontFamilyPromise ??= loadFontFamily());
}
