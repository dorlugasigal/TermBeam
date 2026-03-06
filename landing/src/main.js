// ─── Terminal Typing Animation ───────────────────────────────
const command = 'npx termbeam';

const bannerLines = [
  '  ████████╗███████╗██████╗ ███╗   ███╗██████╗ ███████╗ █████╗ ███╗   ███╗',
  '  ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██╔══██╗██╔════╝██╔══██╗████╗ ████║',
  '     ██║   █████╗  ██████╔╝██╔████╔██║██████╔╝█████╗  ███████║██╔████╔██║',
  '     ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║',
  '     ██║   ███████╗██║  ██║██║ ╚═╝ ██║██████╔╝███████╗██║  ██║██║ ╚═╝ ██║',
  '     ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝',
];

const qrLines = [
  ' ▄▄▄▄▄▄▄ ▄ ▄ ▄▄▄▄  ▄   ▄▄▄▄▄▄▄ ',
  ' █ ▄▄▄ █ ███  ▄▀▄▀ ▄▀▀ █ ▄▄▄ █ ',
  ' █ ███ █ ▄▄█▄█▀▄▀██ ▄  █ ███ █ ',
  ' █▄▄▄▄▄█ ▄▀▄▀▄ █ █▀▄ █ █▄▄▄▄▄█ ',
  ' ▄  ▄▄▄▄▄▄▄█ ▀▀▄█ ▄   ▄  ▄ ▄▄▄ ',
  ' ▀▀▄ ▄█▄▀▀███  ██▄ ▀▀▄▀ ██ █▀  ',
  '  █▄▄▀▀▄▄█  ▀▀ ▀▄▄▀ ▄█▀██ ▀  █ ',
  ' █ █▄▀█▄█ ▄▄█ ▄███ █▄▄▄█▀█▀█▀█ ',
  ' ▄ ▀█▄▀▄█▀▄  ▄ ▄▄▄  █▄▄ ▀▀▄▀ ▀ ',
  ' █▄ █▀▄▄█▀ ▀▄ ▀ ▄ ▀▄█    █▄▀▀▄ ',
  ' ███▀▄▄▄▀▀▄▄█ ▄█▀█▄ ▀▄▄█▄▄██▄  ',
  ' ▄▄▄▄▄▄▄ █ ▄▀█ ██▀██▄█ ▄ ██    ',
  ' █ ▄▄▄ █ █▀▄ █▄█ ▄▀ ██▄▄▄█▄ ▄▀ ',
  ' █ ███ █ ▀▄▄ █▄▄█▀▄▀ ▄█ ▄▄ ▄▄█ ',
  ' █▄▄▄▄▄█ ▄█▀▄▀  ▄▀  ▄▄ █▀▄▀▀ ▀ ',
  '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀',
];

const infoLines = [
  '',
  '  Beam your terminal to any device 📡  <span class="out-dim">v1.10.0</span>',
  '',
  '  Shell:    <span class="out-white">zsh</span>',
  '  Session:  <span class="out-white">termbeam</span>',
  '  Auth:     <span class="out-green">🔒 password</span>',
  '  Bind:     <span class="out-white">127.0.0.1</span> <span class="out-dim">(localhost only)</span>',
  '',
  '  Public:   <span class="out-accent">https://kx9m2.devtunnels.ms</span>',
  '  Local:    <span class="out-accent">http://localhost:3456</span>',
  '',
  'QR_PLACEHOLDER',
  '',
  '  Scan the QR code or open: <span class="out-accent">https://kx9m2.devtunnels.ms</span>',
  '  Password: <span class="out-green">k7x9m2p4</span>',
];

function animateTerminal() {
  const typedEl = document.getElementById('typed-command');
  const outputEl = document.getElementById('terminal-output');
  const cursorEl = document.querySelector('.terminal-cursor');
  if (!typedEl || !outputEl) return;

  let charIndex = 0;

  function typeChar() {
    if (charIndex < command.length) {
      typedEl.textContent += command[charIndex];
      charIndex++;
      setTimeout(typeChar, 60 + Math.random() * 40);
    } else {
      // Done typing — hide cursor briefly, show output
      if (cursorEl) cursorEl.style.display = 'none';
      setTimeout(showOutput, 300);
    }
  }

  function showOutput() {
    // 1. Render the ASCII banner as a single tight block
    const bannerWrap = document.createElement('div');
    bannerWrap.className = 'ascii-banner';
    for (const line of bannerLines) {
      const div = document.createElement('div');
      div.innerHTML = `<span class="out-purple">${line}</span>`;
      bannerWrap.appendChild(div);
    }
    outputEl.appendChild(bannerWrap);

    // 2. Reveal info lines one by one (with QR code inline)
    let lineIndex = 0;
    function addLine() {
      if (lineIndex < infoLines.length) {
        if (infoLines[lineIndex] === 'QR_PLACEHOLDER') {
          // Render QR code as a block
          const qrWrap = document.createElement('div');
          qrWrap.className = 'qr-block';
          for (const qrLine of qrLines) {
            const div = document.createElement('div');
            div.textContent = qrLine;
            qrWrap.appendChild(div);
          }
          outputEl.appendChild(qrWrap);
        } else {
          const div = document.createElement('div');
          div.innerHTML = infoLines[lineIndex];
          outputEl.appendChild(div);
        }
        lineIndex++;
        setTimeout(addLine, 60);
      }
    }
    setTimeout(addLine, 200);
  }

  // Start after a small delay for dramatic effect
  setTimeout(typeChar, 800);
}

// ─── Scroll Reveal ─────────────────────────────────────────
function setupReveal() {
  const els = document.querySelectorAll('[data-reveal]');
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const delay = entry.target.dataset.revealDelay || 0;
          setTimeout(() => {
            entry.target.classList.add('revealed');
          }, delay * 120);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 },
  );

  els.forEach((el) => observer.observe(el));
}

// ─── Copy Install Command ──────────────────────────────────
window.copyInstall = function () {
  navigator.clipboard.writeText('npx termbeam').then(() => {
    const btn = document.getElementById('copy-btn');
    const icon = document.getElementById('copy-icon');
    btn.classList.add('copied');
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      btn.classList.remove('copied');
      icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
    }, 2000);
  });
};

// ─── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupReveal();
  animateTerminal();
});
