/**
 * Strip ANSI escape sequences and control characters from text that will be
 * quoted back into a terminal. The selected diff lines may contain escape
 * codes (e.g. from a file that itself renders coloured output), and any CSI
 * or OSC sequences pasted into a live shell would be interpreted, not shown.
 *
 * We also drop most C0 control chars (except \n and \t) so a crafted file
 * can't e.g. send SIGINT (\x03) or Ctrl-D (\x04) when the comment is pasted.
 */

const ANSI_CSI_OSC = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI_OTHER = /\x1b[@-Z\\-_]/g;
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function sanitizeTerminalInput(input: string): string {
  if (!input) return '';
  return input
    .replace(ANSI_CSI_OSC, '')
    .replace(ANSI_OTHER, '')
    .replace(CONTROL_CHARS, '');
}

/**
 * Wrap text in bracketed-paste markers so the shell (bash, zsh, fish, readline)
 * treats it atomically — multiline input won't execute line-by-line.
 *
 * This is best-effort: shells without bracketed-paste enabled simply see the
 * markers as literal text (harmless escape sequences at the edges).
 */
export function wrapBracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}
