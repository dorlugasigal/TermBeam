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
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { PhoneMockup } from "./PhoneMockup";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["latin"],
});

const { fontFamily: monoFont } = loadMono("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

const GRADIENT_BG =
  "radial-gradient(ellipse at 50% 45%, #1a1a3e 0%, #0f0c29 50%, #0a0a1a 100%)";

// ── Phase timing (frames @ 30fps, 300 total) ────────────
const TAP_FRAME = 35;
const CROSSFADE_START = 45;
const CROSSFADE_END = 65;
const KB_START = 100;
const KB_END = 115;
const TYPE_START = 120;
const CHAR_SPEED = 5;
const COPILOT_CMD = "copilot";
const TYPE_END = TYPE_START + COPILOT_CMD.length * CHAR_SPEED; // 155
const ENTER_FRAME = TYPE_END + 3; // 158
const ROTATE_START = 170;
const ROTATE_END = 195;
const COPILOT_SHOW = 200;

// ── Keyboard layout ────────────────────────────────────
const KB_ROWS: string[][] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["⇧", "z", "x", "c", "v", "b", "n", "m", "⌫"],
  ["123", "🌐", " ", "return"],
];

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

// ═════════════════════════════════════════════════════════
// Sessions Screen
// ═════════════════════════════════════════════════════════
const SessionsScreen: React.FC<{ tapProgress: number }> = ({ tapProgress }) => {
  const tapScale = interpolate(tapProgress, [0, 0.5, 1], [1, 0.95, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <div style={{ width: "100%", height: "100%", background: "#1a1a2e", fontFamily }}>
      <div
        style={{
          padding: "18px 16px 12px",
          textAlign: "center",
          borderBottom: "1px solid #0f3460",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, color: "#e0e0e0" }}>
          Term<span style={{ color: "#a78bfa" }}>Beam</span>
        </div>
        <div style={{ fontSize: 13, color: "#6c7086", marginTop: 4 }}>
          Select a session to connect
        </div>
      </div>
      <div
        style={{
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            background: "#16213e",
            border: "1px solid #533483",
            borderRadius: 12,
            padding: "14px 16px",
            transform: `scale(${tapScale})`,
            boxShadow:
              tapProgress > 0.3
                ? "0 0 24px rgba(83, 52, 131, 0.4)"
                : "none",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: "#e0e0e0" }}>
              termbeam
            </div>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#2ecc71",
                boxShadow: "0 0 8px #2ecc71",
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 5 }}>
            /bin/zsh · termbeam
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>
            Active · 0 connections
          </div>
        </div>
        <div
          style={{
            background: "transparent",
            border: "1px dashed #0f3460",
            borderRadius: 12,
            padding: "12px 16px",
            textAlign: "center",
            fontSize: 14,
            color: "#555",
          }}
        >
          + New Session
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════
// Terminal Screen (Oh-My-Posh prompt)
// ═════════════════════════════════════════════════════════
const TerminalScreen: React.FC<{
  frame: number;
  typedChars: number;
  showCursor: boolean;
  showLoading: boolean;
  kbSlide: number;
}> = ({ frame, typedChars, showCursor, showLoading, kbSlide }) => {
  const blink = Math.floor(frame / 15) % 2 === 0;
  const spinIdx = Math.floor(frame / 3) % SPINNER.length;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0d1117",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Nav bar */}
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          background: "#161b22",
          borderBottom: "1px solid #30363d",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#8b949e", fontSize: 18 }}>‹</span>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "#3fb950",
              boxShadow: "0 0 6px rgba(63,185,80,0.5)",
            }}
          />
          <span
            style={{
              color: "#e6edf3",
              fontWeight: 700,
              fontSize: 15,
              fontFamily: monoFont,
            }}
          >
            termbeam
          </span>
        </div>
        <span
          style={{
            color: "#8b949e",
            fontSize: 12,
            fontWeight: 500,
            fontFamily,
          }}
        >
          Connected
        </span>
      </div>

      {/* Terminal content */}
      <div
        style={{
          flex: 1,
          fontFamily: monoFont,
          fontSize: 13,
          lineHeight: 1.7,
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 14px", transform: `translateY(${-kbSlide * 200}px)` }}>
        {/* Previous output — ls -la */}
        <div style={{ color: "#8b949e", fontSize: 12 }}>
          <span style={{ color: "#3fb950" }}>❯</span> ls -la
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          total 120
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          drwxr-xr-x  15 user staff  480 Feb 27 09:41 .
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          -rw-r--r--   1 user staff 1234 Feb 27 09:40 package.json
        </div>
        <div style={{ color: "#6c7086", fontSize: 12, marginBottom: 4 }}>
          -rw-r--r--   1 user staff  892 Feb 27 09:40 server.js
        </div>

        {/* git status */}
        <div style={{ color: "#8b949e", fontSize: 12 }}>
          <span style={{ color: "#3fb950" }}>❯</span> git status
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          On branch main
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          {"Your branch is up to date with 'origin/main'"}
        </div>
        <div style={{ color: "#6c7086", fontSize: 12, marginBottom: 4 }}>
          nothing to commit, working tree clean
        </div>

        {/* git pull */}
        <div style={{ color: "#8b949e", fontSize: 12 }}>
          <span style={{ color: "#3fb950" }}>❯</span> git pull origin main
        </div>
        <div style={{ color: "#6c7086", fontSize: 12, marginBottom: 4 }}>
          Already up to date.
        </div>

        {/* npm install */}
        <div style={{ color: "#8b949e", fontSize: 12 }}>
          <span style={{ color: "#3fb950" }}>❯</span> npm install
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          added 0 packages, audited 156 packages in 2s
        </div>
        <div style={{ color: "#6c7086", fontSize: 12, marginBottom: 4 }}>
          found 0 vulnerabilities
        </div>

        {/* cat src/server.js */}
        <div style={{ color: "#8b949e", fontSize: 12 }}>
          <span style={{ color: "#3fb950" }}>❯</span> cat src/server.js | head -5
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          {"const express = require('express');"}
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          {"const { createServer } = require('http');"}
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          {"const { WebSocketServer } = require('ws');"}
        </div>
        <div style={{ color: "#6c7086", fontSize: 12 }}>
          {"const { setupAuth } = require('./auth');"}
        </div>
        <div style={{ color: "#6c7086", fontSize: 12, marginBottom: 4 }}>
          {"const { createSession } = require('./sessions');"}
        </div>

        {/* npm test */}
        <div style={{ color: "#8b949e", fontSize: 12 }}>
          <span style={{ color: "#3fb950" }}>❯</span> npm test
        </div>
        <div style={{ color: "#3fb950", fontSize: 12 }}>
          &nbsp;&nbsp;✓ auth tests (3)
        </div>
        <div style={{ color: "#3fb950", fontSize: 12 }}>
          &nbsp;&nbsp;✓ session tests (5)
        </div>
        <div style={{ color: "#6c7086", fontSize: 12, marginBottom: 16 }}>
          &nbsp;&nbsp;8 passing (120ms)
        </div>
        <div style={{ height: 8 }} />

        {/* Oh-My-Posh prompt line 1 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 2,
          }}
        >
          <span style={{ color: "#6c7086", fontSize: 14 }}>╭─</span>
          <span
            style={{
              background: "#1e3a5f",
              color: "#e0e0e0",
              padding: "2px 10px",
              borderRadius: "4px 0 0 4px",
              fontSize: 12,
              fontWeight: 600,
              marginLeft: 6,
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
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            ⎇ main ≡
          </span>
        </div>

        {/* Oh-My-Posh prompt line 2 + typed text */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ color: "#6c7086", fontSize: 14 }}>╰─</span>
          <span style={{ color: "#22da6e", fontSize: 14, fontWeight: 700 }}>
            ❯
          </span>
          <span
            style={{
              color: "#e6edf3",
              fontSize: 14,
              marginLeft: 6,
            }}
          >
            {COPILOT_CMD.slice(0, typedChars)}
          </span>
          {showCursor && (
            <span
              style={{
                color: "#a78bfa",
                opacity: blink ? 1 : 0,
                fontSize: 14,
                marginLeft: 1,
              }}
            >
              ▋
            </span>
          )}
        </div>

        {/* Loading after enter */}
        {showLoading && (
          <div
            style={{
              color: "#6c7086",
              fontSize: 12,
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ color: "#a78bfa" }}>{SPINNER[spinIdx]}</span>
            Starting GitHub Copilot...
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════
// iOS Keyboard (dark theme)
// ═════════════════════════════════════════════════════════
const IOSKeyboard: React.FC<{
  activeKey: string | null;
  slideProgress: number;
}> = ({ activeKey, slideProgress }) => {
  const KB_HEIGHT = 216;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: KB_HEIGHT,
        background: "#1c1c1e",
        borderTop: "1px solid #3a3a3c",
        transform: `translateY(${(1 - slideProgress) * KB_HEIGHT}px)`,
        display: "flex",
        flexDirection: "column",
        padding: "8px 3px 24px",
        gap: 6,
        zIndex: 10,
      }}
    >
      {KB_ROWS.map((row, ri) => (
        <div
          key={ri}
          style={{
            display: "flex",
            justifyContent: "center",
            gap: ri === 3 ? 6 : 4,
          }}
        >
          {row.map((key, ki) => {
            const isActive = activeKey !== null && key === activeKey;
            const isSpace = key === " ";
            const isSpecial = ["⇧", "⌫", "123", "🌐", "return"].includes(
              key,
            );
            const w = isSpace
              ? 186
              : key === "return"
                ? 74
                : key === "123" || key === "🌐"
                  ? 42
                  : isSpecial
                    ? 44
                    : 33;

            return (
              <div
                key={ki}
                style={{
                  width: w,
                  height: 42,
                  background: isActive
                    ? "#a78bfa"
                    : isSpecial
                      ? "#3a3a3c"
                      : "#525254",
                  borderRadius: 5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: isSpace
                    ? 0
                    : key === "return"
                      ? 11
                      : isSpecial
                        ? 13
                        : 17,
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? "#fff" : "#e0e0e0",
                  fontFamily: isSpecial ? fontFamily : monoFont,
                  transform: isActive
                    ? "scale(1.2) translateY(-8px)"
                    : "none",
                  boxShadow: isActive
                    ? "0 4px 12px rgba(167, 139, 250, 0.5)"
                    : "0 1px 0 rgba(0,0,0,0.4)",
                }}
              >
                {isSpace ? "" : key}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

// ═════════════════════════════════════════════════════════
// Copilot CLI Screen (landscape, counter-rotated -90°)
// Rendered inside portrait PhoneMockup content (390×790),
// but oriented as 790×390 landscape via rotate(-90deg).
// When phone rotates +90° (counter-clockwise), content
// appears upright to the viewer.
// ═════════════════════════════════════════════════════════
const CopilotScreen: React.FC<{ frame: number; progress: number }> = ({
  frame,
  progress,
}) => {
  const blink = Math.floor(frame / 15) % 2 === 0;

  const boxOp = interpolate(progress, [0, 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });
  const infoOp = interpolate(progress, [0.2, 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });
  const promptOp = interpolate(progress, [0.4, 0.7], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: 790,
        height: 390,
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%) rotate(-90deg)",
        transformOrigin: "center center",
        background: "#0d1117",
        fontFamily: monoFont,
        padding: "12px 18px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Copilot box */}
      <div
        style={{
          opacity: boxOp,
          border: "1px solid #30363d",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ fontSize: 11, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#e6edf3" }}>
              GitHub Copilot{" "}
              <span style={{ color: "#6c7086", fontWeight: 400 }}>
                v0.0.419-1
              </span>
            </div>
            <div style={{ color: "#8b949e", marginTop: 2 }}>
              Describe a task to get started.
            </div>
            <div style={{ color: "#6c7086", marginTop: 6, fontSize: 10 }}>
              Tip: <span style={{ color: "#a78bfa" }}>/cwd</span> Change working
              directory
            </div>
            <div style={{ color: "#6c7086", fontSize: 10 }}>
              Copilot uses AI, so always check for mistakes.
            </div>
          </div>
        </div>
      </div>

      {/* Info bullets */}
      <div
        style={{
          opacity: infoOp,
          fontSize: 10,
          lineHeight: 1.8,
          marginBottom: 8,
        }}
      >
        <div style={{ color: "#6c7086" }}>
          <span style={{ color: "#f9e2af" }}>●</span>{" "}
          <span style={{ color: "#f9e2af" }}>💡</span> No copilot instructions
          found. Run <span style={{ color: "#a78bfa" }}>/init</span> to generate.
        </div>
        <div style={{ color: "#6c7086" }}>
          <span style={{ color: "#3fb950" }}>●</span> Environment loaded:{" "}
          <span style={{ color: "#e6edf3" }}>5 skills</span>, VS Code connected
        </div>
      </div>

      {/* Prompt area */}
      <div style={{ opacity: promptOp }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            marginBottom: 4,
            color: "#6c7086",
          }}
        >
          <span>
            ~/Projects/termbeam{" "}
            <span style={{ color: "#a78bfa" }}>[⎇ main*]</span>
          </span>
          <span>
            claude-opus-4.6{" "}
            <span style={{ color: "#3fb950" }}>(high)</span>
          </span>
        </div>
        <div
          style={{
            borderTop: "1px solid #30363d",
            padding: "8px 0",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: "#22da6e", fontSize: 14, fontWeight: 700 }}>
            ❯
          </span>
          <span style={{ color: "#6c7086", fontSize: 11 }}>
            Type @ to mention files, / for commands
          </span>
          <span
            style={{
              color: "#a78bfa",
              fontSize: 14,
              opacity: blink ? 1 : 0,
            }}
          >
            ▋
          </span>
        </div>
        <div
          style={{
            borderTop: "1px solid #30363d",
            fontSize: 9,
            color: "#6c7086",
            paddingTop: 4,
            textAlign: "center",
          }}
        >
          <span style={{ color: "#a78bfa" }}>autopilot</span> · shift+tab
          switch mode
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════
// Main PhoneScene
// Sessions → tap → terminal → keyboard → type copilot →
// rotate to landscape → Copilot CLI with blinking cursor
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
    // Phase 1: Zoomed to sessions (upper phone)
    camScale = interpolate(snapInP, [0, 1], [1, 2.5]);
    camTY = interpolate(snapInP, [0, 1], [0, 550]);
    camTX = interpolate(snapInP, [0, 1], [0, 80]);
    camRotX = 0;
    camRotY = 0;
  } else if (frame < KB_START) {
    // Phase 2: Terminal prompt area — zoom out to see more phone
    const t2 = interpolate(frame, [CROSSFADE_START, CROSSFADE_START + 12], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    const e2 = Easing.inOut(Easing.cubic)(t2);
    camScale = interpolate(e2, [0, 1], [2.5, 1.4]);
    camTY = interpolate(e2, [0, 1], [550, 100]);
    camTX = interpolate(e2, [0, 1], [80, -20]);
    camRotX = 0;
    camRotY = 0;
  } else if (frame < ENTER_FRAME) {
    // Phase 3: Keyboard + prompt — zoom to bottom of phone
    const t3 = interpolate(frame, [KB_START, KB_START + 12], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    const e3 = Easing.inOut(Easing.cubic)(t3);
    camScale = interpolate(e3, [0, 1], [1.4, 2.2]);
    camTY = interpolate(e3, [0, 1], [100, -300]);
    camTX = interpolate(e3, [0, 1], [-40, 0]);
    camRotX = interpolate(e3, [0, 1], [0, 12]);
    camRotY = interpolate(e3, [0, 1], [0, -8]);
  } else {
    // Phase 4+5: Zoom out for rotation / landscape
    const t4 = interpolate(frame, [ENTER_FRAME, ENTER_FRAME + 12], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    const e4 = Easing.out(Easing.cubic)(t4);
    camScale = interpolate(e4, [0, 1], [2.2, 1.3]);
    camTY = interpolate(e4, [0, 1], [-300, 0]);
    camTX = interpolate(e4, [0, 1], [0, 0]);
    camRotX = interpolate(e4, [0, 1], [12, 0]);
    camRotY = interpolate(e4, [0, 1], [-8, 0]);
  }
  // Subtle camera sway when zoomed
  const cameraSway = Math.sin(frame * 0.04) * 8 * (camScale > 1.3 ? 1 : 0);

  // ── 3. Rotate to landscape (170-195) — COUNTER-CLOCKWISE ──
  const rotP = interpolate(frame, [ROTATE_START, ROTATE_END], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rotE = Easing.inOut(Easing.cubic)(rotP);
  const rotZ = interpolate(rotE, [0, 1], [0, 90]);
  const phoneScale = interpolate(rotE, [0, 1], [1, 1.15]);

  // ── Composite phone transform ─────────────────────────
  const posX = entranceX;
  const posY = 0;

  // Gentle sway (dampened during rotation)
  const sway = Math.sin(frame * 0.02) * 0.3 * (1 - rotE);

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

  // Portrait → landscape during rotation
  const portraitOp =
    frame >= ROTATE_START
      ? interpolate(frame, [ROTATE_START, ROTATE_START + 15], [1, 0], {
          extrapolateRight: "clamp",
        })
      : 1;
  const landscapeOp =
    frame >= ROTATE_START
      ? interpolate(frame, [ROTATE_START + 10, ROTATE_END], [0, 1], {
          extrapolateRight: "clamp",
        })
      : 0;

  // Copilot UI stagger
  const copilotP =
    frame >= COPILOT_SHOW
      ? interpolate(frame, [COPILOT_SHOW, COPILOT_SHOW + 40], [0, 1], {
          extrapolateRight: "clamp",
        })
      : 0;

  // ── Terminal typing state ─────────────────────────────
  const typedChars =
    frame >= TYPE_START
      ? Math.min(
          Math.floor((frame - TYPE_START) / CHAR_SPEED),
          COPILOT_CMD.length,
        )
      : 0;
  const showCursor = frame >= CROSSFADE_END && frame < ENTER_FRAME;
  const showLoading = frame >= ENTER_FRAME + 3;

  // ── Keyboard ──────────────────────────────────────────
  const kbSlide = interpolate(frame, [KB_START, KB_END], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const showKB = frame >= KB_START && frame < ROTATE_END;

  const activeKey = (() => {
    if (frame >= TYPE_START && frame < TYPE_END) {
      const tf = frame - TYPE_START;
      const ci = Math.floor(tf / CHAR_SPEED);
      if (ci < COPILOT_CMD.length && tf % CHAR_SPEED < 3)
        return COPILOT_CMD[ci];
    }
    if (frame >= ENTER_FRAME && frame < ENTER_FRAME + 6) return "return";
    return null;
  })();

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
          transform: `perspective(1800px) rotateX(${camRotX}deg) rotateY(${camRotY}deg) translateY(${camTY + cameraSway}px) translateX(${camTX}px) scale(${camScale})`,
          transformOrigin: "center center",
        }}
      >
        <div style={{ position: "relative" }}>
          {/* Ring pulse */}
          {frame >= TAP_FRAME && frame < TAP_FRAME + 60 && (
            <div
              style={{
                position: "absolute",
                top: 180,
                left: "50%",
                width: 300,
                height: 300,
                borderRadius: "50%",
                border: "2px solid #a78bfa",
                transform: `translate(-50%, -50%) scale(${ringScale})`,
                opacity: ringOp,
                pointerEvents: "none",
              }}
            />
          )}

          <div
            style={{
              transform: [
                `translateX(${posX}px)`,
                `translateY(${posY}px)`,
                `rotateY(${entranceRotY + sway}deg)`,
                `rotateZ(${rotZ}deg)`,
                `scale(${phoneScale})`,
              ].join(" "),
              opacity: entranceOp,
              transformStyle: "preserve-3d",
            }}
          >
            <PhoneMockup>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "100%",
                }}
              >
                {/* Portrait content (sessions + terminal + keyboard) */}
                <div
                  style={{
                    opacity: portraitOp,
                    position: "absolute",
                    inset: 0,
                  }}
                >
                  {/* Sessions */}
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
                  {/* Terminal */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      transform: `translateX(${terminalSlide}%)`,
                      zIndex: frame >= CROSSFADE_END ? 2 : 0,
                    }}
                  >
                    <TerminalScreen
                      frame={frame}
                      typedChars={typedChars}
                      showCursor={showCursor}
                      showLoading={showLoading}
                      kbSlide={kbSlide}
                    />
                  </div>
                  {/* iOS Keyboard */}
                  {showKB && (
                    <IOSKeyboard
                      activeKey={activeKey}
                      slideProgress={kbSlide}
                    />
                  )}
                </div>

                {/* Landscape content (Copilot CLI) */}
                {frame >= ROTATE_START && (
                  <div
                    style={{
                      opacity: landscapeOp,
                      position: "absolute",
                      inset: 0,
                    }}
                  >
                    <CopilotScreen frame={frame} progress={copilotP} />
                  </div>
                )}
              </div>
            </PhoneMockup>

            {/* Finger tap indicator */}
            {fingerVis && (
              <div
                style={{
                  position: "absolute",
                  top: 180,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "rgba(167, 139, 250, 0.2)",
                  border: "2px solid rgba(167, 139, 250, 0.5)",
                  opacity: fingerOp,
                  boxShadow: "0 0 20px rgba(167, 139, 250, 0.3)",
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

      {/* Typing sound effects */}
      {Array.from({ length: COPILOT_CMD.length }).map((_, i) => (
        <Sequence key={`kc-${i}`} from={TYPE_START + i * CHAR_SPEED} durationInFrames={4}>
          <Audio src={staticFile("keyclick.wav")} volume={0.15} />
        </Sequence>
      ))}
      <Sequence from={ENTER_FRAME} durationInFrames={4}>
        <Audio src={staticFile("keyclick.wav")} volume={0.2} />
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
