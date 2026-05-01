import { useEffect, useState } from 'react';

/**
 * Returns `true` once the given number of milliseconds has elapsed since the
 * hook first mounted in the host component.
 *
 * Used by the splash screen to enforce a *minimum* on-screen duration so
 * the typed-cascade brand animation has time to play through, even when the
 * underlying data (auth check, prefs hydrate) resolves in ~50ms on a fast
 * local connection. Pair with another readiness signal, e.g.:
 *
 *   const splashElapsed = useMinDuration(900);
 *   if (loading || !splashElapsed) return <Splash />;
 *
 * The timer is anchored to the host component's mount lifecycle — remount
 * resets it. `ms` is read once on mount; later changes are ignored.
 */
export function useMinDuration(ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (ms <= 0) {
      setElapsed(true);
      return undefined;
    }
    const t = window.setTimeout(() => setElapsed(true), ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return elapsed;
}

export default useMinDuration;
