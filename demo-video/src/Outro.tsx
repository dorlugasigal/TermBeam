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

const { fontFamily } = loadFont("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["latin"],
});

const { fontFamily: monoFont } = loadMono("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

const BG =
  "radial-gradient(ellipse at 50% 45%, #1a1a3e 0%, #0f0c29 50%, #0a0a1a 100%)";

const COMMAND = "npx termbeam";

// SVG GitHub mark (simplified Invertocat)
const GitHubIcon: React.FC<{ size?: number; color?: string }> = ({
  size = 24,
  color = "#8b949e",
}) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={color}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── Ambient particles (mirrors Intro for visual bookend) ──
  const particles = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    const radius = 380 + Math.sin(i * 2.7) * 120;
    const speed = 0.012 + (i % 3) * 0.004;
    const x = Math.cos(angle + frame * speed) * radius;
    const y = Math.sin(angle + frame * speed) * radius;
    const size = 2 + (i % 3) * 1.5;
    const opacity = 0.08 + Math.sin(frame * 0.04 + i) * 0.06;
    return { x, y, size, opacity };
  });

  // ── Logo entrance (snappy, matches Intro energy) ──────────
  const logoS = spring({
    frame: frame - 6,
    fps,
    config: { damping: 12, stiffness: 180 },
  });

  // ── Horizontal light sweep across logo ────────────────────
  const sweepX = interpolate(frame - 18, [0, 20], [-100, 200], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ── Glow pulse (faster, more visible) ─────────────────────
  const glow = interpolate(
    Math.sin(frame * 0.12),
    [-1, 1],
    [0.4, 1],
  );

  // ── Tagline ───────────────────────────────────────────────
  const tagS = spring({
    frame: frame - 22,
    fps,
    config: { damping: 18, stiffness: 200 },
  });

  // ── Command bar with typewriter ───────────────────────────
  const cmdS = spring({
    frame: frame - 34,
    fps,
    config: { damping: 14, stiffness: 160 },
  });
  const typeStart = 40;
  const charsVisible = Math.min(
    Math.floor((frame - typeStart) * 1.2),
    COMMAND.length,
  );
  const typedText = frame >= typeStart ? COMMAND.slice(0, charsVisible) : "";
  const cursorVisible = frame >= typeStart && (frame % 16 < 10 || charsVisible < COMMAND.length);

  // ── GitHub CTA ────────────────────────────────────────────
  const ctaS = spring({
    frame: frame - 60,
    fps,
    config: { damping: 14, stiffness: 140 },
  });

  // ── Star button ───────────────────────────────────────────
  const starS = spring({
    frame: frame - 72,
    fps,
    config: { damping: 10, stiffness: 120 },
  });

  return (
    <AbsoluteFill
      style={{
        background: BG,
        fontFamily,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Ambient particles */}
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `calc(50% + ${p.x}px)`,
            top: `calc(50% + ${p.y}px)`,
            width: p.size,
            height: p.size,
            borderRadius: "50%",
            background: "#a78bfa",
            opacity: p.opacity,
          }}
        />
      ))}

      {/* Background accent glow */}
      <div
        style={{
          position: "absolute",
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(167, 139, 250, 0.08) 0%, transparent 70%)",
          pointerEvents: "none",
          left: "50%",
          top: "42%",
          transform: "translate(-50%, -50%)",
          opacity: interpolate(logoS, [0, 1], [0, 1]),
        }}
      />

      {/* TermBeam logo with light sweep */}
      <div
        style={{
          transform: `scale(${interpolate(logoS, [0, 1], [0.7, 1])})`,
          opacity: interpolate(logoS, [0, 1], [0, 1]),
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: 130,
            fontWeight: 800,
            letterSpacing: -5,
            color: "#e0e0e0",
            textShadow: `0 0 60px rgba(167, 139, 250, ${glow * 0.4}), 0 0 120px rgba(124, 58, 237, ${glow * 0.2})`,
            position: "relative",
          }}
        >
          Term<span style={{ color: "#a78bfa" }}>Beam</span>
          {/* Light sweep overlay */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: `${sweepX}%`,
              width: 60,
              height: "100%",
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>

      {/* Tagline — mirrors intro */}
      <div
        style={{
          marginTop: 12,
          fontSize: 28,
          fontWeight: 600,
          color: "rgba(255, 255, 255, 0.4)",
          letterSpacing: 1,
          opacity: interpolate(tagS, [0, 1], [0, 1]),
          transform: `translateY(${interpolate(tagS, [0, 1], [12, 0])}px)`,
        }}
      >
        Beam your terminal to any device
      </div>

      {/* npx termbeam — typewriter */}
      <div
        style={{
          transform: `translateY(${interpolate(cmdS, [0, 1], [20, 0])}px)`,
          opacity: interpolate(cmdS, [0, 1], [0, 1]),
          marginTop: 32,
        }}
      >
        <div
          style={{
            background: "#0d1117",
            border: "1px solid rgba(167, 139, 250, 0.2)",
            borderRadius: 12,
            padding: "18px 52px",
            fontFamily: monoFont,
            fontSize: 36,
            fontWeight: 700,
            color: "#a78bfa",
            display: "flex",
            alignItems: "center",
            gap: 10,
            boxShadow: `0 0 40px rgba(167, 139, 250, ${glow * 0.1})`,
            minWidth: 420,
          }}
        >
          <span style={{ color: "#6c7086", fontSize: 28 }}>$</span>
          {typedText}
          <span
            style={{
              color: "#a78bfa",
              fontWeight: 400,
              visibility: cursorVisible ? "visible" : "hidden",
            }}
          >
            ▎
          </span>
        </div>
      </div>

      {/* GitHub CTA */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          marginTop: 48,
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 600,
            color: "#8b949e",
            display: "flex",
            alignItems: "center",
            gap: 12,
            opacity: interpolate(ctaS, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(ctaS, [0, 1], [16, 0])}px)`,
          }}
        >
          <GitHubIcon size={28} />
          github.com/dorlugasigal/TermBeam
        </div>
        <div
          style={{
            background: "linear-gradient(135deg, #a78bfa, #7c3aed)",
            borderRadius: 28,
            padding: "14px 44px",
            fontSize: 28,
            fontWeight: 700,
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: `0 0 30px rgba(167, 139, 250, ${glow * 0.3})`,
            opacity: interpolate(starS, [0, 1], [0, 1]),
            transform: `scale(${interpolate(starS, [0, 1], [0.7, 1])})`,
          }}
        >
          ⭐ Star on GitHub
        </div>
      </div>
    </AbsoluteFill>
  );
};
