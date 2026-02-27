import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Intro } from "./Intro";
import { CliTerminal } from "./CliTerminal";
import { PhoneScene } from "./PhoneScene";
import { Outro } from "./Outro";
import { TitleCard } from "./TitleCard";

// ── Timing constants (frames @ 30fps) ───────────────────
const FPS = 30;

// Scene durations — typography-driven narrative
const INTRO_DUR = 75;
const TYPO1_DUR = 56; // "Share Your Terminal" — stack
const TYPO2_DUR = 55; // "One Command" — slam
const CLI_DUR = 290;
const TYPO3_DUR = 80; // "Scan QR | Tap Session | CONNECTED" — rapid
const PHONE_DUR = 300; // merged connect + terminal
const OUTRO_DUR = 150;

const FLIP_DUR = 12;

// Cumulative starts
const INTRO_START = 0;
const TYPO1_START = INTRO_START + INTRO_DUR;
const TYPO2_START = TYPO1_START + TYPO1_DUR;
const CLI_START = TYPO2_START + TYPO2_DUR;
const TYPO3_START = CLI_START + CLI_DUR;
const PHONE_START = TYPO3_START + TYPO3_DUR;
const OUTRO_START = PHONE_START + PHONE_DUR;
const TOTAL_DUR = OUTRO_START + OUTRO_DUR;

// ── Spring-based FlipExit ────────────────────────────────
const FlipExit: React.FC<{
  children: React.ReactNode;
  exitFrame: number;
  frame: number;
  fps: number;
}> = ({ children, exitFrame, frame, fps }) => {
  const flipFrame = frame - exitFrame;

  if (flipFrame < 0) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const progress = spring({
    frame: flipFrame,
    fps,
    config: { damping: 15, stiffness: 120 },
    durationInFrames: FLIP_DUR,
  });

  const rotateX = interpolate(progress, [0, 1], [0, 92]);
  const opacity = interpolate(progress, [0, 1], [1, 0]);
  const scale = interpolate(progress, [0, 1], [1, 0.85]);

  return (
    <AbsoluteFill style={{ perspective: 3600 }}>
      <AbsoluteFill
        style={{
          transformOrigin: "center bottom",
          transform: `rotateX(${rotateX}deg) scale(${scale})`,
          opacity,
          backfaceVisibility: "hidden",
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const TermBeamDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: "#0a0a1a" }}>
      {/* ── Background Music ──────────────────────────── */}
      <Audio
        src={staticFile("music.mp3")}
        volume={(f) =>
          interpolate(
            f,
            [0, 30, TOTAL_DUR - 60, TOTAL_DUR],
            [0, 0.25, 0.25, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          )
        }
      />

      {/* 1. Intro ─────────────────────────────────────── */}
      <Sequence from={INTRO_START} durationInFrames={INTRO_DUR + FLIP_DUR} name="Intro">
        <FlipExit exitFrame={INTRO_DUR} frame={frame - INTRO_START} fps={fps}>
          <Intro />
        </FlipExit>
      </Sequence>

      {/* 2. "SHARE YOUR TERMINAL" — stack ─────────────── */}
      <Sequence from={TYPO1_START} durationInFrames={TYPO1_DUR + FLIP_DUR} name="Typo-ShareTerminal">
        <FlipExit exitFrame={TYPO1_DUR} frame={frame - TYPO1_START} fps={fps}>
          <TitleCard title="Share Your Terminal" mode="stack" />
        </FlipExit>
      </Sequence>

      {/* 3. "ONE COMMAND" — slam ──────────────────────── */}
      <Sequence from={TYPO2_START} durationInFrames={TYPO2_DUR + FLIP_DUR} name="Typo-OneCommand">
        <FlipExit exitFrame={TYPO2_DUR} frame={frame - TYPO2_START} fps={fps}>
          <TitleCard title="One Command" mode="slam" subtitle="npx termbeam" />
        </FlipExit>
      </Sequence>

      {/* 4. CLI Terminal ──────────────────────────────── */}
      <Sequence from={CLI_START} durationInFrames={CLI_DUR + FLIP_DUR} name="CliTerminal">
        <FlipExit exitFrame={CLI_DUR} frame={frame - CLI_START} fps={fps}>
          <CliTerminal />
        </FlipExit>
      </Sequence>

      {/* 5. "SCAN · TAP · CONNECTED" — rapid ─────────── */}
      <Sequence from={TYPO3_START} durationInFrames={TYPO3_DUR + FLIP_DUR} name="Typo-ScanTap">
        <FlipExit exitFrame={TYPO3_DUR} frame={frame - TYPO3_START} fps={fps}>
          <TitleCard title="Scan the QR | Tap your Session | CONNECTED" mode="rapid" />
        </FlipExit>
      </Sequence>

      {/* 6. Phone Scene (merged connect + terminal) ──── */}
      <Sequence from={PHONE_START} durationInFrames={PHONE_DUR + FLIP_DUR} name="PhoneScene">
        <FlipExit exitFrame={PHONE_DUR} frame={frame - PHONE_START} fps={fps}>
          <PhoneScene />
        </FlipExit>
      </Sequence>

      {/* 7. Outro ─────────────────────────────────────── */}
      <Sequence from={OUTRO_START} durationInFrames={OUTRO_DUR} name="Outro">
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};

export { TOTAL_DUR, FPS };
