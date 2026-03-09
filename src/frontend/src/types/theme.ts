export interface ThemeDefinition {
  name: string;
  label: string;
  colors: ThemeColors;
  terminal: TerminalTheme;
}

export interface ThemeColors {
  bg: string;
  fg: string;
  fgMuted: string;
  accent: string;
  accentHover: string;
  border: string;
  cardBg: string;
  cardHover: string;
  headerBg: string;
  inputBg: string;
  inputBorder: string;
  inputFocus: string;
  shadow: string;
  scrollThumb: string;
  scrollTrack: string;
  keybarBg: string;
  keybarBtnBg: string;
  keybarBtnHover: string;
  keybarBtnActive: string;
  keybarBtnFg: string;
}

export interface TerminalTheme {
  foreground: string;
  background: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}
