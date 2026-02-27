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
  weights: ["400", "700", "800"],
  subsets: ["latin"],
});

const { fontFamily: monoFont } = loadMono("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

const GRADIENT_BG =
  "radial-gradient(ellipse at 30% 20%, #1a1a3e 0%, #0f0c29 40%, #0a0a1a 100%)";

const ASCII_LINES = [
  "████████╗███████╗██████╗ ███╗   ███╗██████╗ ███████╗ █████╗ ███╗   ███╗",
  "╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██╔══██╗██╔════╝██╔══██╗████╗ ████║",
  "   ██║   █████╗  ██████╔╝██╔████╔██║██████╔╝█████╗  ███████║██╔████╔██║",
  "   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║",
  "   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██████╔╝███████╗██║  ██║██║ ╚═╝ ██║",
  "   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝",
];

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── 3D floating rotation (evee pattern) ────────────────
  const floatRotateX = interpolate(frame, [0, durationInFrames], [2, -2]);
  const floatRotateY = interpolate(frame, [0, durationInFrames], [-3, 3]);

  // ── Zoom-in entrance ──────────────────────────────────
  const zoomSpring = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 160 },
  });
  const zoomScale = interpolate(zoomSpring, [0, 1], [1.3, 1]);
  const zoomOpacity = interpolate(zoomSpring, [0, 1], [0, 1]);

  // ── ASCII art: staggered snappy spring entrance ────────
  const lineAnimations = ASCII_LINES.map((_, i) => {
    const s = spring({
      frame,
      fps,
      delay: 5 + i * 2,
      config: { damping: 20, stiffness: 200 },
    });
    return {
      opacity: interpolate(s, [0, 1], [0, 1]),
      y: interpolate(s, [0, 1], [60, 0]),
      scale: interpolate(s, [0, 1], [0.8, 1]),
    };
  });

  // ── Glow pulse ─────────────────────────────────────────
  const glowIntensity = interpolate(
    frame % 60,
    [0, 30, 60],
    [0.3, 0.7, 0.3],
  );

  // ── Tagline: snappy entrance ───────────────────────────
  const tagSpring = spring({
    frame,
    fps,
    delay: 22,
    config: { damping: 20, stiffness: 200 },
  });
  const tagY = interpolate(tagSpring, [0, 1], [40, 0]);
  const tagOpacity = interpolate(tagSpring, [0, 1], [0, 1]);

  // ── Emoji bounce ───────────────────────────────────────
  const emojiSpring = spring({
    frame,
    fps,
    delay: 30,
    config: { damping: 8, stiffness: 120 },
  });
  const emojiScale = interpolate(emojiSpring, [0, 1], [0, 1.2]);
  const emojiSettleScale = frame > 45 ? interpolate(
    spring({ frame, fps, delay: 35, config: { damping: 20, stiffness: 200 } }),
    [0, 1], [1.2, 1],
  ) : emojiScale;

  // ── Subtitle ───────────────────────────────────────────
  const subSpring = spring({
    frame,
    fps,
    delay: 38,
    config: { damping: 200 },
  });
  const subOpacity = interpolate(subSpring, [0, 1], [0, 1]);
  const subY = interpolate(subSpring, [0, 1], [15, 0]);

  // ── Particle-like ambient dots ─────────────────────────
  const particles = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const radius = 350 + Math.sin(i * 2.7) * 100;
    const speed = 0.015 + (i % 3) * 0.005;
    const x = Math.cos(angle + frame * speed) * radius;
    const y = Math.sin(angle + frame * speed) * radius;
    const size = 2 + (i % 3) * 1.5;
    const opacity = 0.1 + Math.sin(frame * 0.05 + i) * 0.08;
    return { x, y, size, opacity };
  });

  return (
    <AbsoluteFill
      style={{
        background: GRADIENT_BG,
        justifyContent: "center",
        alignItems: "center",
        fontFamily,
        perspective: 3600,
        overflow: "hidden",
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

      {/* 3D floating container */}
      <div
        style={{
          transform: `rotateX(${floatRotateX}deg) rotateY(${floatRotateY}deg) scale(${zoomScale})`,
          opacity: zoomOpacity,
          transformStyle: "preserve-3d",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* ASCII Logo with glow */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            filter: `drop-shadow(0 0 ${glowIntensity * 40}px rgba(167, 139, 250, ${glowIntensity * 0.6}))`,
          }}
        >
          {ASCII_LINES.map((line, i) => (
            <div
              key={i}
              style={{
                fontFamily: monoFont,
                fontSize: 18,
                color: "#a78bfa",
                whiteSpace: "pre",
                lineHeight: 1.15,
                opacity: lineAnimations[i].opacity,
                transform: `translateY(${lineAnimations[i].y}px) scale(${lineAnimations[i].scale})`,
                letterSpacing: -0.5,
              }}
            >
              {line}
            </div>
          ))}
        </div>

        {/* Emoji */}
        <div
          style={{
            marginTop: 36,
            fontSize: 64,
            transform: `scale(${emojiSettleScale})`,
          }}
        >
          📡
        </div>

        {/* Tagline */}
        <div
          style={{
            marginTop: 20,
            opacity: tagOpacity,
            transform: `translateY(${tagY}px)`,
            fontSize: 48,
            fontWeight: 700,
            color: "#ffffff",
            textAlign: "center",
            letterSpacing: -0.5,
            textShadow: "0 2px 30px rgba(167, 139, 250, 0.3)",
          }}
        >
          Beam your terminal to any device
        </div>

        {/* Subtitle */}
        <div
          style={{
            marginTop: 16,
            opacity: subOpacity,
            transform: `translateY(${subY}px)`,
            fontSize: 24,
            color: "rgba(255, 255, 255, 0.45)",
            textAlign: "center",
          }}
        >
          Zero install. Zero friction. Just scan and go.
        </div>
      </div>
    </AbsoluteFill>
  );
};
