import React from 'react';

// iPhone 15 Pro Max mockup — titanium frame, Dynamic Island, realistic proportions
export const PhoneMockup: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  scale?: number;
}> = ({ children, style, scale = 1 }) => {
  // iPhone 15 Pro Max proportions (roughly 77.6 x 159.9mm → ~390 x 844 logical pts)
  const W = 390 * scale;
  const H = 844 * scale;
  const BEZEL = 3 * scale;
  const RADIUS = 55 * scale;

  return (
    <div
      style={{
        width: W,
        height: H,
        borderRadius: RADIUS,
        position: 'relative',
        // Titanium frame
        background: 'linear-gradient(145deg, #3a3a3c 0%, #2c2c2e 40%, #1c1c1e 100%)',
        padding: BEZEL,
        boxShadow: [
          `0 40px 100px rgba(0,0,0,0.7)`,
          `0 0 60px rgba(83,52,131,0.15)`,
          `inset 0 1px 0 rgba(255,255,255,0.08)`,
          `inset 0 -1px 0 rgba(0,0,0,0.3)`,
        ].join(', '),
        ...style,
      }}
    >
      {/* Side button (right) */}
      <div
        style={{
          position: 'absolute',
          right: -2 * scale,
          top: 180 * scale,
          width: 3 * scale,
          height: 80 * scale,
          background: 'linear-gradient(180deg, #4a4a4c, #2c2c2e)',
          borderRadius: `0 ${2 * scale}px ${2 * scale}px 0`,
        }}
      />
      {/* Volume buttons (left) */}
      <div
        style={{
          position: 'absolute',
          left: -2 * scale,
          top: 160 * scale,
          width: 3 * scale,
          height: 36 * scale,
          background: 'linear-gradient(180deg, #4a4a4c, #2c2c2e)',
          borderRadius: `${2 * scale}px 0 0 ${2 * scale}px`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -2 * scale,
          top: 210 * scale,
          width: 3 * scale,
          height: 36 * scale,
          background: 'linear-gradient(180deg, #4a4a4c, #2c2c2e)',
          borderRadius: `${2 * scale}px 0 0 ${2 * scale}px`,
        }}
      />

      {/* Screen */}
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: RADIUS - BEZEL,
          overflow: 'hidden',
          background: '#000',
          position: 'relative',
        }}
      >
        {/* Status bar */}
        <div
          style={{
            height: 54 * scale,
            background: '#1a1a2e',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            padding: `0 ${28 * scale}px ${6 * scale}px`,
            fontSize: 14 * scale,
            color: '#fff',
            fontWeight: 600,
            position: 'relative',
            zIndex: 2,
          }}
        >
          <span style={{ fontSize: 15 * scale, fontWeight: 600 }}>9:41</span>

          {/* Dynamic Island */}
          <div
            style={{
              width: 126 * scale,
              height: 37 * scale,
              borderRadius: 20 * scale,
              background: '#000',
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              top: 11 * scale,
              boxShadow: '0 0 0 0.5px rgba(255,255,255,0.04)',
            }}
          />

          <div
            style={{
              display: 'flex',
              gap: 5 * scale,
              alignItems: 'center',
              fontSize: 13 * scale,
            }}
          >
            {/* Signal bars */}
            <svg width={18 * scale} height={12 * scale} viewBox="0 0 18 12">
              <rect x="0" y="9" width="3" height="3" rx="0.5" fill="#fff" />
              <rect x="4" y="6" width="3" height="6" rx="0.5" fill="#fff" />
              <rect x="8" y="3" width="3" height="9" rx="0.5" fill="#fff" />
              <rect x="12" y="0" width="3" height="12" rx="0.5" fill="#fff" />
            </svg>
            {/* Wi-Fi */}
            <svg width={16 * scale} height={12 * scale} viewBox="0 0 16 12">
              <path d="M8 11.5a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" fill="#fff" />
              <path
                d="M4.7 7.9a4.5 4.5 0 016.6 0"
                stroke="#fff"
                strokeWidth="1.3"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M2 5.2a8 8 0 0112 0"
                stroke="#fff"
                strokeWidth="1.3"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            {/* Battery */}
            <svg width={27 * scale} height={12 * scale} viewBox="0 0 27 12">
              <rect
                x="0"
                y="0.5"
                width="23"
                height="11"
                rx="2.5"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="1"
                fill="none"
              />
              <rect x="24" y="3.5" width="2.5" height="5" rx="1" fill="rgba(255,255,255,0.35)" />
              <rect x="1.5" y="2" width="20" height="8" rx="1.5" fill="#30d158" />
            </svg>
          </div>
        </div>

        {/* Screen content */}
        <div
          style={{
            position: 'absolute',
            top: 54 * scale,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'hidden',
          }}
        >
          {children}
        </div>

        {/* Home indicator */}
        <div
          style={{
            position: 'absolute',
            bottom: 8 * scale,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 134 * scale,
            height: 5 * scale,
            borderRadius: 3 * scale,
            background: 'rgba(255,255,255,0.2)',
            zIndex: 10,
          }}
        />
      </div>
    </div>
  );
};
