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

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── Logo fade-in ──────────────────────────────────────
  const logoS = spring({
    frame: frame - 10,
    fps,
    config: { damping: 18, stiffness: 80 },
    durationInFrames: 20,
  });

  // ── Command bar ───────────────────────────────────────
  const cmdS = spring({
    frame: frame - 30,
    fps,
    config: { damping: 16, stiffness: 140 },
    durationInFrames: 14,
  });

  // ── CTA ───────────────────────────────────────────────
  const ctaS = spring({
    frame: frame - 50,
    fps,
    config: { damping: 12, stiffness: 100 },
    durationInFrames: 16,
  });

  // ── Pulsing glow ──────────────────────────────────────
  const glow = interpolate(
    Math.sin(frame * 0.06),
    [-1, 1],
    [0.3, 0.8],
  );

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse at 50% 45%, #1e1a3e 0%, #0f0c29 50%, #0a0a1a 100%)",
        fontFamily,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Background accent glow */}
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(124, 58, 237, 0.1) 0%, transparent 70%)",
          pointerEvents: "none",
          left: "50%",
          top: "45%",
          transform: "translate(-50%, -50%)",
          opacity: interpolate(logoS, [0, 1], [0, 1]),
        }}
      />

      {/* TermBeam logo */}
      <div
        style={{
          transform: `scale(${interpolate(logoS, [0, 1], [0.8, 1])})`,
          opacity: interpolate(logoS, [0, 1], [0, 1]),
        }}
      >
        <div
          style={{
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -4,
            color: "#e0e0e0",
            textShadow: `0 0 60px rgba(167, 139, 250, ${glow * 0.5}), 0 0 120px rgba(167, 139, 250, ${glow * 0.25})`,
          }}
        >
          Term<span style={{ color: "#a78bfa" }}>Beam</span>
        </div>
      </div>

      {/* npx termbeam command */}
      <div
        style={{
          transform: `translateY(${interpolate(cmdS, [0, 1], [20, 0])}px)`,
          opacity: interpolate(cmdS, [0, 1], [0, 1]),
          marginTop: 24,
        }}
      >
        <div
          style={{
            background: "#0d1117",
            border: "1px solid rgba(167, 139, 250, 0.2)",
            borderRadius: 12,
            padding: "14px 44px",
            fontFamily: monoFont,
            fontSize: 28,
            fontWeight: 700,
            color: "#a78bfa",
            display: "flex",
            alignItems: "center",
            gap: 10,
            boxShadow: `0 0 40px rgba(167, 139, 250, ${glow * 0.12})`,
          }}
        >
          <span style={{ color: "#6c7086", fontSize: 22 }}>$</span>
          npx termbeam
        </div>
      </div>

      {/* GitHub CTA */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          marginTop: 48,
          transform: `scale(${interpolate(ctaS, [0, 1], [0.7, 1])})`,
          opacity: interpolate(ctaS, [0, 1], [0, 1]),
        }}
      >
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: "#8b949e",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 24 }}>🐙</span>
          github.com/dorlugasigal/TermBeam
        </div>
        <div
          style={{
            background: "linear-gradient(135deg, #f9e2af, #fab387)",
            borderRadius: 28,
            padding: "12px 36px",
            fontSize: 22,
            fontWeight: 700,
            color: "#1a1a2e",
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: `0 0 30px rgba(249, 226, 175, ${glow * 0.25})`,
          }}
        >
          ⭐ Star on GitHub
        </div>
      </div>
    </AbsoluteFill>
  );
};
