// shared.js — utility functions shared across TermBeam pages

/**
 * Escape a string for safe insertion into HTML.
 * Uses the DOM to handle entity encoding.
 */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/**
 * Textarea-based clipboard copy fallback for non-secure contexts (HTTP over LAN).
 * Returns true if the copy succeeded, false otherwise.
 */
function copyToClipboardFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  document.body.removeChild(ta);
  return ok;
}

/**
 * Register the service worker if supported.
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
