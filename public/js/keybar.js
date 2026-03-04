/**
 * Key Bar — touch/mouse key-bar logic for the terminal UI.
 *
 * Depends on globals defined in terminal.html's inline script:
 *   - managed  (Map of session objects)
 *   - activeId (current session ID)
 */

// ===== Key Bar =====
// Modifier state (shared with terminal onData)
let ctrlActive = false;
let shiftActive = false;
function clearModifiers() {
  ctrlActive = false;
  shiftActive = false;
  const ctrlBtn = document.getElementById('ctrl-btn');
  const shiftBtn = document.getElementById('shift-btn');
  if (ctrlBtn) ctrlBtn.classList.remove('active');
  if (shiftBtn) shiftBtn.classList.remove('active');
}

function setupKeyBar() {
  const keyBar = document.getElementById('key-bar');
  const ctrlBtn = document.getElementById('ctrl-btn');
  const shiftBtn = document.getElementById('shift-btn');
  let repeatTimer = null;
  let repeatInterval = null;

  function toggleModifier(which) {
    if (which === 'ctrl') {
      ctrlActive = !ctrlActive;
      ctrlBtn.classList.toggle('active', ctrlActive);
    } else {
      shiftActive = !shiftActive;
      shiftBtn.classList.toggle('active', shiftActive);
    }
  }

  function applyModifiers(key) {
    if (!ctrlActive && !shiftActive) return key;
    // Modifier param: Shift=2, Ctrl=5, Ctrl+Shift=6
    const mod = ctrlActive && shiftActive ? 6 : ctrlActive ? 5 : 2;
    // Arrow keys: \x1b[X → \x1b[1;{mod}X
    const csiMatch = key.match(/^\x1b\[([ABCD])$/);
    if (csiMatch) return '\x1b[1;' + mod + csiMatch[1];
    // Home/End: \x1bOH/\x1bOF → \x1b[1;{mod}H/F
    const ssMatch = key.match(/^\x1bO([HF])$/);
    if (ssMatch) return '\x1b[1;' + mod + ssMatch[1];
    // Tab with Shift → reverse tab
    if (key === '\x09' && shiftActive && !ctrlActive) return '\x1b[Z';
    return key;
  }

  function flashBtn(btn) {
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 120);
  }

  function sendKey(btn) {
    if (!btn || !btn.dataset.key) return;
    flashBtn(btn);
    let data =
      btn.dataset.key === 'enter' ? '\r' : btn.dataset.key === 'tab' ? '\x09' : btn.dataset.key;
    data = applyModifiers(data);
    const ms = managed.get(activeId);
    if (ms && ms.ws && ms.ws.readyState === 1) {
      ms.ws.send(JSON.stringify({ type: 'input', data }));
    }
    clearModifiers();
  }

  function stopRepeat() {
    clearTimeout(repeatTimer);
    clearInterval(repeatInterval);
    repeatTimer = null;
    repeatInterval = null;
  }

  function startRepeat(btn) {
    stopRepeat();
    sendKey(btn);
    repeatTimer = setTimeout(() => {
      repeatInterval = setInterval(() => sendKey(btn), 80);
    }, 400);
  }

  ctrlBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleModifier('ctrl');
  });
  shiftBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleModifier('shift');
  });
  ctrlBtn.addEventListener('mousedown', (e) => e.preventDefault());
  shiftBtn.addEventListener('mousedown', (e) => e.preventDefault());
  ctrlBtn.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      keyBarTouched = true;
      toggleModifier('ctrl');
    },
    { passive: false },
  );
  shiftBtn.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      keyBarTouched = true;
      toggleModifier('shift');
    },
    { passive: false },
  );

  let keyBarTouched = false;
  keyBar.addEventListener('mousedown', (e) => {
    if (keyBarTouched) {
      keyBarTouched = false;
      return;
    }
    const btn = e.target.closest('.key-btn');
    if (btn && btn.dataset.key) {
      e.preventDefault();
      startRepeat(btn);
    }
  });
  keyBar.addEventListener('mouseup', stopRepeat);
  keyBar.addEventListener('mouseleave', stopRepeat);

  // Touch handling: allow native scroll when swiping, fire key only on tap
  const SWIPE_THRESHOLD = 10;
  let touchStartX = 0;
  let touchBtn = null;
  let touchMoved = false;

  keyBar.addEventListener(
    'touchstart',
    (e) => {
      keyBarTouched = true;
      touchBtn = e.target.closest('.key-btn');
      touchMoved = false;
      touchStartX = e.touches[0].clientX;
      // Don't preventDefault — let the browser handle scroll
    },
    { passive: true },
  );
  keyBar.addEventListener(
    'touchmove',
    (e) => {
      if (Math.abs(e.touches[0].clientX - touchStartX) > SWIPE_THRESHOLD) {
        touchMoved = true;
        stopRepeat();
      }
    },
    { passive: true },
  );
  keyBar.addEventListener('touchend', (e) => {
    if (!touchMoved && touchBtn && touchBtn.dataset.key) {
      e.preventDefault();
      sendKey(touchBtn);
    }
    stopRepeat();
    touchBtn = null;
  });
  keyBar.addEventListener('touchcancel', () => {
    stopRepeat();
    touchBtn = null;
  });

  keyBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.key-btn');
    if (btn) {
      const ms = managed.get(activeId);
      if (ms) ms.term.focus();
    }
  });
}
