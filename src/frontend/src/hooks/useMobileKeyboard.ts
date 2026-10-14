import { useEffect, useRef, useState } from 'react';

interface MobileKeyboardState {
  keyboardOpen: boolean;
  keyboardHeight: number;
}

// Software keyboards are ≥ ~200px tall. Smaller shrinks are viewport chrome
// changes (e.g. iOS 26 standalone web apps settling after launch) and must not
// lift the TouchBar.
const KEYBOARD_THRESHOLD = 120;

/** A keyboard can only be up while something editable has focus. */
function editableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function useMobileKeyboard(): MobileKeyboardState {
  const [state, setState] = useState<MobileKeyboardState>({
    keyboardOpen: false,
    keyboardHeight: 0,
  });

  // Track the "no-keyboard" viewport height. Must be recalculated on
  // orientation changes so a portrait→landscape rotation isn't mistaken
  // for a keyboard opening.
  const baseHeightRef = useRef(window.visualViewport?.height ?? window.innerHeight);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    baseHeightRef.current = vv.height;
    let baseWidth = vv.width;

    // While a rotation is in flight, vv.height changes by hundreds of pixels
    // and would otherwise be mistaken for a keyboard opening. Suppress resize
    // events during this window and force a clean baseline afterward.
    let rotating = false;
    let rotationTimer: ReturnType<typeof setTimeout> | undefined;

    function startRotation() {
      rotating = true;
      // Force a clean state immediately so any stale --keyboard-height clears.
      setState({ keyboardOpen: false, keyboardHeight: 0 });
      clearTimeout(rotationTimer);
      rotationTimer = setTimeout(() => {
        baseHeightRef.current = vv!.height;
        baseWidth = vv!.width;
        rotating = false;
        // Re-evaluate after rotation settles in case a real keyboard is open.
        const diff = baseHeightRef.current - vv!.height;
        const isOpen = diff > KEYBOARD_THRESHOLD;
        setState({
          keyboardOpen: isOpen,
          keyboardHeight: isOpen ? diff : 0,
        });
      }, 500);
    }

    function onResize() {
      // Width change ⇒ this is a rotation, not a keyboard event. iOS PWA
      // doesn't reliably fire orientationchange, so detect it from the
      // viewport directly.
      if (vv!.width !== baseWidth) {
        startRotation();
        return;
      }
      if (rotating) return;
      const currentHeight = vv!.height;
      // Nothing focused (no keyboard possible) or the viewport grew: this is
      // the new no-keyboard height.
      if (!editableFocused() || currentHeight > baseHeightRef.current) {
        baseHeightRef.current = currentHeight;
        setState({ keyboardOpen: false, keyboardHeight: 0 });
        return;
      }
      const diff = baseHeightRef.current - currentHeight;
      const isOpen = diff > KEYBOARD_THRESHOLD;
      setState({
        keyboardOpen: isOpen,
        keyboardHeight: isOpen ? diff : 0,
      });
    }

    function onOrientationChange() {
      startRotation();
    }

    vv.addEventListener('resize', onResize);

    const orientation = screen.orientation;
    if (orientation) {
      orientation.addEventListener('change', onOrientationChange);
    }
    // Fallback for browsers without screen.orientation
    window.addEventListener('orientationchange', onOrientationChange);

    return () => {
      clearTimeout(rotationTimer);
      vv.removeEventListener('resize', onResize);
      if (orientation) {
        orientation.removeEventListener('change', onOrientationChange);
      }
      window.removeEventListener('orientationchange', onOrientationChange);
    };
  }, []);

  return state;
}
