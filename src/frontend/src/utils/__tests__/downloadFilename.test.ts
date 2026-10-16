import { describe, expect, it } from 'vitest';
import { getDownloadFilename } from '../downloadFilename';

describe('getDownloadFilename', () => {
  it.each(['한글 보고서.md', '日本語 中文.txt', 'résumé.txt', '결과 🚀.json'])(
    'prefers the UTF-8 filename over the ASCII fallback: %s',
    (name) => {
      const header = `attachment; filename="fallback.txt"; filename*=UTF-8''${encodeURIComponent(name)}`;
      expect(getDownloadFilename(header, 'other.txt')).toBe(name);
    },
  );

  it('accepts a language tag, case-insensitive names, and either parameter order', () => {
    expect(
      getDownloadFilename(
        "attachment; FILENAME*=utf-8'ko'%ED%95%9C%EA%B8%80.txt; filename=legacy.txt",
        '',
      ),
    ).toBe('한글.txt');
  });

  it.each(["UTF-8''%ZZ.txt", "UTF-8''%FF.txt", "ISO-8859-1''caf%E9.txt", "UTF-8''"])(
    'uses the legacy filename when the extended value cannot be decoded: %s',
    (value) => {
      expect(
        getDownloadFilename(`attachment; filename="legacy.txt"; filename*=${value}`, 'path.txt'),
      ).toBe('legacy.txt');
    },
  );

  it('unescapes quoted filenames and keeps embedded semicolons', () => {
    expect(getDownloadFilename('attachment; filename="report; \\"quoted\\".txt"', '')).toBe(
      'report; "quoted".txt',
    );
  });

  it('does not parse a parameter inside a quoted value', () => {
    expect(
      getDownloadFilename('attachment; filename="report; filename*=UTF-8\'\'fake.txt"', ''),
    ).toBe("report; filename*=UTF-8''fake.txt");
  });

  it('keeps literal percent sequences in both UTF-8 and legacy names', () => {
    const name = 'literal%20한글.txt';
    expect(
      getDownloadFilename(`attachment; filename*=UTF-8''${encodeURIComponent(name)}`, ''),
    ).toBe(name);
    expect(getDownloadFilename('attachment; filename="literal%20.txt"', '')).toBe('literal%20.txt');
  });

  it.each([null, 'attachment', 'attachment; filename=""', "attachment; filename*=UTF-8''%FF"])(
    'falls back to the original Unicode basename for %s',
    (header) => {
      expect(getDownloadFilename(header, 'nested/한글%20.txt')).toBe('한글%20.txt');
    },
  );

  it('provides a default when neither source has a filename', () => {
    expect(getDownloadFilename(null, '')).toBe('download');
  });
});
