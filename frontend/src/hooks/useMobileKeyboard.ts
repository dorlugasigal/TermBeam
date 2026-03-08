import { useEffect, useState } from 'react';

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

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const initialHeight = vv.height;

    function onResize() {
      const currentHeight = vv!.height;
      const diff = initialHeight - currentHeight;
      const isOpen = diff > KEYBOARD_THRESHOLD;
      setState({
        keyboardOpen: isOpen,
        keyboardHeight: isOpen ? diff : 0,
      });
    }

    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  return state;
}
