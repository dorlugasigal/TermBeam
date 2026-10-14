import type { MouseEvent } from 'react';

/** Client-side navigation: App listens for popstate and re-renders the route. */
export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * onClick for in-app <a href> links: navigate without a full reload, but leave
 * modified clicks (new tab / window) to the browser.
 */
export function spaLinkHandler(e: MouseEvent<HTMLAnchorElement>): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return;
  }
  const href = e.currentTarget.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  e.preventDefault();
  navigate(href);
}
