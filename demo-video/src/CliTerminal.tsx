import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: monoFont } = loadFont("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

const { fontFamily: sansFont } = loadInter("normal", {
  weights: ["400", "600", "700"],
  subsets: ["latin"],
});

const GRADIENT_BG =
  "radial-gradient(ellipse at 50% 60%, #1a1a3e 0%, #0f0c29 50%, #0a0a1a 100%)";
const TERMINAL_BG = "#0d1117";
const TERMINAL_BORDER = "#30363d";

// ── Oh-My-Posh prompt colors ────────────────────────────
const OMP_PATH_BG = "#1e3a5f";
const OMP_GIT_BG = "#56cc6c";
const OMP_TIME_BG = "#3e4451";
const OMP_PROMPT_COLOR = "#22da6e";

// ── Terminal content ────────────────────────────────────
const COMMAND = "npx termbeam";
const TYPE_SPEED = 1.5;
const COMMAND_FRAMES = Math.ceil(COMMAND.length * TYPE_SPEED);
const PAUSE_AFTER_ENTER = 10;
const OUTPUT_START = COMMAND_FRAMES + PAUSE_AFTER_ENTER;

const ASCII_LINES = [
  "████████╗███████╗██████╗ ███╗   ███╗██████╗ ███████╗ █████╗ ███╗   ███╗",
  "╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██╔══██╗██╔════╝██╔══██╗████╗ ████║",
  "   ██║   █████╗  ██████╔╝██╔████╔██║██████╔╝█████╗  ███████║██╔████╔██║",
  "   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║",
  "   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██████╔╝███████╗██║  ██║██║ ╚═╝ ██║",
  "   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝",
];

const SERVER_INFO = [
  { text: "", color: "" },
  { text: "  Beam your terminal to any device 📡  v0.2.0", color: "#6c7086" },
  { text: "", color: "" },
  { text: "  Shell:    /bin/zsh", color: "#e0e0e0" },
  { text: "  Session:  termbeam", color: "#e0e0e0" },
  { text: "  Auth:     🔒 password", color: "#a6e3a1" },
  { text: "", color: "" },
  { text: "  🌐 Public:  https://8qh6jqpj-3456.euw.devtunnels.ms", color: "#e0e0e0" },
  { text: "  Local:    http://localhost:3456", color: "#e0e0e0" },
  { text: "  LAN:      http://192.168.1.42:3456", color: "#e0e0e0" },
  { text: "", color: "" },
];

const QR_LINES = [
  "  ▄▄▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄▄▄▄",
  "  █ ▄▄▄ █ █▀▄▀█ █ ▄▄▄ █",
  "  █ ███ █ ▄▀▄▀▄ █ ███ █",
  "  █▄▄▄▄▄█ ▄▀█▀▄ █▄▄▄▄▄█",
  "  ▄▄▄▄▄▄▄█▄█▄█▄█▄▄▄▄▄▄▄",
  "  ▄▀▄▀▀▄▄ ▀▄█▀▄▄▀▀▄█▀▄▄",
  "  █▀▀▄▀▀▄▀▄▀▀██▀▄▀▄█▀▀▄",
  "  ▄▄▄▄▄▄▄ ▀▀▄▄█ █▄█ ▀▀▄",
  "  █ ▄▄▄ █  ▄█▀▀▄▄▀▀█▀▀▄",
  "  █ ███ █ █▀▀▄▀▄▄█▄▀▄█▄",
  "  █▄▄▄▄▄█ █▄▀▄▀█▄▀██▀▄▀",
];

const FOOTER_LINES = [
  { text: "  Scan the QR code or open: https://8qh6jqpj-3456.euw.devtunnels.ms", color: "#6c7086" },
  { text: "  Password: x7kM_pN2rB4vQs", color: "#f9e2af" },
];

// ── Terminal dot component ──────────────────────────────
const TermDot: React.FC<{ color: string }> = ({ color }) => (
  <div style={{ width: 12, height: 12, borderRadius: "50%", background: color }} />
);

export const CliTerminal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── 3D perspective rotation (evee pattern) ─────────────
  const rotateY = interpolate(frame, [0, durationInFrames], [8, -8]);
  const rotateXEntrance = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 80 },
  });
  const rotateX = interpolate(rotateXEntrance, [0, 1], [12, 0]);

  // ── Window entrance ────────────────────────────────────
  const windowSpring = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 200 },
  });
  const windowY = interpolate(windowSpring, [0, 1], [120, 40]);
  const windowOpacity = interpolate(windowSpring, [0, 1], [0, 1]);

  // ── Terminal exit (last ~30 frames) ────────────────────
  const exitStart = durationInFrames - 30;
  const exitP = frame > exitStart
    ? spring({
        frame: frame - exitStart,
        fps,
        config: { damping: 14, stiffness: 120 },
      })
    : 0;
  const exitScale = interpolate(exitP, [0, 1], [1, 1.15]);
  const exitOpacity = interpolate(exitP, [0, 1], [1, 0]);
  const exitBlur = interpolate(exitP, [0, 1], [0, 8]);

  // ── Multi-phase camera ─────────────────────────────────
  // Phase 1: Start zoomed in on prompt (typing)
  // Phase 2: Zoom out to reveal output
  // Phase 3: Diagonal angle when output is done
  const zoomOutStart = OUTPUT_START;
  const outputDoneFrame = OUTPUT_START + 50; // all output rendered by ~50 frames after OUTPUT_START
  const angleStart = outputDoneFrame + 15;

  let zoomScale = 1;
  let zoomTranslateY = 0;
  let zoomTranslateX = 0;
  let zoomTiltY = 0;
  let zoomTiltX = 0;

  if (frame < zoomOutStart) {
    // Phase 1: Zoomed in on the prompt area
    const enterP = spring({
      frame,
      fps,
      config: { damping: 15, stiffness: 120 },
    });
    zoomScale = interpolate(enterP, [0, 1], [1, 1.8]);
    zoomTranslateY = interpolate(enterP, [0, 1], [0, -60]);
    zoomTranslateX = 0;
    zoomTiltY = 0;
    zoomTiltX = 0;
  } else if (frame < angleStart) {
    // Phase 2: Zoom out to show output writing
    const zoomOutP = spring({
      frame: frame - zoomOutStart,
      fps,
      config: { damping: 18, stiffness: 80 },
    });
    zoomScale = interpolate(zoomOutP, [0, 1], [1.8, 1.35]);
    zoomTranslateY = interpolate(zoomOutP, [0, 1], [-60, 0]);
    zoomTranslateX = 0;
    zoomTiltY = 0;
    zoomTiltX = 0;
  } else {
    // Phase 3: Diagonal angle tilt
    const angleP = spring({
      frame: frame - angleStart,
      fps,
      config: { damping: 12, stiffness: 60 },
    });
    zoomScale = interpolate(angleP, [0, 1], [1.35, 1.5]);
    zoomTranslateY = interpolate(angleP, [0, 1], [0, -80]);
    zoomTranslateX = interpolate(angleP, [0, 1], [0, 100]);
    zoomTiltY = interpolate(angleP, [0, 1], [0, 30]);
    zoomTiltX = interpolate(angleP, [0, 1], [0, 15]);
  }

  // ── CLI option pills (slide in during Phase 3) ────────
  const CLI_OPTIONS = [
    { label: "--no-tunnel", desc: "Disable public tunnel" },
    { label: "--no-password", desc: "Disable auth" },
    { label: "--password <pw>", desc: "Set custom password" },
    { label: "--port <port>", desc: "Custom port" },
  ];
  const pillStagger = 8; // frames between each pill

  // ── Typing ─────────────────────────────────────────────
  const typedChars = Math.min(Math.floor(frame / TYPE_SPEED), COMMAND.length);
  const showCursor = frame < OUTPUT_START;
  const cursorBlink = Math.floor(frame / 15) % 2 === 0;
  const outputFrame = frame - OUTPUT_START;

  // Server lines stagger
  const serverStart = 6;
  const qrStart = serverStart + SERVER_INFO.length * 2 + 3;
  const footerStart = qrStart + 10;

  // ── "Generated password" flash highlight ───────────────
  const pwFlash = outputFrame >= 0
    ? interpolate(outputFrame, [0, 8, 20], [0, 1, 0.6], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  return (
    <AbsoluteFill
      style={{
        background: GRADIENT_BG,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: sansFont,
        perspective: 1200,
      }}
    >
      {/* Camera wrapper for zoom + pan + tilt */}
      <div
        style={{
          transform: `scale(${zoomScale * exitScale}) translate(${zoomTranslateX}px, ${zoomTranslateY}px) rotateY(${zoomTiltY}deg) rotateX(${zoomTiltX}deg)`,
          transformOrigin: "center center",
          transformStyle: "preserve-3d",
          opacity: exitOpacity,
          filter: `blur(${exitBlur}px)`,
        }}
      >
      {/* Inner container: shared 3D rotation for terminal + pills */}
      <div
        style={{
          transform: `translateY(${windowY}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
          transformOrigin: "center center",
          opacity: windowOpacity,
          transformStyle: "preserve-3d",
          position: "relative",
        }}
      >
      {/* Terminal window */}
      <div
        style={{
          width: 900,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow:
            "0 40px 120px rgba(0, 0, 0, 0.6), 0 0 60px rgba(83, 52, 131, 0.15)",
          border: `1px solid ${TERMINAL_BORDER}`,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            height: 42,
            background: "#161b22",
            borderBottom: `1px solid ${TERMINAL_BORDER}`,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            gap: 8,
          }}
        >
          <TermDot color="#ff5f57" />
          <TermDot color="#febc2e" />
          <TermDot color="#28c840" />
          <span
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 13,
              color: "#8b949e",
              fontFamily: sansFont,
            }}
          >
            dorlugasigal — zsh — 120×36
          </span>
        </div>

        {/* Terminal body */}
        <div
          style={{
            background: TERMINAL_BG,
            padding: "18px 22px",
            minHeight: 440,
            fontFamily: monoFont,
            fontSize: 14.5,
            lineHeight: 1.6,
          }}
        >
          {/* Oh-My-Posh two-line prompt */}
          {/* Line 1: ╭─ [path]▶[git]▶[time]▶ (SVG powerline arrows) */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ color: "#6c7086" }}>╭─</span>
            <div style={{ display: "flex", alignItems: "stretch", marginLeft: 4, height: 24 }}>
              {/* Path segment */}
              <div
                style={{
                  background: OMP_PATH_BG,
                  color: "#ffffff",
                  padding: "0 10px 0 8px",
                  fontWeight: 700,
                  fontSize: 13,
                  borderRadius: "4px 0 0 4px",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                📂 ~/Projects/termbeam
              </div>
              {/* Powerline arrow: path → git */}
              <svg width="12" height="24" viewBox="0 0 12 24" style={{ display: "block", flexShrink: 0 }}>
                <rect width="12" height="24" fill={OMP_GIT_BG} />
                <polygon points="0,0 12,12 0,24" fill={OMP_PATH_BG} />
              </svg>
              {/* Git segment */}
              <div
                style={{
                  background: OMP_GIT_BG,
                  color: "#1a1a1a",
                  padding: "0 10px 0 4px",
                  fontWeight: 700,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                ⎇ main
              </div>
              {/* Powerline arrow: git → time */}
              <svg width="12" height="24" viewBox="0 0 12 24" style={{ display: "block", flexShrink: 0 }}>
                <rect width="12" height="24" fill={OMP_TIME_BG} />
                <polygon points="0,0 12,12 0,24" fill={OMP_GIT_BG} />
              </svg>
              {/* Exec time segment */}
              <div
                style={{
                  background: OMP_TIME_BG,
                  color: "#e0e0e0",
                  padding: "0 10px 0 4px",
                  fontSize: 12,
                  borderRadius: "0 4px 4px 0",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                0ms
              </div>
              {/* Final powerline arrow */}
              <svg width="12" height="24" viewBox="0 0 12 24" style={{ display: "block", flexShrink: 0 }}>
                <polygon points="0,0 12,12 0,24" fill={OMP_TIME_BG} />
              </svg>
            </div>
          </div>
          {/* Line 2: ╰─❯ [command] */}
          <div style={{ display: "flex" }}>
            <span style={{ color: "#6c7086" }}>╰─</span>
            <span style={{ color: OMP_PROMPT_COLOR, fontWeight: 700, marginRight: 8 }}>❯</span>
            <span style={{ color: "#e6edf3" }}>
              {COMMAND.slice(0, typedChars)}
            </span>
            {showCursor && (
              <span style={{ color: "#a78bfa", opacity: cursorBlink ? 1 : 0 }}>▋</span>
            )}
          </div>

          {/* Generated password flash */}
          {outputFrame >= 0 && (
            <div
              style={{
                color: "#a6e3a1",
                opacity: interpolate(outputFrame, [0, 5], [0, 1], {
                  extrapolateRight: "clamp",
                  extrapolateLeft: "clamp",
                }),
                textShadow:
                  pwFlash > 0.5
                    ? `0 0 ${pwFlash * 20}px rgba(166, 227, 161, ${pwFlash * 0.5})`
                    : "none",
              }}
            >
              Generated password: x7kM_pN2rB4vQs
            </div>
          )}

          {/* ASCII art block */}
          {outputFrame >= 3 &&
            ASCII_LINES.map((line, i) => {
              const lineOpacity = interpolate(
                outputFrame,
                [3 + i * 1, 5 + i * 1],
                [0, 1],
                { extrapolateRight: "clamp", extrapolateLeft: "clamp" },
              );
              return (
                <div
                  key={`ascii-${i}`}
                  style={{
                    color: "#a78bfa",
                    whiteSpace: "pre",
                    fontSize: 8,
                    lineHeight: 1.1,
                    opacity: lineOpacity,
                  }}
                >
                  {line}
                </div>
              );
            })}

          {/* Server info lines */}
          {SERVER_INFO.map((line, i) => {
            const lineFrame = outputFrame - serverStart - i * 2;
            const lineOpacity = interpolate(lineFrame, [0, 3], [0, 1], {
              extrapolateRight: "clamp",
              extrapolateLeft: "clamp",
            });
            return (
              <div
                key={`srv-${i}`}
                style={{
                  color: line.color,
                  whiteSpace: "pre",
                  opacity: lineOpacity,
                }}
              >
                {line.text}
              </div>
            );
          })}

          {/* QR code block */}
          {QR_LINES.map((line, i) => {
            const lineFrame = outputFrame - qrStart;
            const lineOpacity = interpolate(lineFrame, [0, 8], [0, 1], {
              extrapolateRight: "clamp",
              extrapolateLeft: "clamp",
            });
            return (
              <div
                key={`qr-${i}`}
                style={{
                  color: "#ffffff",
                  whiteSpace: "pre",
                  fontSize: 10,
                  lineHeight: 1.1,
                  opacity: lineOpacity,
                }}
              >
                {line}
              </div>
            );
          })}

          {/* Footer lines */}
          {FOOTER_LINES.map((line, i) => {
            const lineFrame = outputFrame - footerStart - i * 3;
            const lineOpacity = interpolate(lineFrame, [0, 4], [0, 1], {
              extrapolateRight: "clamp",
              extrapolateLeft: "clamp",
            });
            return (
              <div
                key={`foot-${i}`}
                style={{
                  color: line.color,
                  whiteSpace: "pre",
                  opacity: lineOpacity,
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      </div>

      {/* CLI option pills — stacked vertically, slide in from right */}
      {frame >= zoomOutStart + 5 && frame < angleStart + 185 && (
        <div
          style={{
            position: "absolute",
            right: 30,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            zIndex: 10,
          }}
        >
          {CLI_OPTIONS.map((opt, i) => {
            // Enter spring
            const pillP = spring({
              frame: frame - zoomOutStart - 5 - i * pillStagger,
              fps,
              config: { damping: 14, stiffness: 100 },
            });
            const enterX = interpolate(pillP, [0, 1], [300, 0]);
            const enterOpacity = interpolate(pillP, [0, 0.3], [0, 1], {
              extrapolateRight: "clamp",
            });

            // Exit — start leaving at angleStart, reverse stagger (bottom pill first)
            const exitStart = angleStart + 105 + (CLI_OPTIONS.length - 1 - i) * 5;
            const exitP = frame >= exitStart
              ? spring({
                  frame: frame - exitStart,
                  fps,
                  config: { damping: 12, stiffness: 180 },
                })
              : 0;
            const exitX = interpolate(exitP, [0, 1], [0, 400]);
            const exitOpacity = interpolate(exitP, [0, 0.6], [1, 0], {
              extrapolateRight: "clamp",
            });

            return (
              <div
                key={`pill-${i}`}
                style={{
                  transform: `translateX(${enterX + exitX}px)`,
                  opacity: enterOpacity * exitOpacity,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  width: 320,
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: monoFont,
                    fontSize: 20,
                    fontWeight: 700,
                    color: "#a78bfa",
                    background: "rgba(167, 139, 250, 0.1)",
                    border: "1px solid rgba(167, 139, 250, 0.3)",
                    borderRadius: 10,
                    padding: "10px 20px",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  {opt.label}
                </span>
                <span
                  style={{
                    fontFamily: sansFont,
                    fontSize: 15,
                    color: "#8b949e",
                  }}
                >
                  {opt.desc}
                </span>
              </div>
            );
          })}
        </div>
      )}

      </div>{/* close inner 3D rotation container */}
      </div>{/* close camera wrapper */}

      {/* Spotlight glow behind terminal */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(83, 52, 131, 0.15) 0%, transparent 70%)",
          pointerEvents: "none",
          zIndex: -1,
        }}
      />

      {/* Typing sound effects */}
      {Array.from({ length: COMMAND.length }).map((_, i) => (
        <Sequence key={`kc-${i}`} from={i * TYPE_SPEED} durationInFrames={4}>
          <Audio src={staticFile("keyclick.wav")} volume={0.12} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
