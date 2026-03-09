import { useEffect, useRef, useState } from 'react';

interface MobileKeyboardState {
  keyboardOpen: boolean;
  keyboardHeight: number;
}

const KEYBOARD_THRESHOLD = 50; // px shrink to consider keyboard open

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

    function onResize() {
      const currentHeight = vv!.height;
      const diff = baseHeightRef.current - currentHeight;
      const isOpen = diff > KEYBOARD_THRESHOLD;
      setState({
        keyboardOpen: isOpen,
        keyboardHeight: isOpen ? diff : 0,
      });
    }

    // On orientation change, the viewport height changes without a keyboard
    // event. Reset the baseline so the diff calculation stays correct.
    function onOrientationChange() {
      // Short delay — browsers need a frame to settle the new viewport size
      setTimeout(() => {
        baseHeightRef.current = vv!.height;
        setState({ keyboardOpen: false, keyboardHeight: 0 });
      }, 200);
    }

    vv.addEventListener('resize', onResize);

    const orientation = screen.orientation;
    if (orientation) {
      orientation.addEventListener('change', onOrientationChange);
    }
    // Fallback for browsers without screen.orientation
    window.addEventListener('orientationchange', onOrientationChange);

    return () => {
      vv.removeEventListener('resize', onResize);
      if (orientation) {
        orientation.removeEventListener('change', onOrientationChange);
      }
      window.removeEventListener('orientationchange', onOrientationChange);
    };
  }, []);

  return state;
}
