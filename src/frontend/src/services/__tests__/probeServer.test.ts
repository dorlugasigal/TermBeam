// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { probeServer } from '../api';

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Partial<Response>>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(impl as unknown as typeof fetch);
}

function response(init: {
  status?: number;
  type?: ResponseType;
  headers?: Record<string, string>;
  json?: unknown;
}): Partial<Response> {
  const headers = new Headers(init.headers || {});
  const status = init.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    type: init.type ?? 'basic',
    headers,
    json: async () => init.json,
  };
}

describe('probeServer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks without following redirects', async () => {
    const spy = mockFetch(async () =>
      response({ headers: { 'content-type': 'application/json' }, json: { authenticated: true } }),
    );
    await probeServer();
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe('manual');
    expect(init.cache).toBe('no-store');
  });

  it('ok when authenticated', async () => {
    mockFetch(async () =>
      response({ headers: { 'content-type': 'application/json' }, json: { authenticated: true } }),
    );
    expect(await probeServer()).toBe('ok');
  });

  it('auth-expired when the server says so', async () => {
    mockFetch(async () =>
      response({ headers: { 'content-type': 'application/json' }, json: { authenticated: false } }),
    );
    expect(await probeServer()).toBe('auth-expired');
  });

  it('tunnel-auth on the relay redirect (opaqueredirect)', async () => {
    mockFetch(async () => response({ status: 0, type: 'opaqueredirect' }));
    expect(await probeServer()).toBe('tunnel-auth');
  });

  it('tunnel-auth on 401 WWW-Authenticate: tunnel', async () => {
    mockFetch(async () => response({ status: 401, headers: { 'www-authenticate': 'tunnel' } }));
    expect(await probeServer()).toBe('tunnel-auth');
  });

  it('tunnel-auth when an HTML sign-in page is served instead of JSON', async () => {
    mockFetch(async () => response({ status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await probeServer()).toBe('tunnel-auth');
  });

  it('host-unreachable on the relay 404 for an absent host', async () => {
    mockFetch(async () => response({ status: 404 }));
    expect(await probeServer()).toBe('host-unreachable');
  });

  it('host-unreachable on network errors while online', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await probeServer()).toBe('host-unreachable');
  });

  it('offline when the device reports no network', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await probeServer()).toBe('offline');
    spy.mockRestore();
  });
});
