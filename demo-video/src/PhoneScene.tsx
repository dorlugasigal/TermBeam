import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { PhoneMockup } from "./PhoneMockup";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["latin"],
});

const monoFont = "'CaskaydiaCove Nerd Font Mono', 'CaskaydiaCove NF Mono', monospace";

const GRADIENT_BG =
  "radial-gradient(ellipse at 50% 45%, #1a1a3e 0%, #0f0c29 50%, #0a0a1a 100%)";

// ── Phase timing (frames @ 30fps, 300 total) ────────────
const TAP_FRAME = 35;
const CROSSFADE_START = 45;
const CROSSFADE_END = 65;

// Side panel phases (replaces keyboard/rotation)
const PANEL_OPEN = 130;         // side panel slides in (after test failure)
const PANEL_TAP = 165;          // tap copilot session in panel
const COPILOT_CROSSFADE = 170;  // crossfade terminal → copilot (immediately after tap)
const COPILOT_STAGGER_START = 175; // copilot UI elements stagger in
const PANEL_CLOSE_END = 178;    // panel slides out quickly

// ── Keyboard layout (for copilot typing) ────────────────
const KB_ROWS: string[][] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["⇧", "z", "x", "c", "v", "b", "n", "m", "⌫"],
  ["123", "😊", "space", "⏎"],
];

// Terminal-specific toolbar buttons (iOS terminal keyboard extension)
const TOOLBAR_BUTTONS: { label: string; sub?: string }[] = [
  { label: "↑", sub: "prev" },
  { label: "↓", sub: "next" },
  { label: "←" },
  { label: "→" },
  { label: "Home" },
  { label: "End" },
  { label: "Copy" },
  { label: "Paste" },
  { label: "Tab" },
  { label: "^C", sub: "stop" },
  { label: "↵", sub: "enter" },
];

// ═════════════════════════════════════════════════════════
// Sessions Screen (VS Code themed)
// ═════════════════════════════════════════════════════════
const SessionsScreen: React.FC<{ tapProgress: number }> = ({ tapProgress }) => {
  const tapScale = interpolate(tapProgress, [0, 0.5, 1], [1, 0.95, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <div style={{ width: "100%", height: "100%", background: "#1e1e1e", fontFamily, position: "relative" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 14px 10px",
          textAlign: "center",
          borderBottom: "1px solid #3c3c3c",
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 700, color: "#d4d4d4" }}>
          Term<span style={{ color: "#0078d4" }}>Beam</span>
        </div>
        <div style={{ fontSize: 14, color: "#858585", marginTop: 3 }}>
          Select a session to connect
        </div>
      </div>
      <div
        style={{
          padding: "14px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* Active session card */}
        <div
          style={{
            background: "#252526",
            border: "2px solid #0078d4",
            borderRadius: 10,
            padding: "12px 14px",
            transform: `scale(${tapScale})`,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600, color: "#d4d4d4" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#89d185" }} />
              termbeam
            </div>
            <div style={{ fontSize: 13, color: "#858585", background: "#1e1e1e", padding: "2px 8px", borderRadius: 3 }}>
              PID 4821
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, fontSize: 13, color: "#b0b0b0" }}>
            <span>🐚 /bin/zsh</span>
            <span>📂 ~/Projects</span>
            <span>👥 0</span>
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <div style={{ background: "#0078d4", color: "#fff", borderRadius: 6, padding: "6px 16px", fontSize: 14, fontWeight: 600 }}>
              Connect
            </div>
          </div>
        </div>
      </div>

      {/* Fixed bottom New Session button */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 14,
          right: 14,
          background: "#0078d4",
          color: "#ffffff",
          borderRadius: 10,
          padding: "10px 14px",
          textAlign: "center",
          fontSize: 16,
          fontWeight: 600,
          boxShadow: "0 2px 8px rgba(0, 120, 212, 0.3)",
        }}
      >
        + New Session
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════
// Terminal Screen — shows npm test run with progress
// ═════════════════════════════════════════════════════════
const TerminalScreen: React.FC<{
  frame: number;
  opacity?: number;
}> = ({ frame, opacity = 1 }) => {
  // Terminal typing: "npm test" then output
  const RUN_CMD = "npm test";
  const TYPE_SPD = 2;
  const TYPE_START_F = CROSSFADE_END + 3;
  const charIdx = Math.max(0, Math.floor((frame - TYPE_START_F) / TYPE_SPD));
  const typedCmd = RUN_CMD.slice(0, Math.min(charIdx, RUN_CMD.length));
  const typingDone = charIdx >= RUN_CMD.length;
  const RUN_START = TYPE_START_F + RUN_CMD.length * TYPE_SPD + 8;
  const blink = Math.floor(frame / 15) % 2 === 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#1e1e1e",
        display: "flex",
        flexDirection: "column",
        opacity,
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          height: 42,
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          background: "#252526",
          borderBottom: "1px solid #3c3c3c",
          gap: 5,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            background: "#1e1e1e",
            borderRadius: 5,
            borderLeft: "3px solid #89d185",
            height: 30,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#89d185" }} />
          <span style={{ color: "#d4d4d4", fontWeight: 600, fontSize: 15 }}>termbeam</span>
          <span style={{ color: "#555555", fontSize: 12 }}>3s</span>
        </div>
        <div
          style={{
            width: 28, height: 28, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#6e6e6e", fontSize: 18, fontWeight: 600,
          }}
        >
          +
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#89d185" }} />
        <span style={{ color: "#858585", fontSize: 14, fontWeight: 500 }}>Connected</span>
      </div>

      {/* Terminal content */}
      <div
        style={{
          flex: 1,
          fontFamily: monoFont,
          fontSize: 19,
          lineHeight: 1.7,
          overflow: "hidden",
          padding: "10px 14px",
        }}
      >
        {/* Previous output — ls -la */}
        <div style={{ color: "#858585", fontSize: 18 }}>
          <span style={{ color: "#89d185" }}>❯</span> ls -la src/
        </div>
        <div style={{ color: "#d4d4d4", fontSize: 18 }}>
          total 64
        </div>
        <div style={{ color: "#d4d4d4", fontSize: 18 }}>
          -rw-r--r--  1 user staff  2140 server.js
        </div>
        <div style={{ color: "#d4d4d4", fontSize: 18 }}>
          -rw-r--r--  1 user staff  1820 websocket.js
        </div>
        <div style={{ color: "#d4d4d4", fontSize: 18, marginBottom: 6 }}>
          -rw-r--r--  1 user staff   940 auth.js
        </div>

        {/* Oh-My-Posh prompt */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
          <span style={{ color: "#6c7086", fontSize: 20 }}>╭─</span>
          <span
            style={{
              background: "#1e3a5f",
              color: "#e0e0e0",
              padding: "2px 10px",
              borderRadius: "4px 0 0 4px",
              fontSize: 18,
              fontWeight: 600,
              marginLeft: 4,
            }}
          >
            📁 termbeam
          </span>
          <span
            style={{
              background: "#56cc6c",
              color: "#1a1a2e",
              padding: "2px 10px",
              borderRadius: "0 4px 4px 0",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            ⎇ main ≡
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ color: "#6c7086", fontSize: 20 }}>╰─</span>
          <span style={{ color: "#22da6e", fontSize: 20, fontWeight: 700 }}>❯</span>
          <span style={{ color: "#e6edf3", fontSize: 20, marginLeft: 5 }}>
            {typedCmd}
          </span>
          {!typingDone && (
            <span style={{ color: "#a78bfa", fontSize: 20, opacity: blink ? 1 : 0, marginLeft: 1 }}>▋</span>
          )}
        </div>

        {/* Test output after typing */}
        {typingDone && frame >= RUN_START && (
          <div style={{ marginTop: 8 }}>
            {/* Progress bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <div style={{ width: 120, height: 4, background: "#3c3c3c", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min(100, (frame - RUN_START) * 5)}%`,
                  height: "100%",
                  background: frame - RUN_START >= 20 ? "#f44747" : "#0078d4",
                  borderRadius: 2,
                }} />
              </div>
              <span style={{ fontSize: 16, color: "#858585" }}>
                {frame - RUN_START >= 20 ? "failed" : "running..."}
              </span>
            </div>
            {(() => {
              const showResult1 = frame >= RUN_START + 4;
              const showResult2 = frame >= RUN_START + 8;
              const showRunning = frame >= RUN_START + 12;
              const showFail = frame >= RUN_START + 20;
              const spinChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
              const spinner = spinChars[Math.floor(frame / 3) % spinChars.length];
              return (
                <>
                  {showResult1 && (
                    <div style={{ color: "#89d185", fontSize: 18 }}>  ✓ auth tests (3)</div>
                  )}
                  {showResult2 && (
                    <div style={{ color: "#89d185", fontSize: 18 }}>  ✓ session tests (5)</div>
                  )}
                  {showRunning && !showFail && (
                    <div style={{ color: "#858585", fontSize: 18 }}>
                      <span style={{ color: "#0078d4" }}>{spinner}</span> websocket tests...
                    </div>
                  )}
                  {showFail && (
                    <>
                      <div style={{ color: "#89d185", fontSize: 18 }}>  ✓ websocket tests (3)</div>
                      <div style={{ color: "#f44747", fontSize: 18 }}>  ✗ should reconnect on timeout</div>
                      <div style={{ color: "#858585", fontSize: 18, marginTop: 4 }}>
                        <span style={{ color: "#89d185" }}>11 passing</span>  <span style={{ color: "#f44747" }}>1 failing</span>  <span style={{ color: "#858585" }}>(340ms)</span>
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Keyboard for npm test typing */}
        {(() => {
          const TYPE_START = CROSSFADE_END + 3;
          const CMD = "npm test";
          const TYPE_SPD = 2;
          const KB_APPEAR = TYPE_START - 4;
          const KB_DISAPPEAR = TYPE_START + CMD.length * TYPE_SPD + 6;
          const kbVisible = frame >= KB_APPEAR && frame < KB_DISAPPEAR;
          const kbOp = interpolate(
            frame,
            [KB_APPEAR, KB_APPEAR + 6, KB_DISAPPEAR - 6, KB_DISAPPEAR],
            [0, 1, 1, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          const kbSlide = interpolate(kbOp, [0, 1], [80, 0]);
          const charIdx = Math.floor((frame - TYPE_START) / TYPE_SPD);
          const activeKey = charIdx >= 0 && charIdx < CMD.length ? CMD[charIdx].toLowerCase() : "";

          if (!kbVisible) return null;

          return (
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                background: "#252526",
                borderTop: "1px solid #3c3c3c",
                padding: "6px 3px 20px",
                opacity: kbOp,
                transform: `translateY(${kbSlide}px)`,
              }}
            >
              {/* Terminal toolbar */}
              <div style={{ display: "flex", flexWrap: "nowrap", gap: 2, padding: "2px 2px 4px", borderBottom: "1px solid #3c3c3c", marginBottom: 3, overflow: "hidden" }}>
                {TOOLBAR_BUTTONS.map((btn, i) => (
                  <div
                    key={i}
                    style={{
                      flex: "1 1 0",
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#1c1c1e",
                      borderRadius: 4,
                      padding: "3px 0",
                      minHeight: 30,
                    }}
                  >
                    <span style={{ fontSize: 11, color: "#d4d4d4", fontFamily: monoFont }}>{btn.label}</span>
                    {btn.sub && <span style={{ fontSize: 7, color: "#858585" }}>{btn.sub}</span>}
                  </div>
                ))}
              </div>
              {/* Navigation row */}
              <div style={{ display: "flex", alignItems: "center", padding: "2px 4px 3px", gap: 4, marginBottom: 3 }}>
                <div style={{ display: "flex", gap: 2 }}>
                  <div style={{ width: 36, height: 30, background: "#1c1c1e", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#d4d4d4" }}>∧</div>
                  <div style={{ width: 36, height: 30, background: "#1c1c1e", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#d4d4d4" }}>∨</div>
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ width: 36, height: 30, background: "#1c1c1e", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#d4d4d4" }}>✓</div>
              </div>
              {KB_ROWS.map((row, ri) => (
                <div key={ri} style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 3 }}>
                  {row.map((k, ki) => {
                    const isSpace = k === "space";
                    const isSpecial = ["⇧", "⌫", "123", "😊", "⏎"].includes(k);
                    const isActive = k === activeKey || (isSpace && activeKey === " ");
                    return (
                      <div
                        key={ki}
                        style={{
                          width: isSpace ? 190 : k === "⏎" ? 70 : isSpecial ? 46 : 36,
                          height: 42,
                          background: isActive ? "#0078d4" : isSpecial ? "#3c3c3c" : "#404040",
                          borderRadius: 5,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: isSpace ? 0 : isSpecial ? 15 : 18,
                          color: isActive ? "#fff" : "#d4d4d4",
                          fontFamily: monoFont,
                          transform: isActive ? "scale(1.15) translateY(-6px)" : "none",
                          boxShadow: isActive ? "0 3px 10px rgba(0, 120, 212, 0.4)" : "0 1px 0 rgba(0,0,0,0.3)",
                        }}
                      >
                        {isSpace ? "" : k}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════
// Copilot Terminal Screen (portrait, replaces landscape)
// ═════════════════════════════════════════════════════════
const CopilotTerminalScreen: React.FC<{
  frame: number;
  progress: number;
}> = ({ frame, progress }) => {
  const blink = Math.floor(frame / 15) % 2 === 0;

  const boxOp = interpolate(progress, [0, 0.3], [0, 1], { extrapolateRight: "clamp" });
  const envOp = interpolate(progress, [0.2, 0.5], [0, 1], { extrapolateRight: "clamp" });
  const promptOp = interpolate(progress, [0.4, 0.7], [0, 1], { extrapolateRight: "clamp" });

  const mono: React.CSSProperties = {
    fontFamily: monoFont,
    fontSize: 17,
    lineHeight: 1.6,
  };

  // Keyboard for copilot typing
  const kbVisible = progress > 0.45;
  const magenta = "#d946ef";
  const cyan = "#22d3ee";

  // Typing animation for copilot prompt
  const COPILOT_MSG = "fix the failing tests";
  const TYPE_START_FRAME = 200; // start typing after keyboard is up
  const TYPE_SPD = 2;
  const typedChars = Math.max(0, Math.min(
    Math.floor((frame - TYPE_START_FRAME) / TYPE_SPD),
    COPILOT_MSG.length,
  ));
  const typingDone = typedChars >= COPILOT_MSG.length;
  const TYPE_END_FRAME = TYPE_START_FRAME + COPILOT_MSG.length * TYPE_SPD; // ~242
  const isTyping = frame >= TYPE_START_FRAME;
  const activeKey = typedChars >= 0 && typedChars < COPILOT_MSG.length && isTyping
    ? COPILOT_MSG[typedChars]?.toLowerCase() ?? ""
    : "";

  // AI response after typing
  const AI_THINK_START = TYPE_END_FRAME + 3; // brief pause then thinking
  const AI_RESP_START = AI_THINK_START + 12; // response starts
  const isThinking = frame >= AI_THINK_START && frame < AI_RESP_START;
  const spinChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const aiSpinner = spinChars[Math.floor(frame / 3) % spinChars.length];

  const AI_LINES = [
    { text: "I'll fix the failing test. The issue is in the", color: "#d4d4d4" },
    { text: "reconnect timeout handler - it's not properly", color: "#d4d4d4" },
    { text: "clearing the interval. Let me update the code:", color: "#d4d4d4" },
  ];
  const AI_LINE_GAP = 6; // frames between each line appearing

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#1e1e1e",
        fontFamily: monoFont,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {/* Copilot box */}
      <div
        style={{
          opacity: boxOp,
          border: `1px solid ${magenta}`,
          borderRadius: 6,
          padding: "10px 12px",
          marginBottom: 8,
        }}
      >
        <div style={{ ...mono, whiteSpace: "pre", lineHeight: 1.2 }}>
          <span style={{ color: cyan }}>╭─╮ ╭─╮</span>{"\n"}
          <span style={{ color: cyan }}>╰─╯ ╰─╯</span>{"  "}<span style={{ fontWeight: 700, color: "#89d185" }}>GitHub Copilot</span>{" "}<span style={{ color: "#d4d4d4" }}>v0.0.420</span>{"\n"}
          <span style={{ color: magenta }}>█</span><span style={{ color: "#89d185" }}> ▘▝ </span><span style={{ color: magenta }}>█</span>{"  "}<span style={{ color: "#d4d4d4" }}>Describe a task to get started.</span>{"\n"}
          <span style={{ color: magenta }}>▔▔▔▔</span>
        </div>
      </div>

      {/* Tip + AI warning */}
      <div style={{ opacity: envOp, fontSize: 18, lineHeight: 1.8, marginBottom: 8 }}>
        <div style={{ color: "#d4d4d4" }}>
          Tip: <span style={{ color: cyan }}>/diff</span> Review the changes made in the current directory
        </div>
        <div style={{ color: "#d4d4d4" }}>
          Copilot uses AI, so always check for mistakes.
        </div>
      </div>

      {/* Prompt area */}
      <div style={{ opacity: promptOp }}>
        <div
          style={{
            fontSize: 18,
            marginBottom: 4,
            color: "#858585",
          }}
        >
          <span>
            C:\Projects\T...{" "}
            <span style={{ color: magenta }}>[⊆main*]</span>{" "}
            Claude Opus 4.6 (fast mode){" "}
            <span style={{ color: "#89d185" }}>(high)</span>{" "}
            (30x)
          </span>
        </div>
        <div
          style={{
            borderTop: "1px solid #3c3c3c",
            padding: "6px 0",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ color: "#22da6e", fontSize: 22, fontWeight: 700 }}>❯</span>
          {isTyping ? (
            <span style={{ color: "#d4d4d4", fontSize: 20 }}>
              {COPILOT_MSG.slice(0, typedChars)}
              {!typingDone && <span style={{ color: cyan, opacity: blink ? 1 : 0 }}>▋</span>}
            </span>
          ) : (
            <>
              <span style={{ color: "#858585", fontSize: 18 }}>
                Type @ to mention files, # for issues/PRs, / for commands, or ? for shortcuts
              </span>
            </>
          )}
        </div>

        {/* AI thinking / response */}
        {isThinking && (
          <div style={{ padding: "8px 0", fontSize: 19, color: "#858585" }}>
            <span style={{ color: magenta }}>{aiSpinner}</span> Thinking...
          </div>
        )}
        {frame >= AI_RESP_START && (
          <div style={{ padding: "8px 0", borderTop: "1px solid #3c3c3c" }}>
            <div style={{ fontSize: 16, color: magenta, marginBottom: 6 }}>
              ◇ Copilot
            </div>
            {AI_LINES.map((line, i) => {
              const lineFrame = AI_RESP_START + i * AI_LINE_GAP;
              if (frame < lineFrame) return null;
              const lineOp = interpolate(frame, [lineFrame, lineFrame + 4], [0, 1], { extrapolateRight: "clamp" });
              return (
                <div key={i} style={{ fontSize: 18, color: line.color, opacity: lineOp, lineHeight: 1.6 }}>
                  {line.text}
                </div>
              );
            })}
          </div>
        )}

        {!isThinking && frame < AI_RESP_START && (
          <div
            style={{
              borderTop: "1px solid #3c3c3c",
              fontSize: 17,
              color: "#858585",
              paddingTop: 4,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>shift+tab switch mode</span>
            <span>Unlimited reqs.</span>
          </div>
        )}
      </div>

      {/* Keyboard — hide when AI responds */}
      {kbVisible && frame < AI_THINK_START && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "#252526",
            borderTop: "1px solid #3c3c3c",
            padding: "4px 3px 16px",
          }}
        >
          {/* Terminal toolbar */}
          <div style={{ display: "flex", flexWrap: "nowrap", gap: 2, padding: "2px 2px 4px", borderBottom: "1px solid #3c3c3c", marginBottom: 3, overflow: "hidden" }}>
            {TOOLBAR_BUTTONS.map((btn, i) => (
              <div
                key={i}
                style={{
                  flex: "1 1 0",
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#1c1c1e",
                  borderRadius: 4,
                  padding: "3px 0",
                  minHeight: 30,
                }}
              >
                <span style={{ fontSize: 11, color: "#d4d4d4", fontFamily: monoFont }}>{btn.label}</span>
                {btn.sub && <span style={{ fontSize: 7, color: "#858585" }}>{btn.sub}</span>}
              </div>
            ))}
          </div>
          {/* Navigation row */}
          <div style={{ display: "flex", alignItems: "center", padding: "2px 4px 3px", gap: 4, marginBottom: 3 }}>
            <div style={{ display: "flex", gap: 2 }}>
              <div style={{ width: 36, height: 30, background: "#1c1c1e", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#d4d4d4" }}>∧</div>
              <div style={{ width: 36, height: 30, background: "#1c1c1e", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#d4d4d4" }}>∨</div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ width: 36, height: 30, background: "#1c1c1e", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#d4d4d4" }}>✓</div>
          </div>
          {KB_ROWS.map((row, ri) => (
            <div key={ri} style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 3 }}>
              {row.map((k, ki) => {
                const isSpace = k === "space";
                const isSpecial = ["⇧", "⌫", "123", "😊", "⏎"].includes(k);
                const isActive = k === activeKey || (isSpace && activeKey === " ");
                return (
                  <div
                    key={ki}
                    style={{
                      width: isSpace ? 190 : k === "⏎" ? 70 : isSpecial ? 46 : 36,
                      height: 42,
                      background: isActive ? "#0078d4" : isSpecial ? "#3c3c3c" : "#404040",
                      borderRadius: 5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: isSpace ? 0 : isSpecial ? 15 : 18,
                      color: isActive ? "#fff" : "#d4d4d4",
                      fontFamily: monoFont,
                      transform: isActive ? "scale(1.15) translateY(-5px)" : "none",
                      boxShadow: isActive ? "0 3px 10px rgba(0, 120, 212, 0.4)" : "0 1px 0 rgba(0,0,0,0.3)",
                    }}
                  >
                    {isSpace ? "" : k}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════
// Side Panel — session list overlay
// ═════════════════════════════════════════════════════════
const SidePanel: React.FC<{
  frame: number;
  slideProgress: number;
  tapProgress: number;
}> = ({ frame, slideProgress, tapProgress }) => {
  const copilotTapScale = interpolate(tapProgress, [0, 0.5, 1], [1, 0.95, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const spinChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinner = spinChars[Math.floor(frame / 3) % spinChars.length];

  const copilotSelected = frame >= PANEL_TAP;
  const termbeamBorder = copilotSelected ? "1px solid #3c3c3c" : "2px solid #0078d4";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width: "100%",
        background: "#1e1e1e",
        transform: `translateX(${-(1 - slideProgress) * 100}%)`,
        display: "flex",
        flexDirection: "column",
        fontFamily,
        zIndex: 20,
        boxShadow: "4px 0 20px rgba(0,0,0,0.3)",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: "12px 14px 8px",
          borderBottom: "1px solid #3c3c3c",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "#d4d4d4" }}>
          Sessions
        </div>
        <div style={{ color: "#858585", fontSize: 20, cursor: "pointer" }}>×</div>
      </div>

      {/* Session cards */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        {/* termbeam session */}
        <div
          style={{
            background: "#252526",
            border: termbeamBorder,
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#89d185" }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: "#d4d4d4" }}>termbeam</span>
            <span style={{ fontSize: 12, color: "#858585", marginLeft: "auto" }}>PID 4821</span>
          </div>
          <div style={{ fontSize: 12, color: "#858585" }}>🐚 /bin/zsh · 📂 ~/Projects/termbeam · 👥 0</div>
          <div
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              color: "#858585",
              fontSize: 14,
              cursor: "pointer",
              width: 20,
              height: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </div>
        </div>

        {/* copilot session */}
        <div
          style={{
            background: copilotSelected ? "#252526" : "#1e1e1e",
            border: copilotSelected ? "2px solid #0078d4" : "1px solid #3c3c3c",
            borderRadius: 8,
            padding: "10px 12px",
            transform: `scale(${copilotTapScale})`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: copilotSelected ? "#0078d4" : "#858585" }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: "#d4d4d4" }}>copilot</span>
            {copilotSelected && (
              <span style={{ fontSize: 11, color: "#0078d4", marginLeft: "auto" }}>
                {spinner} connecting
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#858585" }}>🐚 copilot-cli · 📂 ~/Projects/termbeam · 👥 0</div>
        </div>
      </div>

      {/* Bottom: + New Session */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid #3c3c3c",
        }}
      >
        <div
          style={{
            background: "#0078d4",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 12px",
            textAlign: "center",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          + New Session
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════
// Main PhoneScene
// Sessions → tap → terminal (npm test) → side panel opens →
// tap copilot session → crossfade to Copilot CLI (portrait)
// ═════════════════════════════════════════════════════════
export const PhoneScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── 1. Phone entrance (spring from right) ─────────────
  const entS = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120 },
  });
  const entranceX = interpolate(entS, [0, 1], [600, 0]);
  const entranceOp = interpolate(entS, [0, 1], [0, 1]);
  const entranceRotY = interpolate(entS, [0, 1], [30, 0]);

  // ── 2. Camera zoom (cinematic section crops) ─────────
  const snapInP = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 15, stiffness: 180 },
  });
  let camScale: number;
  let camTY: number;
  let camTX: number;
  let camRotX: number;
  let camRotY: number;
  if (frame < CROSSFADE_START) {
    // Phase 1: Zoomed to session card (centered)
    camScale = interpolate(snapInP, [0, 1], [1, 1.8]);
    camTY = interpolate(snapInP, [0, 1], [0, 350]);
    camTX = interpolate(snapInP, [0, 1], [0, 0]);
    camRotX = 0;
    camRotY = 0;
  } else if (frame < PANEL_OPEN) {
    // Phase 2: Terminal — zoom out to show full phone
    const t2 = interpolate(frame, [CROSSFADE_START, CROSSFADE_START + 15], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    const e2 = Easing.inOut(Easing.cubic)(t2);
    camScale = interpolate(e2, [0, 1], [1.8, 1.0]);
    camTY = interpolate(e2, [0, 1], [350, 0]);
    camTX = interpolate(e2, [0, 1], [0, 0]);
    camRotX = 0;
    camRotY = 0;
  } else if (frame < PANEL_CLOSE_END) {
    // Phase 3: Side panel — zoom to show panel area
    const t3 = interpolate(frame, [PANEL_OPEN, PANEL_OPEN + 12], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    const e3 = Easing.inOut(Easing.cubic)(t3);
    camScale = interpolate(e3, [0, 1], [1.0, 1.8]);
    camTY = interpolate(e3, [0, 1], [0, 350]);
    camTX = interpolate(e3, [0, 1], [0, 0]);
    camRotX = 0;
    camRotY = 0;
  } else {
    // Phase 4: Zoom out to show copilot view
    const t4 = interpolate(frame, [PANEL_CLOSE_END, PANEL_CLOSE_END + 20], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    const e4 = Easing.out(Easing.cubic)(t4);
    camScale = interpolate(e4, [0, 1], [1.8, 1.0]);
    camTY = interpolate(e4, [0, 1], [350, 0]);
    camTX = interpolate(e4, [0, 1], [0, 0]);
    camRotX = 0;
    camRotY = 0;
  }
  // Subtle camera sway when zoomed
  const cameraSway = Math.sin(frame * 0.04) * 8 * (camScale > 1.3 ? 1 : 0);

  // ── Composite phone transform (no rotation) ──────────
  const posX = entranceX;

  // Gentle sway
  const sway = Math.sin(frame * 0.02) * 0.3;

  // ── Tap animation ─────────────────────────────────────
  const tapP = interpolate(
    frame,
    [TAP_FRAME, TAP_FRAME + 6, TAP_FRAME + 12],
    [0, 1, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" },
  );
  const fingerVis = frame >= TAP_FRAME && frame < TAP_FRAME + 25;
  const fingerOp = interpolate(
    frame,
    [TAP_FRAME, TAP_FRAME + 5, TAP_FRAME + 20, TAP_FRAME + 25],
    [0, 0.6, 0.6, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // ── Ring pulse ────────────────────────────────────────
  const ringScale = interpolate(
    frame,
    [TAP_FRAME, TAP_FRAME + 55],
    [0.5, 8],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );
  const ringOp = interpolate(
    frame,
    [TAP_FRAME, TAP_FRAME + 55],
    [0.6, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // ── Content crossfades ────────────────────────────────
  // Sessions → terminal (slide transition)
  const sessionsSlide = interpolate(
    frame,
    [CROSSFADE_START, CROSSFADE_END],
    [0, -100],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const terminalSlide = interpolate(
    frame,
    [CROSSFADE_START, CROSSFADE_END],
    [100, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // ── Side panel ────────────────────────────────────────
  const panelSlide = (() => {
    if (frame < PANEL_OPEN) return 0;
    if (frame < PANEL_CLOSE_END) {
      return interpolate(frame, [PANEL_OPEN, PANEL_OPEN + 15], [0, 1], {
        extrapolateLeft: "clamp", extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      });
    }
    return interpolate(frame, [PANEL_CLOSE_END, PANEL_CLOSE_END + 10], [1, 0], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    });
  })();
  const showPanel = frame >= PANEL_OPEN && frame < PANEL_CLOSE_END;

  // Panel tap animation
  const panelTapP = interpolate(
    frame,
    [PANEL_TAP, PANEL_TAP + 6, PANEL_TAP + 12],
    [0, 1, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" },
  );
  const panelFingerVis = frame >= PANEL_TAP && frame < PANEL_TAP + 20;
  const panelFingerOp = interpolate(
    frame,
    [PANEL_TAP, PANEL_TAP + 5, PANEL_TAP + 15, PANEL_TAP + 20],
    [0, 0.6, 0.6, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const panelRingScale = interpolate(
    frame,
    [PANEL_TAP, PANEL_TAP + 55],
    [0.5, 8],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );
  const panelRingOp = interpolate(
    frame,
    [PANEL_TAP, PANEL_TAP + 55],
    [0.6, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Terminal → Copilot crossfade
  const terminalOp = frame >= COPILOT_CROSSFADE
    ? interpolate(frame, [COPILOT_CROSSFADE, COPILOT_CROSSFADE + 15], [1, 0], { extrapolateRight: "clamp" })
    : 1;
  const copilotOp = frame >= COPILOT_CROSSFADE
    ? interpolate(frame, [COPILOT_CROSSFADE, COPILOT_CROSSFADE + 15], [0, 1], { extrapolateRight: "clamp" })
    : 0;

  // Copilot UI stagger
  const copilotP = frame >= COPILOT_STAGGER_START
    ? interpolate(frame, [COPILOT_STAGGER_START, COPILOT_STAGGER_START + 40], [0, 1], {
        extrapolateRight: "clamp",
      })
    : 0;

  // ── Phone exit (scale down + fade out at end) ─────────
  const PHONE_EXIT_START = 280;
  const exitScale = frame >= PHONE_EXIT_START
    ? interpolate(frame, [PHONE_EXIT_START, 300], [1, 0.85], { extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) })
    : 1;
  const exitOp = frame >= PHONE_EXIT_START
    ? interpolate(frame, [PHONE_EXIT_START, 300], [1, 0], { extrapolateRight: "clamp" })
    : 1;

  return (
    <AbsoluteFill
      style={{
        background: GRADIENT_BG,
        justifyContent: "center",
        alignItems: "center",
        fontFamily,
        perspective: 1800,
        overflow: "hidden",
      }}
    >
      {/* Camera wrapper for cinematic zoom + 3D tilt */}
      <div
        style={{
          transform: `perspective(1800px) rotateX(${camRotX}deg) rotateY(${camRotY}deg) translateY(${camTY + cameraSway}px) translateX(${camTX}px) scale(${camScale * exitScale})`,
          transformOrigin: "center center",
          opacity: exitOp,
        }}
      >
        <div style={{ position: "relative" }}>
          {/* Ring pulse */}
          {frame >= TAP_FRAME && frame < TAP_FRAME + 60 && (
            <div
              style={{
                position: "absolute",
                top: 160,
                left: "50%",
                width: 300,
                height: 300,
                borderRadius: "50%",
                border: "2px solid #0078d4",
                transform: `translate(-50%, -50%) scale(${ringScale})`,
                opacity: ringOp,
                pointerEvents: "none",
              }}
            />
          )}

          {/* Panel tap ring — behind phone */}
          {frame >= PANEL_TAP && frame < PANEL_TAP + 60 && (
            <div
              style={{
                position: "absolute",
                top: 160,
                left: "50%",
                width: 300,
                height: 300,
                borderRadius: "50%",
                border: "2px solid #0078d4",
                transform: `translate(-50%, -50%) scale(${panelRingScale})`,
                opacity: panelRingOp,
                pointerEvents: "none",
              }}
            />
          )}

          <div
            style={{
              transform: [
                `translateX(${posX}px)`,
                `translateY(0px)`,
                `rotateY(${entranceRotY + sway}deg)`,
              ].join(" "),
              opacity: entranceOp,
              transformStyle: "preserve-3d",
            }}
          >
            <PhoneMockup scale={1.2}>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "100%",
                }}
              >
                {/* Sessions screen */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    transform: `translateX(${sessionsSlide}%)`,
                    zIndex: frame < CROSSFADE_END ? 2 : 0,
                  }}
                >
                  <SessionsScreen tapProgress={tapP} />
                </div>

                {/* Terminal screen */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    transform: `translateX(${terminalSlide}%)`,
                    zIndex: frame >= CROSSFADE_END ? 2 : 0,
                  }}
                >
                  <TerminalScreen frame={frame} opacity={terminalOp} />
                </div>

                {/* Copilot screen (crossfades in) */}
                {frame >= COPILOT_CROSSFADE && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      opacity: copilotOp,
                      zIndex: 3,
                    }}
                  >
                    <CopilotTerminalScreen frame={frame} progress={copilotP} />
                  </div>
                )}

                {/* Side panel */}
                {(showPanel || panelSlide > 0) && (
                  <SidePanel
                    frame={frame}
                    slideProgress={panelSlide}
                    tapProgress={panelTapP}
                  />
                )}

                {/* Panel tap finger */}
                {panelFingerVis && (
                  <div
                    style={{
                      position: "absolute",
                      top: 155,
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: "rgba(0, 120, 212, 0.2)",
                      border: "2px solid rgba(0, 120, 212, 0.5)",
                      opacity: panelFingerOp,
                      boxShadow: "0 0 16px rgba(0, 120, 212, 0.3)",
                      zIndex: 25,
                    }}
                  />
                )}
                {/* Panel tap ring removed — moved outside PhoneMockup */}
              </div>
            </PhoneMockup>

            {/* Finger tap indicator (sessions screen) */}
            {fingerVis && (
              <div
                style={{
                  position: "absolute",
                  top: 160,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "rgba(0, 120, 212, 0.2)",
                  border: "2px solid rgba(0, 120, 212, 0.5)",
                  opacity: fingerOp,
                  boxShadow: "0 0 20px rgba(0, 120, 212, 0.3)",
                }}
              />
            )}

          </div>
        </div>
      </div>

      {/* Tap sound effect */}
      <Sequence from={TAP_FRAME} durationInFrames={6}>
        <Audio src={staticFile("tap.wav")} volume={0.35} />
      </Sequence>

      {/* Panel tap sound */}
      <Sequence from={PANEL_TAP} durationInFrames={6}>
        <Audio src={staticFile("tap.wav")} volume={0.3} />
      </Sequence>

      {/* Ambient glow */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(124, 58, 237, 0.1) 0%, transparent 70%)",
          pointerEvents: "none",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
    </AbsoluteFill>
  );
};
