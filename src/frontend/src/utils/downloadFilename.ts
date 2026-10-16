/** Read RFC 6266 filenames, preferring the UTF-8 extended parameter. */
export function getDownloadFilename(disposition: string | null, filePath: string): string {
  const parameters = new Map<string, string>();
  // Consume complete quoted values, including embedded semicolons and escapes,
  // so text inside a filename cannot be mistaken for another parameter.
  const pattern = /;\s*([^=;\s]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/g;
  for (const match of disposition?.matchAll(pattern) ?? []) {
    const value = match[2]!.trim();
    parameters.set(
      match[1]!.toLowerCase(),
      value.startsWith('"') ? value.slice(1, -1).replace(/\\(.)/g, '$1') : value,
    );
  }

  const extended = parameters.get('filename*')?.match(/^UTF-8'[^']*'(.*)$/i);
  if (extended) {
    try {
      const filename = decodeURIComponent(extended[1]!);
      if (filename) return filename;
    } catch {
      // A malformed header should not prevent downloading the file.
    }
  }

  // These names are already decoded. Literal % sequences must stay unchanged.
  return parameters.get('filename') || filePath.split('/').pop() || 'download';
}
