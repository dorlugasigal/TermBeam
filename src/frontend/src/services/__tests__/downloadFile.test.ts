// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFileWithProgress } from '../api';

describe('downloadFileWithProgress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves the original blob under its UTF-8 filename and reports progress', async () => {
    const name = '한글 보고서 🚀.txt';
    const blob = new Blob(['한글 본문', new Uint8Array([0, 255, 128])]);
    const open = vi.fn();
    const progress = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    class MockXHR {
      open = open;
      status = 200;
      response = blob;
      onload = () => {};
      onprogress = (_event: unknown) => {};
      getResponseHeader = () =>
        `attachment; filename="fallback.txt"; filename*=UTF-8''${encodeURIComponent(name)}`;
      send() {
        this.onprogress({ lengthComputable: true, loaded: 3, total: 4 });
        this.onload();
      }
    }
    vi.stubGlobal('XMLHttpRequest', MockXHR);
    let savedName: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      savedName = this.download;
      expect(this.href).toBe('blob:test');
    });

    await downloadFileWithProgress('session', `nested/${name}`, progress);

    expect(savedName).toBe(name);
    expect(open).toHaveBeenCalledWith(
      'GET',
      `/api/sessions/session/download?file=${encodeURIComponent(`nested/${name}`)}`,
    );
    expect(progress).toHaveBeenCalledWith(75);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(document.querySelector('a')).toBeNull();
  });

  it('still rejects unsuccessful HTTP responses', async () => {
    class MockXHR {
      open() {}
      status = 404;
      onload = () => {};
      send() {
        this.onload();
      }
    }
    vi.stubGlobal('XMLHttpRequest', MockXHR);
    await expect(downloadFileWithProgress('session', 'missing.txt')).rejects.toThrow(
      'Download failed: HTTP 404',
    );
  });
});
