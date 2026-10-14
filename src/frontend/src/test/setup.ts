/**
 * Node ≥ 25 ships its own `localStorage` global (undefined unless started with
 * --localstorage-file). Vitest won't overwrite existing globals, so jsdom's
 * storage never gets installed — put it back for jsdom test files.
 */
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    if (!globalThis[key]) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value: dom.window[key],
      });
    }
  }
}
