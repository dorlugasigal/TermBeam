import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import '@fontsource-variable/mona-sans/standard.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/themes.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/animations.css';
import { watchThemeContrast } from './services/themeContrast';

// Theme-derived contrast tokens (data-tone, --on-accent) — before first paint.
watchThemeContrast();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster position="top-center" visibleToasts={2} duration={4000} gap={8} />
  </React.StrictMode>,
);

// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — non-critical
    });
  });
}

// Re-register push subscription with backend on every page load.
// The server stores subscriptions in memory and loses them on restart.
import('./services/pushSubscription').then(({ ensurePushSubscription }) => {
  ensurePushSubscription();
});
