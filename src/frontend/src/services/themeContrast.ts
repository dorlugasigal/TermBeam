/**
 * Derives contrast-dependent tokens from the active theme at runtime:
 *   - `data-tone="light|dark"` on <html> (drives light-theme surface overrides + color-scheme)
 *   - `--on-accent`: white or near-black, whichever reads best on the theme's accent
 *
 * CSS can't (yet, portably) pick a contrasting color, and hand-maintaining an
 * on-accent value for 30+ themes (matrix green, amber, neon pink…) is exactly
 * how unreadable buttons happen. Re-runs whenever `data-theme` changes.
 */

type RGB = [number, number, number];

export function parseColor(value: string): RGB | null {
  const v = value.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const h = m[1]!;
    return [0, 1, 2].map((i) => parseInt(h[i]! + h[i]!, 16)) as RGB;
  }
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(v);
  if (m) {
    const h = m[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

export function relativeLuminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: RGB = [255, 255, 255];
const INK: RGB = [12, 12, 14];

/** White when it clears AA (4.5:1) — it reads as a "button" — else the stronger of the two. */
export function pickOnAccent(accent: RGB): '#ffffff' | '#0c0c0e' {
  const onWhite = contrastRatio(accent, WHITE);
  if (onWhite >= 4.5) return '#ffffff';
  return onWhite >= contrastRatio(accent, INK) ? '#ffffff' : '#0c0c0e';
}

export function applyThemeContrast(root: HTMLElement = document.documentElement): void {
  const cs = getComputedStyle(root);
  const bg = parseColor(cs.getPropertyValue('--bg'));
  const accent = parseColor(cs.getPropertyValue('--accent'));
  if (bg) root.dataset.tone = relativeLuminance(bg) > 0.4 ? 'light' : 'dark';
  if (accent) root.style.setProperty('--on-accent', pickOnAccent(accent));
}

let observer: MutationObserver | null = null;

export function watchThemeContrast(): void {
  applyThemeContrast();
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(() => applyThemeContrast());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}
