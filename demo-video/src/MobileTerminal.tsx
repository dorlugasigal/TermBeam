import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
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
  "radial-gradient(ellipse at 40% 50%, #1a1a3e 0%, #0f0c29 50%, #0a0a1a 100%)";

const PROMPT = "❯ ";

// ── Key bar definitions with press timings ──────────────
const KEY_BUTTONS: {
  label: string;
  wide?: boolean;
  pressAt?: number; // frame when this button gets "pressed"
}[] = [
  { label: "↑", pressAt: 65 },
  { label: "↓", pressAt: 75 },
  { label: "←" },
  { label: "→", pressAt: 105 },
  { label: "Tab", wide: true, pressAt: 10 },
  { label: "Enter", wide: true }, // pressed dynamically with commands
  { label: "Esc" },
  { label: "^C", pressAt: 170 },
  { label: "^D" },
  { label: "^Z" },
  { label: "^L" },
];

// ── Copilot CLI script ──────────────────────────────────
const CMD1 = "gh copilot suggest";
const CMD1_OUTPUT = [
  { text: '? What would you like the command to do?', color: "#a78bfa" },
  { text: "  Suggestion:", color: "#6c7086" },
  { text: "", color: "transparent" },
  { text: '  docker ps --format "table {{.Names}}\\t{{.Status}}"', color: "#a6e3a1" },
  { text: "", color: "transparent" },
  { text: "? Select an option", color: "#a78bfa" },
  { text: "  > Copy command to clipboard", color: "#f9e2af" },
];
const CMD2 = "ls -la src/";
const CMD2_OUTPUT = [
  { text: "total 64", color: "#6c7086" },
  { text: "drwxr-xr-x  10 user staff   320 Feb 27 10:00 .", color: "#e0e0e0" },
  { text: "-rw-r--r--   1 user staff  2140 Feb 27 09:58 server.js", color: "#a78bfa" },
  { text: "-rw-r--r--   1 user staff  1820 Feb 27 09:58 websocket.js", color: "#a78bfa" },
  { text: "-rw-r--r--   1 user staff   940 Feb 27 09:57 auth.js", color: "#a78bfa" },
  { text: "drwxr-xr-x   4 user staff   128 Feb 27 09:59 test", color: "#89b4fa" },
];

const TYPE_SPEED = 2;
const CMD1_FRAMES = CMD1.length * TYPE_SPEED;
const ENTER1_AT = CMD1_FRAMES;
const OUTPUT1_START = ENTER1_AT + 15;
const CMD2_START = OUTPUT1_START + CMD1_OUTPUT.length * 5 + 30;
const CMD2_FRAMES = CMD2.length * TYPE_SPEED;
const ENTER2_AT = CMD2_START + CMD2_FRAMES;
const OUTPUT2_START = ENTER2_AT + 10;

// ── Mobile Terminal Screen ──────────────────────────────
const MobileTermScreen: React.FC<{ frame: number; fps: number }> = ({
  frame,
}) => {
  const cmd1Chars = Math.min(Math.floor(frame / TYPE_SPEED), CMD1.length);
  const cmd1Done = frame >= ENTER1_AT;
  const output1Frame = frame - OUTPUT1_START;

  const cmd2Frame = frame - CMD2_START;
  const cmd2Chars = Math.min(
    Math.max(0, Math.floor(cmd2Frame / TYPE_SPEED)),
    CMD2.length,
  );
  const cmd2Done = cmd2Frame >= CMD2_FRAMES;
  const output2Frame = frame - OUTPUT2_START;

  const cursorBlink = Math.floor(frame / 15) % 2 === 0;

  // Button press states — which button is highlighted right now
  const isButtonPressed = (btn: typeof KEY_BUTTONS[0]) => {
    // Enter pressed when commands finish
    if (btn.label === "Enter") {
      const e1 = frame >= ENTER1_AT && frame < ENTER1_AT + 10;
      const e2 = frame >= ENTER2_AT && frame < ENTER2_AT + 10;
      return e1 || e2;
    }
    if (btn.pressAt === undefined) return false;
    return frame >= btn.pressAt && frame < btn.pressAt + 8;
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0d1117",
        display: "flex",
        flexDirection: "column",
        fontFamily,
      }}
    >
      {/* App nav bar */}
      <div
        style={{
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 14px",
          background: "#161b22",
          borderBottom: "1px solid #30363d",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#8b949e", fontSize: 16 }}>‹</span>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#3fb950",
              boxShadow: "0 0 6px rgba(63,185,80,0.5)",
            }}
          />
          <span
            style={{ color: "#e6edf3", fontWeight: 700, fontSize: 13, fontFamily: monoFont }}
          >
            pty-mirror
          </span>
        </div>
        <span style={{ color: "#8b949e", fontSize: 11, fontWeight: 500 }}>
          Connected
        </span>
      </div>

      {/* Terminal content */}
      <div
        style={{
          flex: 1,
          padding: "10px 14px",
          fontFamily: monoFont,
          fontSize: 11.5,
          lineHeight: 1.6,
          overflow: "hidden",
        }}
      >
        {/* Command 1: gh copilot suggest */}
        <div style={{ display: "flex" }}>
          <span style={{ color: "#3fb950" }}>{PROMPT}</span>
          <span style={{ color: "#e6edf3" }}>{CMD1.slice(0, cmd1Chars)}</span>
          {!cmd1Done && (
            <span style={{ color: "#a78bfa", opacity: cursorBlink ? 1 : 0 }}>▋</span>
          )}
        </div>

        {/* Output 1 — Copilot CLI response */}
        {cmd1Done &&
          CMD1_OUTPUT.map((line, i) => {
            const lineOpacity = interpolate(output1Frame - i * 5, [0, 4], [0, 1], {
              extrapolateRight: "clamp",
              extrapolateLeft: "clamp",
            });
            return (
              <div
                key={`o1-${i}`}
                style={{
                  color: line.color,
                  whiteSpace: "pre",
                  opacity: lineOpacity,
                  fontSize: line.color === "#a6e3a1" ? 12 : 11,
                  fontWeight: line.color === "#a6e3a1" ? 700 : 400,
                }}
              >
                {line.text}
              </div>
            );
          })}

        {/* Command 2: ls -la src/ */}
        {frame >= CMD2_START && (
          <>
            <div style={{ height: 8 }} />
            <div style={{ display: "flex" }}>
              <span style={{ color: "#3fb950" }}>{PROMPT}</span>
              <span style={{ color: "#e6edf3" }}>{CMD2.slice(0, cmd2Chars)}</span>
              {!cmd2Done && frame >= CMD2_START && (
                <span style={{ color: "#a78bfa", opacity: cursorBlink ? 1 : 0 }}>▋</span>
              )}
            </div>
          </>
        )}

        {/* Output 2 */}
        {cmd2Done &&
          CMD2_OUTPUT.map((line, i) => {
            const lineOpacity = interpolate(output2Frame - i * 4, [0, 3], [0, 1], {
              extrapolateRight: "clamp",
              extrapolateLeft: "clamp",
            });
            return (
              <div
                key={`o2-${i}`}
                style={{
                  color: line.color,
                  whiteSpace: "pre",
                  opacity: lineOpacity,
                  fontSize: 10,
                }}
              >
                {line.text}
              </div>
            );
          })}

        {/* Final cursor */}
        {output2Frame > CMD2_OUTPUT.length * 4 + 5 && (
          <div style={{ display: "flex", marginTop: 4 }}>
            <span style={{ color: "#3fb950" }}>{PROMPT}</span>
            <span style={{ color: "#a78bfa", opacity: cursorBlink ? 1 : 0 }}>▋</span>
          </div>
        )}
      </div>

      {/* ── Key bar with press animations ─────────────── */}
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          background: "#161b22",
          borderTop: "1px solid #30363d",
          padding: "0 6px",
          gap: 3,
        }}
      >
        {KEY_BUTTONS.map((btn, i) => {
          const pressed = isButtonPressed(btn);
          return (
            <div
              key={i}
              style={{
                minWidth: btn.wide ? 48 : 32,
                height: 28,
                background: pressed
                  ? "linear-gradient(180deg, #7c3aed, #6d28d9)"
                  : "linear-gradient(180deg, #21262d, #161b22)",
                color: pressed ? "#fff" : "#8b949e",
                border: `1px solid ${pressed ? "#a78bfa" : "#30363d"}`,
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                fontFamily: monoFont,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transform: pressed ? "scale(0.9) translateY(1px)" : "scale(1)",
                boxShadow: pressed
                  ? "0 0 12px rgba(124, 58, 237, 0.5), inset 0 1px 0 rgba(255,255,255,0.15)"
                  : "0 1px 2px rgba(0,0,0,0.3)",
                transition: "none",
              }}
            >
              {btn.label}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// Main scene — dramatic zoom/tilt into the phone
// ═══════════════════════════════════════════════════════════
export const MobileTerminal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── Phase 1 (0-40): Phone enters with spring ──────────
  const entranceSpring = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 140 },
  });
  const entranceY = interpolate(entranceSpring, [0, 1], [120, 0]);
  const entranceScale = interpolate(entranceSpring, [0, 1], [0.6, 0.85]);
  const entranceOpacity = interpolate(entranceSpring, [0, 1], [0, 1]);
  const entranceRotateX = interpolate(entranceSpring, [0, 1], [15, 2]);

  // ── Phase 2 (50-110): Dramatic zoom in + tilt ─────────
  const ZOOM_IN_START = 50;
  const ZOOM_IN_END = 110;
  const zoomIn = interpolate(
    frame,
    [ZOOM_IN_START, ZOOM_IN_END],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  // Ease out cubic
  const zoomEased = 1 - Math.pow(1 - zoomIn, 3);

  const zoomScale = interpolate(zoomEased, [0, 1], [0.85, 2.4]);
  const zoomRotateY = interpolate(zoomEased, [0, 1], [0, -8]);
  const zoomRotateX = interpolate(zoomEased, [0, 1], [2, -3]);
  const zoomTranslateY = interpolate(zoomEased, [0, 1], [0, -180]);
  const zoomTranslateX = interpolate(zoomEased, [0, 1], [0, 60]);

  // ── Phase 3 (160-200): Pan down to key bar ────────────
  const PAN_START = 160;
  const PAN_END = 200;
  const panProgress = interpolate(
    frame,
    [PAN_START, PAN_END],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const panEased = 1 - Math.pow(1 - panProgress, 3);
  const panTranslateY = interpolate(panEased, [0, 1], [0, -280]);
  const panRotateY = interpolate(panEased, [0, 1], [0, 6]);

  // ── Phase 4 (210-240): Zoom back out ──────────────────
  const ZOOM_OUT_START = 210;
  const ZOOM_OUT_END = durationInFrames;
  const zoomOutProgress = interpolate(
    frame,
    [ZOOM_OUT_START, ZOOM_OUT_END],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const zoomOutEased = 1 - Math.pow(1 - zoomOutProgress, 2);
  const zoomOutScale = interpolate(zoomOutEased, [0, 1], [1, 0.42]);
  const zoomOutTransY = interpolate(zoomOutEased, [0, 1], [0, 230]);
  const zoomOutRotateY = interpolate(zoomOutEased, [0, 1], [0, -4]);

  // Combine transforms based on current phase
  let finalScale: number;
  let finalRotateX: number;
  let finalRotateY: number;
  let finalTranslateY: number;
  let finalTranslateX: number;

  if (frame < ZOOM_IN_START) {
    // Entrance
    finalScale = entranceScale;
    finalRotateX = entranceRotateX;
    finalRotateY = 0;
    finalTranslateX = 0;
    finalTranslateY = entranceY;
  } else if (frame < PAN_START) {
    // Zoomed in
    finalScale = zoomScale;
    finalRotateX = zoomRotateX;
    finalRotateY = zoomRotateY;
    finalTranslateX = zoomTranslateX;
    finalTranslateY = zoomTranslateY;
  } else if (frame < ZOOM_OUT_START) {
    // Panning to key bar
    finalScale = 2.4;
    finalRotateX = -3;
    finalRotateY = -8 + panRotateY;
    finalTranslateX = 60;
    finalTranslateY = -180 + panTranslateY;
  } else {
    // Zoom back out
    finalScale = 2.4 * zoomOutScale;
    finalRotateX = interpolate(zoomOutEased, [0, 1], [-3, 0]);
    finalRotateY = (-8 + 6) + zoomOutRotateY;
    finalTranslateX = interpolate(zoomOutEased, [0, 1], [60, 0]);
    finalTranslateY = -180 + panTranslateY + zoomOutTransY;
  }

  // Subtle ambient sway
  const sway = Math.sin(frame * 0.02) * 0.5;

  // ── Title label ────────────────────────────────────────
  const titleSpring = spring({
    frame,
    fps,
    delay: 5,
    config: { damping: 20, stiffness: 200 },
  });
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);
  const titleY = interpolate(titleSpring, [0, 1], [30, 0]);
  // Fade title out when zooming in
  const titleFade = interpolate(
    frame,
    [ZOOM_IN_START, ZOOM_IN_START + 20],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

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
      {/* Title — fades out as we zoom */}
      <div
        style={{
          position: "absolute",
          top: 60,
          fontSize: 38,
          fontWeight: 800,
          color: "#ffffff",
          opacity: titleOpacity * titleFade,
          transform: `translateY(${titleY}px)`,
          textAlign: "center",
          textShadow: "0 2px 20px rgba(167, 139, 250, 0.3)",
          letterSpacing: -0.5,
          zIndex: 10,
        }}
      >
        Full terminal, right on your phone
      </div>

      {/* Phone container with all transform phases */}
      <div
        style={{
          transform: [
            `translateY(${finalTranslateY}px)`,
            `translateX(${finalTranslateX}px)`,
            `rotateX(${finalRotateX}deg)`,
            `rotateY(${finalRotateY + sway}deg)`,
            `scale(${finalScale})`,
          ].join(" "),
          opacity: entranceOpacity,
          transformStyle: "preserve-3d",
        }}
      >
        <PhoneMockup scale={0.7}>
          <MobileTermScreen frame={frame} fps={fps} />
        </PhoneMockup>
      </div>

      {/* Ambient glow follows phone */}
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
