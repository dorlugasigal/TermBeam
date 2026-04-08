/**
 * Parser that converts raw PTY terminal output into structured agent chat
 * messages.  Uses a headless xterm Terminal as a virtual terminal buffer so
 * cursor-movement sequences (CSI H, A, B, etc.) are rendered correctly
 * instead of being naively stripped.
 */

import { Terminal } from '@xterm/xterm';
import type { ToolCallInfo } from '@/stores/agentStore';

// ── Types ──

export type ParsedEvent =
  | { type: 'assistant-message'; content: string; toolCalls: ToolCallInfo[] }
  | { type: 'prompt-ready' }
  | { type: 'thinking-start' }
  | { type: 'raw-output'; data: string };

// ── Virtual-terminal helpers ──

/**
 * Extract visible text from a headless xterm Terminal buffer.
 * Properly handles cursor movement, line wrapping, etc.
 */
function extractVisibleText(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i <= buffer.length - 1; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true)); // trim trailing whitespace
    }
  }
  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
    lines.pop();
  }
  return lines.join('\n');
}

// ── ANSI Stripping (quick checks only — use vterm for display) ──

/**
 * Regex that matches all common ANSI escape sequences.
 */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b\[[\?]?[0-9;]*[hlm]|\x1b[>=<]|\x1b\[\d*[ABCDHJ]|\x1b\[\d*;\d*[Hf]|\r/g;

/** Strip all ANSI escape codes from text, returning clean plaintext. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// ── Prompt Detection ──

/** Patterns that indicate an agent prompt (ready for user input). */
const PROMPT_PATTERNS: RegExp[] = [
  /❯\s*$/,
  /^\s*❯\s*$/,
  /^(?:copilot|claude|opencode|aider)>\s*$/i,
  /\$\s*$/,
  /(?:^|\s)%\s*$/,
  /(?:^|\s)#\s*$/,
  /\w+@[\w.-]+.*[$%#]\s*$/,
  /^\s*\w+>\s*$/,
  /^[▌█▏▎▍▋▊]\s*$/,
  /─❯\s*$/,
];

/**
 * Detect if text looks like a CLI agent prompt (ready for input).
 */
export function isPromptLine(line: string): boolean {
  const clean = stripAnsi(line).trim();
  if (clean.length === 0 || clean.length > 200) return false;
  return PROMPT_PATTERNS.some((pat) => pat.test(clean));
}

/**
 * Check if a line is prompt decoration (powerline, agent prompts, etc.)
 */
function isPromptOrDecoration(line: string): boolean {
  const clean = line.trim();
  if (clean.length === 0) return true;
  if (isPromptLine(clean)) return true;
  // Zsh/powerline prompt decoration
  if (/^[╭╰┌└]─/.test(clean)) return true;
  if (/^[%$#>❯]\s/.test(clean) && clean.length < 120) return true;
  // Copilot CLI prompt with path/branch info
  if (/~\/\S+.*\[.*\]/.test(clean) && clean.length < 150) return true;
  // Purely box-drawing decoration
  if (/^[╭╮╰╯│─━═┌┐└┘├┤┬┴┼\s]+$/.test(clean)) return true;
  return false;
}

// ── CLI Noise Filtering ──

/**
 * Patterns that indicate CLI startup noise (banners, tips, env info).
 * These lines should be suppressed from chat messages entirely.
 */
const STARTUP_NOISE_PATTERNS: RegExp[] = [
  // === Copilot CLI ===
  /^\s*[│|]\s*[╭╮╰╯─━]/,
  /^\s*[╭╮╰╯┌┐└┘│─━═]{3,}/,
  /GitHub Copilot/i,
  /Copilot CLI/i,
  /Describe a task/i,
  /Tip:\s/i,
  /Open in browser/i,
  /Read-only remote/i,
  /All permissions/i,
  /Tool.*path.*URL.*request/i,
  /Environment loaded/i,
  /custom instruction/i,
  /MCP server/i,
  /\d+ plugins?, \d+ skills?/i,
  /Use \/\w+ to/i,
  /Copilot uses AI/i,
  /check for mistakes/i,

  // Status bar / help bar / keyboard shortcuts
  /shift\+tab/i,
  /ctrl\+[a-z]\s*→?\s*[a-z]/i,
  /Unlimited reqs/i,
  /premium request/i,
  /model.*claude|model.*gpt|model.*gemini/i,
  /press.*Esc/i,
  /press.*Enter/i,
  /interactive.*plan/i,
  /mode.*switch/i,
  /(?:session|conversation)\s+\d+/i,

  // === Claude CLI ===
  /^claude\s/i,
  /Claude Code/i,
  /anthropic/i,
  /Available tools/i,
  /Project directory/i,
  /Instructions loaded/i,
  /\d+ instructions? loaded/i,

  // === OpenCode / Aider ===
  /^opencode\s/i,
  /^aider\s/i,
  /model:\s+\S+/i,
  /\(high\)\s*$/,
  /\(\d+x\)\s*$/,

  // === Generic CLI noise ===
  // Pure separator lines (3+ repeated chars)
  /^[━─═╌╍┄┅┈┉▔▁_\-]{3,}\s*$/,
  /^[-=_]{5,}\s*$/,
  // Lines that are purely box-drawing
  /^[╭╮╰╯│─━═┌┐└┘├┤┬┴┼╌╍┄┅┈┉\s]+$/,
  // Version info lines
  /v\d+\.\d+\.\d+/,
  // Empty/whitespace-only decorative lines
  /^[·•●○◦◆◇▪▫\s]+$/,
  // Keyboard shortcut help lines (multiple shortcuts on one line)
  /\b(?:ctrl|alt|shift|cmd|meta)\+\w+\b.*\b(?:ctrl|alt|shift|cmd|meta)\+\w+\b/i,
  // Banner ASCII art (lines with no alphanumeric chars)
  /^[^a-zA-Z0-9]*$/,

  // Git branch/model info lines from CLI status bars
  /^\[.*main\*?%?\]\s*$/,
  /~\/\w+.*\[.*main/,
];

/**
 * Check if a line is CLI noise that should be filtered from messages.
 */
function isCliNoise(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  if (STARTUP_NOISE_PATTERNS.some((pat) => pat.test(trimmed))) return true;
  // Lines with only box-drawing/special characters and no words
  if (/^[^a-zA-Z0-9]*$/.test(trimmed)) return true;
  // Lines shorter than 5 chars of actual text content are likely noise
  const textOnly = trimmed.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  if (textOnly.length > 0 && textOnly.length < 5) return true;
  return false;
}

/**
 * Check if a block of text is primarily CLI noise (>60% noise lines).
 * Used to detect and suppress entire startup banner blocks.
 */
function isPrimarilyNoise(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return true;
  const noiseCount = lines.filter((l) => isCliNoise(l) || isPromptOrDecoration(l)).length;
  return noiseCount / lines.length > 0.4;
}

let toolCallCounter = 0;

function nextToolCallId(): string {
  return `tc-${Date.now()}-${++toolCallCounter}`;
}

/** Box-drawing characters used to wrap tool-call blocks. */
const BOX_CHARS = /[╭╮╰╯│─┌┐└┘├┤┬┴┼]/;

/**
 * Detect tool call markers in text.
 * Returns structured info about file edits, bash commands, search/read ops.
 */
export function detectToolCalls(text: string): ToolCallInfo[] {
  const clean = stripAnsi(text);
  const results: ToolCallInfo[] = [];

  // Strategy 1: Box-drawing wrapped blocks
  const boxBlocks = extractBoxBlocks(clean);
  for (const block of boxBlocks) {
    const info = classifyBlock(block);
    if (info) results.push(info);
  }

  // Strategy 2: Line-based markers (── file:, ── Edit:, etc.)
  const lineMarkers = extractLineMarkers(clean);
  for (const marker of lineMarkers) {
    if (!results.some((r) => r.content.includes(marker.content.slice(0, 40)))) {
      results.push(marker);
    }
  }

  return results;
}

/** Extract content from box-drawing bordered blocks (but not shell prompt decoration). */
function extractBoxBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let inBlock = false;
  let currentBlock: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !inBlock &&
      (trimmed.startsWith('╭') || trimmed.startsWith('┌')) &&
      trimmed.length > 20 &&
      !isPromptOrDecoration(trimmed)
    ) {
      inBlock = true;
      currentBlock = [trimmed];
    } else if (inBlock) {
      currentBlock.push(trimmed);
      if (trimmed.startsWith('╰') || trimmed.startsWith('└')) {
        if (currentBlock.length >= 3) {
          blocks.push(currentBlock.join('\n'));
        }
        inBlock = false;
        currentBlock = [];
      }
    }
  }

  if (inBlock && currentBlock.length >= 3) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks;
}

/** Classify a box-drawing block into a ToolCallInfo. */
function classifyBlock(block: string): ToolCallInfo | null {
  const lines = block.split('\n');
  const content = lines
    .map((l) => l.replace(/^[╭╮╰╯│┌┐└┘├┤]\s?/, '').replace(/\s?[╭╮╰╯│┌┐└┘├┤]$/, ''))
    .join('\n')
    .trim();

  if (!content) return null;

  const firstLine = (content.split('\n')[0] ?? '').toLowerCase();

  if (
    firstLine.includes('bash') ||
    firstLine.includes('command') ||
    firstLine.includes('shell') ||
    content.match(/^\s*\$\s+\S/m)
  ) {
    return {
      id: nextToolCallId(),
      type: 'bash',
      label: extractLabel(firstLine, 'Bash command'),
      content,
      collapsed: true,
    };
  }

  if (
    firstLine.includes('edit') ||
    firstLine.includes('write') ||
    firstLine.includes('create') ||
    content.includes('+++') ||
    content.includes('---')
  ) {
    return {
      id: nextToolCallId(),
      type: 'file-edit',
      label: extractLabel(firstLine, 'File edit'),
      content,
      collapsed: true,
    };
  }

  if (firstLine.includes('search') || firstLine.includes('grep') || firstLine.includes('find')) {
    return {
      id: nextToolCallId(),
      type: 'search',
      label: extractLabel(firstLine, 'Search'),
      content,
      collapsed: true,
    };
  }

  if (firstLine.includes('read') || firstLine.includes('cat') || firstLine.includes('view')) {
    return {
      id: nextToolCallId(),
      type: 'read-file',
      label: extractLabel(firstLine, 'Read file'),
      content,
      collapsed: true,
    };
  }

  return {
    id: nextToolCallId(),
    type: 'other',
    label: extractLabel(firstLine, 'Tool call'),
    content,
    collapsed: true,
  };
}

/** Extract a human-readable label from a tool call header line. */
function extractLabel(line: string, fallback: string): string {
  const cleaned = line.replace(/[─━═╌╍┄┅┈┉]/g, '').trim();
  if (cleaned.length > 0 && cleaned.length < 100) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return fallback;
}

/** Extract tool calls from line-based markers (── file:, ── Edit:, etc.). */
function extractLineMarkers(text: string): ToolCallInfo[] {
  const results: ToolCallInfo[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    const line = rawLine.trim();

    const headerMatch = line.match(/^[─━]+\s*(file|edit|read|search|bash|write|create):\s*(.+)/i);
    if (headerMatch) {
      const kind = (headerMatch[1] ?? '').toLowerCase();
      const target = (headerMatch[2] ?? '').trim();

      const contentLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextRaw = lines[j] ?? '';
        const nextLine = nextRaw.trim();
        if (nextLine.match(/^[─━]+\s*(file|edit|read|search|bash|write|create):/i)) break;
        if (nextLine.match(/^[╭╰┌└]/)) break;
        contentLines.push(nextRaw);
        j++;
      }

      let type: ToolCallInfo['type'] = 'other';
      if (kind === 'file' || kind === 'edit' || kind === 'write' || kind === 'create') {
        type = 'file-edit';
      } else if (kind === 'bash') {
        type = 'bash';
      } else if (kind === 'search') {
        type = 'search';
      } else if (kind === 'read') {
        type = 'read-file';
      }

      results.push({
        id: nextToolCallId(),
        type,
        label: `${kind.charAt(0).toUpperCase() + kind.slice(1)}: ${target}`,
        content: contentLines.join('\n').trim(),
        collapsed: true,
      });

      i = j - 1;
      continue;
    }

    if (line.startsWith('+++ b/') || line.startsWith('+++ a/')) {
      const path = line.slice(6).trim();
      const contentLines: string[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const nextRaw = lines[j] ?? '';
        if (nextRaw.trim().startsWith('+++ ')) break;
        contentLines.push(nextRaw);
        j++;
      }
      results.push({
        id: nextToolCallId(),
        type: 'file-edit',
        label: `Diff: ${path}`,
        content: contentLines.join('\n').trim(),
        collapsed: true,
      });
      i = j - 1;
    }
  }

  return results;
}

// ── Thinking Detection ──

const THINKING_PATTERNS = [/\bthinking\b/i, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, /^\s*\.{3,}\s*$/];

/** @internal exported for potential future use in feed() */
export function isThinkingIndicator(text: string): boolean {
  const clean = stripAnsi(text).trim();
  return THINKING_PATTERNS.some((p) => p.test(clean));
}

// ── Stateful Parser (vterm-backed) ──

/**
 * Remove tool-call content from the clean message text so the
 * assistant-message content contains only prose.
 */
function removeToolCallText(text: string, toolCalls: ToolCallInfo[]): string {
  let result = text;
  for (const tc of toolCalls) {
    const anchor = tc.content.slice(0, 60);
    if (anchor.length > 0) {
      const idx = result.indexOf(anchor);
      if (idx !== -1) {
        const endIdx = result.indexOf(tc.content) !== -1 ? idx + tc.content.length : idx + 60;
        result = result.slice(0, idx) + result.slice(endIdx);
      }
    }
  }
  return result;
}

/**
 * Stateful parser that uses a headless xterm Terminal to properly render
 * PTY output, then extracts clean visible text for the chat UI.
 *
 * The parser does NOT use timers internally. The caller should
 * periodically check `hasPartialMessage()` and call `flush()`
 * after a silence period (e.g. 500ms) to finalize buffered output.
 */
export class AgentOutputParser {
  private vterm: Terminal;
  private lastFeedTime: number;
  private lastUserInput: string;
  private lastExtractedText: string;

  constructor() {
    // Headless terminal — never mounted to DOM
    this.vterm = new Terminal({
      cols: 120,
      rows: 50,
      allowProposedApi: true,
      scrollback: 200,
    });
    this.lastFeedTime = 0;
    this.lastUserInput = '';
    this.lastExtractedText = '';
  }

  /** Record what the user typed so we can filter the PTY echo. */
  setLastUserInput(input: string): void {
    this.lastUserInput = input;
  }

  /**
   * Check if the agent CLI is ready for input by looking for
   * status bar patterns in the vterm buffer.
   */
  isAgentReady(): boolean {
    const text = extractVisibleText(this.vterm);
    // Copilot CLI shows status bar when ready
    if (/shift\+tab/i.test(text) && /switch mode/i.test(text)) return true;
    if (/Unlimited reqs/i.test(text)) return true;
    // Claude CLI shows ❯ prompt when ready
    if (/❯\s*$/.test(text)) return true;
    return false;
  }

  /**
   * Feed raw PTY output data into the virtual terminal.
   * Always emits a raw-output event so the real terminal stays in sync.
   */
  feed(data: string): ParsedEvent[] {
    this.lastFeedTime = Date.now();
    this.vterm.write(data);
    return [{ type: 'raw-output', data }];
  }

  /**
   * Force flush: extract NEW visible text from the vterm, diff against
   * the previous extraction, filter noise, and return a message event.
   */
  flush(): ParsedEvent | null {
    const currentText = extractVisibleText(this.vterm);

    // Compute only the NEW text since last flush
    let newText = currentText;
    if (this.lastExtractedText && currentText.startsWith(this.lastExtractedText)) {
      newText = currentText.slice(this.lastExtractedText.length);
    } else if (this.lastExtractedText) {
      const lastLines = this.lastExtractedText.split('\n');
      const currentLines = currentText.split('\n');
      let overlap = 0;
      for (let i = 0; i < lastLines.length; i++) {
        if (lastLines.slice(i).every((l, j) => l === currentLines[j])) {
          overlap = lastLines.length - i;
          break;
        }
      }
      if (overlap > 0) {
        newText = currentLines.slice(overlap).join('\n');
      }
    }
    this.lastExtractedText = currentText;

    if (newText.trim().length === 0) return null;

    // Filter out prompt lines, command echoes, decoration, CLI noise
    const lines = newText.split('\n');
    const meaningful = lines.filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (isPromptOrDecoration(trimmed)) return false;
      if (isCliNoise(trimmed)) return false;
      if (
        this.lastUserInput &&
        trimmed === this.lastUserInput.trim()
      ) {
        return false;
      }
      if (
        this.lastUserInput &&
        trimmed.startsWith(this.lastUserInput.trim()) &&
        trimmed.length < this.lastUserInput.length + 5
      ) {
        return false;
      }
      return true;
    });

    const content = meaningful.join('\n').trim();
    if (content.length === 0) return null;

    // If the remaining content is still mostly noise, suppress it
    if (isPrimarilyNoise(content)) return null;

    const toolCalls = content.length > 20 ? detectToolCalls(content) : [];
    let finalContent = content;
    if (toolCalls.length > 0) {
      finalContent = removeToolCallText(content, toolCalls);
    }

    if (finalContent.trim().length > 0 || toolCalls.length > 0) {
      return {
        type: 'assistant-message',
        content: finalContent.trim(),
        toolCalls,
      };
    }
    return null;
  }

  /** Get current new content for streaming display without consuming the buffer. */
  getStreamingContent(): string | null {
    const currentText = extractVisibleText(this.vterm);
    if (currentText === this.lastExtractedText) return null;

    let newText = currentText;
    if (this.lastExtractedText && currentText.startsWith(this.lastExtractedText)) {
      newText = currentText.slice(this.lastExtractedText.length);
    } else if (this.lastExtractedText) {
      const lastLines = this.lastExtractedText.split('\n');
      const currentLines = currentText.split('\n');
      let overlap = 0;
      for (let i = 0; i < lastLines.length; i++) {
        if (lastLines.slice(i).every((l, j) => l === currentLines[j])) {
          overlap = lastLines.length - i;
          break;
        }
      }
      if (overlap > 0) {
        newText = currentLines.slice(overlap).join('\n');
      }
    }

    const lines = newText.split('\n');
    const meaningful = lines.filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (isPromptOrDecoration(trimmed)) return false;
      if (isCliNoise(trimmed)) return false;
      if (this.lastUserInput && trimmed === this.lastUserInput.trim()) return false;
      return true;
    });

    const content = meaningful.join('\n').trim();
    return content.length > 0 ? content : null;
  }

  /** Returns true if there is new content since last extraction. */
  hasPartialMessage(): boolean {
    const currentText = extractVisibleText(this.vterm);
    return currentText !== this.lastExtractedText;
  }

  /** Returns the timestamp of the last `feed()` call. */
  getLastFeedTime(): number {
    return this.lastFeedTime;
  }

  /** Reset the parser to initial state. */
  reset(): void {
    this.vterm.reset();
    this.lastFeedTime = 0;
    this.lastUserInput = '';
    this.lastExtractedText = '';
  }
}

// Re-export for testing convenience
export { BOX_CHARS as _BOX_CHARS_RE };
