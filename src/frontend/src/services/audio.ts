let audioCtx: AudioContext | null = null;

function ensureAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as never)['webkitAudioContext'])();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Must be called on a user gesture to unlock audio on mobile
document.addEventListener('click', () => ensureAudioContext(), { once: true });
document.addEventListener('touchstart', () => ensureAudioContext(), { once: true });

export function playNotificationSound(): void {
  try {
    const ctx = ensureAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Audio not available
  }
}

export function isNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem('termbeam-notifications') !== 'false';
  } catch {
    return true;
  }
}

export function setNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem('termbeam-notifications', String(enabled));
  } catch {
    // Storage unavailable
  }
}

export function sendCommandNotification(sessionName: string): void {
  if (!isNotificationsEnabled()) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification('Command finished in ' + sessionName, {
      icon: '/icons/icon-192.png',
      tag: 'termbeam-cmd',
    });
  } catch {
    // Notification API not available
  }
}
