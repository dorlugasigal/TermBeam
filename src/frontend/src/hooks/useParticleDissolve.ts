/**
 * Canvas-based particle dispersal — the "Thanos snap" disintegrate
 * effect. Spawned in parallel with the host element's CSS fragmentation
 * fade so the visible row appears to shatter into drifting particles.
 *
 * Two presets matching the size of the dissolving element:
 *
 *  - `card`: long, dramatic. Used by big surfaces (SessionsHub cards
 *    where users dwell on the row before deleting). ~260 fine dust
 *    particles drifting in random directions over 1500 ms.
 *
 *  - `tab`: short, snappy. Used by compact surfaces (TabBar tabs,
 *    SidePanel rows) where multiple deletes can happen in quick
 *    succession and a long animation feels sluggish. ~90 particles
 *    over 700 ms.
 *
 * Particles take their color from a *palette* (typically the row's
 * session tint plus the active theme's `--accent` and `--text`) so
 * the dust is coherent with the current theme rather than a single
 * fixed color. The palette is built upstream by `useDissolveDelete`.
 *
 * Design notes:
 *  - Particles are emitted with an EDGE BIAS (≈55% within ~5px of
 *    the rectangle's perimeter). Pure uniform emission looks like
 *    "a rectangle exploded"; biasing toward edges preserves enough
 *    silhouette information that the cloud reads as the row that
 *    just disappeared.
 *  - Velocities are randomized in ALL directions (not just upward)
 *    so the dust spreads outward like a real scatter, not like a
 *    column of smoke. A weak upward acceleration biases the long-
 *    term drift but doesn't dominate the initial burst.
 *  - One canvas + one RAF loop PER dissolve, but a global concurrency
 *    cap prevents N independent loops from stacking when the user
 *    spam-deletes. Beyond the cap the caller falls back to the
 *    plain CSS fade.
 *  - z-index is held below the Sonner toast layer (9999) so error
 *    toasts surfaced after a failed delete remain on top, and above
 *    every modal/panel layer in the app (≤1100).
 */
export type DissolveVariant = 'card' | 'tab';

interface VariantPreset {
  particleCount: number;
  durationMs: number;
  /** Particles barely move during this opening window — the host
   * element is still mostly opaque, so it looks like fragmentation,
   * not flight. */
  fragmentPhaseMs: number;
  /** Pixel margin around the host rect so particles drifting past
   * the edge aren't clipped by the canvas bounds. */
  canvasMargin: number;
  /** Maximum size of a particle in CSS pixels. */
  maxSize: number;
  /** Initial velocity range (±) in CSS pixels per frame. Higher =
   * more outward burst. */
  burstSpeed: number;
  /** Upward gravity (subtracted from vy each frame). Lower = more
   * isotropic drift; higher = more "smoke rising". */
  gravity: number;
  /** Per-particle life decay per frame. */
  decayMin: number;
  decayMax: number;
}

const PRESETS: Record<DissolveVariant, VariantPreset> = {
  card: {
    particleCount: 260,
    durationMs: 1500,
    fragmentPhaseMs: 140,
    canvasMargin: 100,
    maxSize: 1.8,
    burstSpeed: 1.6,
    gravity: 0.012,
    decayMin: 0.0022,
    decayMax: 0.005,
  },
  tab: {
    particleCount: 90,
    durationMs: 700,
    fragmentPhaseMs: 70,
    canvasMargin: 50,
    maxSize: 1.4,
    burstSpeed: 1.4,
    gravity: 0.018,
    decayMin: 0.005,
    decayMax: 0.012,
  },
};

const Z_INDEX = 5000;
const MAX_CONCURRENT = 3;

let activeCanvases = 0;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotSpeed: number;
  life: number;
  decay: number;
  color: string;
}

/**
 * Returns true if a particle slot was successfully spawned and the
 * caller can rely on the particle visual playing. Returns false when
 * skipped (reduced motion, no element, no canvas support, or the
 * concurrency cap would be exceeded) — in which case the caller
 * should rely on the plain CSS fade only.
 *
 * `palette` is a list of CSS color strings sampled per-particle.
 * Pass the row's session tint first, followed by theme accent / text
 * colors so the dust feels coherent with the active theme. The first
 * entries are weighted slightly heavier — see the per-particle pick
 * below.
 *
 * Promise resolves only when the canvas is removed from the DOM
 * (success or skip), so callers can `await` it for cleanup ordering.
 */
export function startParticleDissolve(
  element: HTMLElement | null,
  palette: string[],
  variant: DissolveVariant = 'card',
): Promise<boolean> {
  if (!element || prefersReducedMotion()) return Promise.resolve(false);
  if (activeCanvases >= MAX_CONCURRENT) return Promise.resolve(false);
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(false);
  }

  const colors = palette.filter((c) => typeof c === 'string' && c.length > 0);
  if (colors.length === 0) return Promise.resolve(false);

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return Promise.resolve(false);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(false);

  activeCanvases++;
  const preset = PRESETS[variant];

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = rect.width + preset.canvasMargin * 2;
  const cssHeight = rect.height + preset.canvasMargin * 2;
  canvas.width = Math.ceil(cssWidth * dpr);
  canvas.height = Math.ceil(cssHeight * dpr);
  canvas.style.position = 'fixed';
  canvas.style.left = `${rect.left - preset.canvasMargin}px`;
  canvas.style.top = `${rect.top - preset.canvasMargin}px`;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = String(Z_INDEX);
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx.scale(dpr, dpr);

  /**
   * Weighted index picker. Earlier entries in `colors` are more
   * likely (so `session.color` dominates with `accent`/`text` as
   * accents). Uses an exponential decay weighting: w_i = 0.6^i.
   */
  function pickColor(): string {
    if (colors.length === 1) return colors[0]!;
    const weights: number[] = colors.map((_, i) => Math.pow(0.6, i));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < colors.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return colors[i]!;
    }
    return colors[colors.length - 1]!;
  }

  const innerW = rect.width;
  const innerH = rect.height;
  const edgeBand = 5;
  const particles: Particle[] = Array.from({ length: preset.particleCount }, () => {
    // Bias 55% to perimeter, 45% interior. Perimeter samples pick a
    // random side, then a random offset along it within `edgeBand`.
    const onEdge = Math.random() < 0.55;
    let x: number;
    let y: number;
    if (onEdge) {
      const side = Math.floor(Math.random() * 4);
      const along = Math.random();
      const offset = Math.random() * edgeBand;
      if (side === 0) {
        x = along * innerW;
        y = offset;
      } else if (side === 1) {
        x = innerW - offset;
        y = along * innerH;
      } else if (side === 2) {
        x = along * innerW;
        y = innerH - offset;
      } else {
        x = offset;
        y = along * innerH;
      }
    } else {
      x = Math.random() * innerW;
      y = Math.random() * innerH;
    }

    // Velocity: random direction (any angle), random magnitude up to
    // `burstSpeed`. Combined with the gradual upward gravity later,
    // this looks like the row exploded outward in all directions and
    // the resulting dust slowly drifts upward.
    const angle = Math.random() * Math.PI * 2;
    const magnitude = Math.random() * preset.burstSpeed;

    return {
      x: x + preset.canvasMargin,
      y: y + preset.canvasMargin,
      vx: Math.cos(angle) * magnitude,
      vy: Math.sin(angle) * magnitude,
      // Bias the size distribution toward the small end (sqrt skew)
      // so the cloud is mostly fine dust with only a few "chunks"
      // that read as fragments. Without the skew a uniform random
      // gives too many medium particles and the cloud looks chunky
      // instead of dusty.
      size: Math.sqrt(Math.random()) * (preset.maxSize - 0.4) + 0.4,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.04,
      life: 1,
      decay: Math.random() * (preset.decayMax - preset.decayMin) + preset.decayMin,
      color: pickColor(),
    };
  });

  return new Promise((resolve) => {
    const start = performance.now();
    let rafId = 0;
    let cleaned = false;

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      cancelAnimationFrame(rafId);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      activeCanvases = Math.max(0, activeCanvases - 1);
      resolve(true);
    }

    function frame(now: number) {
      const elapsed = now - start;
      if (elapsed >= preset.durationMs) {
        cleanup();
        return;
      }

      ctx!.clearRect(0, 0, cssWidth, cssHeight);

      const inDriftPhase = elapsed > preset.fragmentPhaseMs;

      for (const p of particles) {
        if (inDriftPhase) {
          p.vy -= preset.gravity;
          p.x += p.vx;
          p.y += p.vy;
          p.rotation += p.rotSpeed;
          p.life -= p.decay;
        }
        if (p.life <= 0) continue;
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.rotation);
        ctx!.fillStyle = p.color;
        ctx!.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx!.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
        ctx!.restore();
      }

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
  });
}
