import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';

const { fontFamily } = loadFont('normal', {
  weights: ['700', '800', '900'],
  subsets: ['latin'],
});

const BG = 'radial-gradient(ellipse at 50% 50%, #1a1a3e 0%, #0f0c29 55%, #0a0a1a 100%)';

type TitleMode = 'stack' | 'slam' | 'rapid';

export const TitleCard: React.FC<{
  title: string;
  subtitle?: string;
  mode?: TitleMode;
}> = ({ title, subtitle, mode = 'stack' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words = title.split(' ');

  if (mode === 'slam') {
    return <SlamMode text={title} subtitle={subtitle} frame={frame} fps={fps} />;
  }
  if (mode === 'rapid') {
    const phrases = title.includes('|') ? title.split('|').map((s) => s.trim()) : words;
    return <RapidMode words={phrases} frame={frame} fps={fps} />;
  }
  return <StackMode words={words} subtitle={subtitle} frame={frame} fps={fps} />;
};

// ── SLAM: single dramatic entrance ──────────────────────
const SlamMode: React.FC<{
  text: string;
  subtitle?: string;
  frame: number;
  fps: number;
}> = ({ text, subtitle, frame, fps }) => {
  const s = spring({ frame, fps, config: { damping: 10, stiffness: 200 } });
  const scale = interpolate(s, [0, 1], [4, 1]);
  const opacity = interpolate(s, [0, 1], [0, 1]);
  const rotateZ = interpolate(s, [0, 1], [-3, 0]);
  const glow = interpolate(Math.sin(frame * 0.15), [-1, 1], [0.3, 0.8]);

  const subS = spring({ frame, fps, delay: 10, config: { damping: 20, stiffness: 200 } });
  const subOpacity = interpolate(subS, [0, 1], [0, 1]);
  const subY = interpolate(subS, [0, 1], [20, 0]);

  return (
    <AbsoluteFill
      style={{ background: BG, justifyContent: 'center', alignItems: 'center', fontFamily }}
    >
      <div
        style={{
          fontSize: 120,
          fontWeight: 900,
          color: '#ffffff',
          textTransform: 'uppercase',
          letterSpacing: -4,
          transform: `scale(${scale}) rotate(${rotateZ}deg)`,
          opacity,
          textShadow: `0 0 ${glow * 60}px rgba(167, 139, 250, ${glow})`,
        }}
      >
        {text}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: 'rgba(167, 139, 250, 0.85)',
            opacity: subOpacity,
            transform: `translateY(${subY}px)`,
            marginTop: 16,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          {subtitle}
        </div>
      )}
    </AbsoluteFill>
  );
};

// ── RAPID: all words stacked with QR + tap finger ───────
const QR_ART = [
  '▄▄▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄▄▄▄',
  '█ ▄▄▄ █ █▀▄▀█ █ ▄▄▄ █',
  '█ ███ █ ▄▀▄▀▄ █ ███ █',
  '█▄▄▄▄▄█ ▄▀█▀▄ █▄▄▄▄▄█',
  '▄▄▄▄▄▄▄█▄█▄█▄█▄▄▄▄▄▄▄',
  '▄▀▄▀▀▄▄ ▀▄█▀▄▄▀▀▄█▀▄▄',
  '█▀▀▄▀▀▄▀▄▀▀██▀▄▀▄█▀▀▄',
  '▄▄▄▄▄▄▄ ▀▀▄▄█ █▄█ ▀▀▄',
  '█ ▄▄▄ █  ▄█▀▀▄▄▀▀█▀▀▄',
  '█ ███ █ █▀▀▄▀▄▄█▄▀▄█▄',
  '█▄▄▄▄▄█ █▄▀▄▀█▄▀██▀▄▀',
];

const RapidMode: React.FC<{
  words: string[];
  frame: number;
  fps: number;
}> = ({ words, frame, fps }) => {
  // Scan line sweeps across QR
  const scanY = interpolate(frame, [0, 30], [0, 100], { extrapolateRight: 'clamp' });

  // Tap finger animation (repeating tap)
  const tapCycle = ((frame - 8) % 10) / 10;
  const fingerY =
    tapCycle < 0.4
      ? interpolate(tapCycle, [0, 0.4], [0, 8])
      : interpolate(tapCycle, [0.4, 1], [8, 0]);
  const fingerScale =
    tapCycle < 0.4
      ? interpolate(tapCycle, [0, 0.4], [1, 0.92])
      : interpolate(tapCycle, [0.4, 1], [0.92, 1]);
  const ringProgress =
    tapCycle < 0.4
      ? interpolate(tapCycle, [0, 0.4], [0, 1])
      : interpolate(tapCycle, [0.4, 1], [1, 0]);
  const ringScale = interpolate(ringProgress, [0, 1], [0.5, 2]);
  const ringOpacity = interpolate(ringProgress, [0, 1], [0.5, 0]);

  return (
    <AbsoluteFill
      style={{ background: BG, justifyContent: 'center', alignItems: 'center', fontFamily }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        {words.map((word, i) => {
          const isLast = i === words.length - 1;
          const isTap = i === 1;
          const delay = i * 8;
          const s = spring({ frame, fps, delay, config: { damping: 12, stiffness: 180 } });
          const slideX = interpolate(s, [0, 1], [i % 2 === 0 ? -500 : 500, 0]);
          const opacity = interpolate(s, [0, 1], [0, 1]);

          // "CONNECTED" punch
          const punch = isLast
            ? spring({ frame, fps, delay, config: { damping: 8, stiffness: 300 } })
            : 1;
          const punchScale = isLast ? interpolate(punch, [0, 1], [2.5, 1]) : 1;

          const color = isLast ? '#2ecc71' : 'rgba(255,255,255,0.55)';
          const fontSize = isLast ? 200 : 80;

          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 24,
                opacity,
                transform: `translateX(${slideX}px) scale(${punchScale})`,
              }}
            >
              {/* QR icon next to "Scan" */}
              {i === 0 && (
                <div style={{ position: 'relative' }}>
                  <pre
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 10,
                      lineHeight: 1.1,
                      color: '#ffffff',
                      letterSpacing: 1,
                      margin: 0,
                    }}
                  >
                    {QR_ART.join('\n')}
                  </pre>
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: `${scanY}%`,
                      height: 2,
                      background: 'linear-gradient(90deg, transparent, #2ecc71, transparent)',
                      boxShadow: '0 0 12px #2ecc71',
                    }}
                  />
                </div>
              )}

              {/* Tap finger next to "Tap" */}
              {isTap && frame > 8 && (
                <div style={{ position: 'relative' }}>
                  <div
                    style={{
                      fontSize: 60,
                      transform: `translateY(${fingerY}px) scale(${fingerScale})`,
                    }}
                  >
                    👆
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      top: '55%',
                      left: '50%',
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      border: '2px solid rgba(167, 139, 250, 0.6)',
                      transform: `translate(-50%, -50%) scale(${ringScale})`,
                      opacity: ringOpacity,
                    }}
                  />
                </div>
              )}

              <div
                style={{
                  fontSize,
                  fontWeight: 900,
                  color,
                  textTransform: 'uppercase',
                  letterSpacing: isLast ? -6 : -2,
                  lineHeight: 1,
                  textShadow: isLast
                    ? '0 0 60px rgba(46, 204, 113, 0.6), 0 0 120px rgba(46, 204, 113, 0.3)'
                    : 'none',
                }}
              >
                {word}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── STACK: words enter from alternating sides ───────────
const StackMode: React.FC<{
  words: string[];
  subtitle?: string;
  frame: number;
  fps: number;
}> = ({ words, subtitle, frame, fps }) => {
  const wordElements = words.map((word, i) => {
    const s = spring({ frame, fps, delay: i * 4, config: { damping: 12, stiffness: 200 } });
    const translateX = interpolate(s, [0, 1], [i % 2 === 0 ? -300 : 300, 0]);
    const opacity = interpolate(s, [0, 1], [0, 1]);
    const scale = interpolate(s, [0, 1], [2, 1]);

    return (
      <div
        key={i}
        style={{
          fontSize: 80,
          fontWeight: 900,
          color: '#ffffff',
          textTransform: 'uppercase',
          letterSpacing: -2,
          lineHeight: 0.95,
          opacity,
          transform: `translateX(${translateX}px) scale(${scale})`,
          textShadow: '0 4px 40px rgba(167, 139, 250, 0.5)',
        }}
      >
        {word}
      </div>
    );
  });

  const lineS = spring({
    frame,
    fps,
    delay: words.length * 4 + 2,
    config: { damping: 18, stiffness: 220 },
  });
  const lineWidth = interpolate(lineS, [0, 1], [0, 160]);

  const subS = spring({
    frame,
    fps,
    delay: words.length * 4 + 6,
    config: { damping: 20, stiffness: 200 },
  });
  const subOpacity = interpolate(subS, [0, 1], [0, 1]);
  const subY = interpolate(subS, [0, 1], [20, 0]);

  return (
    <AbsoluteFill
      style={{ background: BG, justifyContent: 'center', alignItems: 'center', fontFamily }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {wordElements}
        <div
          style={{
            width: lineWidth,
            height: 4,
            borderRadius: 2,
            background: 'linear-gradient(90deg, #a78bfa, #7c3aed, #a78bfa)',
            boxShadow: '0 0 16px rgba(167, 139, 250, 0.5)',
            marginTop: 12,
          }}
        />
        {subtitle && (
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: 'rgba(167, 139, 250, 0.85)',
              opacity: subOpacity,
              transform: `translateY(${subY}px)`,
              marginTop: 8,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
