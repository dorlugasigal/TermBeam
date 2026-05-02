import { useCallback } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { startParticleDissolve, type DissolveVariant } from './useParticleDissolve';

/**
 * Animation timings, per variant. The host element fragments out over
 * `HOST_FADE_MS[variant]` — that's also when the row is removed from
 * the store and the user can move on. The canvas particles continue
 * drifting for the rest of the variant's duration so the visual stays
 * uninterrupted while the underlying state is already cleaned up.
 *
 * - `card` (Hub): long & dramatic. The user is dwelling on the card
 *   so they can see the full effect.
 * - `tab` (TabBar / SidePanel): short & snappy. Multiple closes in
 *   succession should feel responsive, not sluggish.
 *
 * `prefers-reduced-motion: reduce` collapses the wait to
 * `REDUCED_MOTION_MS` and skips the canvas — just a fast opacity fade.
 */
const HOST_FADE_MS: Record<DissolveVariant, number> = {
  card: 600,
  tab: 280,
};
const REDUCED_MOTION_MS = 140;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Read the active theme's accent + text colors from the CSS custom
 * properties published by `styles/themes.css`. We read live (at
 * dissolve time) rather than subscribing to the theme store so the
 * particles always pick up the current theme — including any
 * mid-session theme switch — without consumers having to thread a
 * theme prop through.
 */
function getThemeSwatches(): { accent: string; text: string } {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return { accent: '', text: '' };
  }
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  return {
    accent: cs.getPropertyValue('--accent').trim(),
    text: cs.getPropertyValue('--text').trim(),
  };
}

interface DissolveOptions {
  /** The DOM node that should disintegrate. Pass `null` for mirror
   * surfaces (e.g. SidePanel when delete was triggered from TabBar) —
   * those still get the CSS fragmentation fade via the dissolvingIds
   * Set, but no canvas particles are emitted. Only the "hero" surface
   * the user clicked emits particles. */
  element: HTMLElement | null;
  /** Hex / rgb color string for the row's primary tint (typically
   * `session.color`). The particle palette is built from this seed
   * plus the active theme's `--accent` and `--text` so the dust
   * looks coherent with the rest of the UI rather than a fixed
   * out-of-theme color. */
  color: string;
  /** Visual intensity — `card` (long, dramatic) or `tab` (short,
   * snappy). Drives both the particle preset and the host fade
   * duration. Defaults to `card` since the dramatic version is the
   * more common case. */
  variant?: DissolveVariant;
  /** API call to delete the session server-side. Fires in parallel
   * with the animation; errors are surfaced after local cleanup. */
  apiDelete: () => Promise<unknown>;
  /** Local cleanup — remove from list state / call removeSession on
   * the store. Called once the host fade completes. */
  finalize: () => void;
}

/**
 * Coordinated dissolve-then-delete helper.
 *
 * Sequence of events:
 *  1. Mark the id dissolving in the store so all surfaces apply the
 *     `.dissolving` CSS class and the polling loops shield themselves.
 *  2. Fire `apiDelete()` immediately for server-side cleanup.
 *  3. Kick off the canvas particle animation in parallel (no await).
 *  4. Wait `HOST_FADE_MS[variant]` for the host element to fragment out.
 *  5. Call `finalize()` — the row is now gone from local/store state
 *     and the user can move on. Canvas particles continue to drift on
 *     their own and clean themselves up after the variant's full
 *     drift duration.
 *  6. Clear the dissolving flag from the store.
 *  7. If `apiDelete()` ultimately rejected, surface the error.
 */
export function useDissolveDelete() {
  const markDissolving = useSessionStore((s) => s.markDissolving);
  const clearDissolving = useSessionStore((s) => s.clearDissolving);

  return useCallback(
    async (id: string, opts: DissolveOptions) => {
      const variant: DissolveVariant = opts.variant ?? 'card';
      markDissolving(id);

      const reduced = prefersReducedMotion();
      const wait = reduced ? REDUCED_MOTION_MS : HOST_FADE_MS[variant];

      const apiPromise = opts.apiDelete().catch((err) => {
        return err instanceof Error ? err : new Error(String(err));
      });

      // Fire-and-forget particle animation (it self-cleans). No need
      // to await — it runs in parallel with the row removal. Skipped
      // if the user has disabled the effect via Settings → Appearance,
      // or if reduced-motion is requested by the OS.
      const particlesEnabled = usePreferencesStore.getState().prefs.particleDissolve;
      if (!reduced && particlesEnabled) {
        const { accent, text } = getThemeSwatches();
        // Order matters: pickColor() in the particle hook weights
        // earlier entries more heavily (exponential decay), so the
        // session color dominates while the theme swatches add a
        // tasteful coherence pass. Filter out empty strings so we
        // never feed canvas a transparent fillStyle.
        const palette = [opts.color, accent, text].filter(
          (c): c is string => typeof c === 'string' && c.length > 0,
        );
        void startParticleDissolve(opts.element, palette, variant);
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, wait);
      });

      opts.finalize();
      clearDissolving(id);

      const apiResult = await apiPromise;
      if (apiResult instanceof Error) {
        throw apiResult;
      }
    },
    [markDissolving, clearDissolving],
  );
}

/**
 * Subscribe to whether a given id is currently dissolving. Components
 * pass this flag down to the row/tab that should render the animation
 * class.
 */
export function useIsDissolving(id: string | null | undefined): boolean {
  return useSessionStore((s) => (id ? s.dissolvingIds.has(id) : false));
}
