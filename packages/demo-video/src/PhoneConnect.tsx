import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { PhoneMockup } from './PhoneMockup';

const { fontFamily } = loadFont('normal', {
  weights: ['400', '600', '700'],
  subsets: ['latin'],
});

const GRADIENT_BG = 'radial-gradient(ellipse at 60% 40%, #1a1a3e 0%, #0f0c29 50%, #0a0a1a 100%)';

// ── Sessions list UI ────────────────────────────────────
const SessionsScreen: React.FC<{ tapProgress: number }> = ({ tapProgress }) => {
  const tapScale = interpolate(tapProgress, [0, 0.5, 1], [1, 0.95, 1], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#1a1a2e',
        fontFamily,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 14px 10px',
          textAlign: 'center',
          borderBottom: '1px solid #0f3460',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0' }}>
          Term<span style={{ color: '#a78bfa' }}>Beam</span>
        </div>
        <div style={{ fontSize: 10, color: '#6c7086', marginTop: 3 }}>
          Select a session to connect
        </div>
      </div>

      {/* Sessions list */}
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Active session card */}
        <div
          style={{
            background: '#16213e',
            border: '1px solid #533483',
            borderRadius: 10,
            padding: '12px 14px',
            transform: `scale(${tapScale})`,
            boxShadow: tapProgress > 0.3 ? '0 0 20px rgba(83, 52, 131, 0.3)' : 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>pty-mirror</div>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#2ecc71',
                boxShadow: '0 0 6px #2ecc71',
              }}
            />
          </div>
          <div style={{ fontSize: 9, color: '#888', marginTop: 4 }}>/bin/zsh · pty-mirror</div>
          <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>Active · 0 connections</div>
        </div>

        {/* New session button */}
        <div
          style={{
            background: 'transparent',
            border: '1px dashed #0f3460',
            borderRadius: 10,
            padding: '10px 14px',
            textAlign: 'center',
            fontSize: 11,
            color: '#555',
          }}
        >
          + New Session
        </div>
      </div>
    </div>
  );
};

export const PhoneConnect: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── Dramatic 3D phone entrance ─────────────────────────
  const entranceSpring = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120 },
  });
  const phoneRotateY = interpolate(entranceSpring, [0, 1], [45, 0]);
  const phoneRotateX = interpolate(entranceSpring, [0, 1], [-15, 0]);
  const phoneX = interpolate(entranceSpring, [0, 1], [500, 0]);
  const phoneScale = interpolate(entranceSpring, [0, 1], [0.7, 1]);
  const phoneOpacity = interpolate(entranceSpring, [0, 1], [0, 1]);

  // ── Connection ring pulse ──────────────────────────────
  const flashStart = 35;
  const ring1Scale = interpolate(frame, [flashStart, flashStart + 25], [0.8, 3], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const ring1Opacity = interpolate(frame, [flashStart, flashStart + 25], [0.5, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ring2Scale = interpolate(frame, [flashStart + 5, flashStart + 30], [0.8, 2.5], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const ring2Opacity = interpolate(frame, [flashStart + 5, flashStart + 30], [0.4, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // ── Finger tap ─────────────────────────────────────────
  const tapStart = 60;
  const tapProgress = interpolate(frame, [tapStart, tapStart + 6, tapStart + 12], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const fingerVisible = frame >= tapStart && frame < tapStart + 20;
  const fingerOpacity = fingerVisible
    ? interpolate(frame, [tapStart, tapStart + 4, tapStart + 14, tapStart + 20], [0, 1, 1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0;

  // ── Label ──────────────────────────────────────────────
  const labelSpring = spring({
    frame,
    fps,
    delay: 8,
    config: { damping: 20, stiffness: 200 },
  });
  const labelOpacity = interpolate(labelSpring, [0, 1], [0, 1]);
  const labelY = interpolate(labelSpring, [0, 1], [30, 0]);

  // ── "Connected!" badge ─────────────────────────────────
  const connectedStart = tapStart + 15;
  const connSpring = spring({
    frame,
    fps,
    delay: connectedStart,
    config: { damping: 12, stiffness: 160 },
  });
  const connScale = interpolate(connSpring, [0, 1], [0, 1]);
  const connOpacity = interpolate(connSpring, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background: GRADIENT_BG,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily,
        perspective: 3600,
        overflow: 'hidden',
      }}
    >
      {/* Label */}
      <div
        style={{
          position: 'absolute',
          top: 100,
          fontSize: 36,
          fontWeight: 700,
          color: '#ffffff',
          opacity: labelOpacity,
          transform: `translateY(${labelY}px)`,
          textAlign: 'center',
          textShadow: '0 2px 20px rgba(167, 139, 250, 0.3)',
        }}
      >
        Scan the QR code, connect instantly
      </div>

      {/* Phone with 3D entrance */}
      <div style={{ position: 'relative' }}>
        {/* Connection rings */}
        {frame >= flashStart && (
          <>
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: 320,
                height: 320,
                borderRadius: '50%',
                border: '2px solid #a78bfa',
                transform: `translate(-50%, -50%) scale(${ring1Scale})`,
                opacity: ring1Opacity,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: 320,
                height: 320,
                borderRadius: '50%',
                border: '2px solid #533483',
                transform: `translate(-50%, -50%) scale(${ring2Scale})`,
                opacity: ring2Opacity,
              }}
            />
          </>
        )}

        <div
          style={{
            transform: `translateX(${phoneX}px) rotateY(${phoneRotateY}deg) rotateX(${phoneRotateX}deg) scale(${phoneScale})`,
            opacity: phoneOpacity,
            position: 'relative',
            transformStyle: 'preserve-3d',
          }}
        >
          <PhoneMockup>
            <SessionsScreen tapProgress={tapProgress} />
          </PhoneMockup>

          {/* Finger tap indicator */}
          {fingerVisible && (
            <div
              style={{
                position: 'absolute',
                top: 165,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'rgba(167, 139, 250, 0.2)',
                border: '2px solid rgba(167, 139, 250, 0.5)',
                opacity: fingerOpacity,
                boxShadow: '0 0 20px rgba(167, 139, 250, 0.3)',
              }}
            />
          )}

          {/* Connected badge */}
          {frame >= connectedStart && (
            <div
              style={{
                position: 'absolute',
                top: -20,
                right: -60,
                background: '#2ecc71',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                padding: '6px 16px',
                borderRadius: 20,
                transform: `scale(${connScale})`,
                opacity: connOpacity,
                boxShadow: '0 4px 20px rgba(46, 204, 113, 0.4)',
              }}
            >
              ✓ Connected!
            </div>
          )}
        </div>
      </div>

      {/* Flash overlay */}
      {frame >= flashStart && frame < flashStart + 10 && (
        <AbsoluteFill
          style={{
            background: `rgba(167, 139, 250, ${interpolate(
              frame,
              [flashStart, flashStart + 3, flashStart + 10],
              [0, 0.08, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            )})`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
