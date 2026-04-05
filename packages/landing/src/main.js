// ═══════════════════════════════════════════════════════════════
// TermBeam Landing — Premium Interactions
// Gradient mesh · Word reveal · 3D tilt · Scroll showcase · Parallax
// ═══════════════════════════════════════════════════════════════

// ─── Unified Scroll Manager ─────────────────────────────────
const scrollManager = {
  handlers: [],
  ticking: false,
  init() {
    window.addEventListener(
      'scroll',
      () => {
        if (!this.ticking) {
          requestAnimationFrame(() => {
            this.handlers.forEach((fn) => fn());
            this.ticking = false;
          });
          this.ticking = true;
        }
      },
      { passive: true },
    );
  },
  add(fn) {
    this.handlers.push(fn);
  },
};

// ─── Word-by-Word Hero Reveal ──────────────────────────────────
function initWordReveal() {
  const heading = document.getElementById('hero-heading');
  if (!heading) return;

  const text = heading.textContent.trim();
  const words = text.split(/\s+/);
  heading.innerHTML = '';

  words.forEach((word, i) => {
    const span = document.createElement('span');
    span.className = 'word';
    const inner = document.createElement('span');
    inner.className = 'word-inner';
    inner.textContent = word;
    inner.style.animationDelay = `${0.15 + i * 0.08}s`;
    span.appendChild(inner);
    heading.appendChild(span);

    // Add space between words
    if (i < words.length - 1) {
      heading.appendChild(document.createTextNode(' '));
    }
  });
}

// ─── 3D Device Tilt ────────────────────────────────────────────
function initDeviceTilt() {
  const heroDevices = document.getElementById('hero-devices');
  if (!heroDevices || window.innerWidth < 768) return;

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let rafId = null;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function animate() {
    currentX = lerp(currentX, targetX, 0.08);
    currentY = lerp(currentY, targetY, 0.08);

    // Stop RAF when values converge (save CPU when mouse idle)
    if (Math.abs(currentX - targetX) < 0.001 && Math.abs(currentY - targetY) < 0.001) {
      currentX = targetX;
      currentY = targetY;
      rafId = null;
      return;
    }

    // Apply tilt to wrapper only — parallax handles inner elements separately
    heroDevices.style.transform = `perspective(1200px) rotateY(${currentX * 10}deg) rotateX(${-currentY * 10}deg)`;

    rafId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (!rafId) {
      rafId = requestAnimationFrame(animate);
    }
  }

  heroDevices.addEventListener('mousemove', (e) => {
    const rect = heroDevices.getBoundingClientRect();
    targetX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    targetY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    startAnimation();
  });

  heroDevices.addEventListener('mouseleave', () => {
    targetX = 0;
    targetY = 0;
    startAnimation();
  });

  startAnimation();

  // Cleanup on resize to mobile (debounced)
  let tiltResizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(tiltResizeTimer);
    tiltResizeTimer = setTimeout(() => {
      if (window.innerWidth < 768 && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
        heroDevices.style.transform = '';
      } else if (window.innerWidth >= 768 && !rafId) {
        startAnimation();
      }
    }, 150);
  });
}

// ─── Scroll-Linked Hero Parallax ───────────────────────────────
function initHeroParallax() {
  const heroDevices = document.getElementById('hero-devices');
  const heroHeading = document.getElementById('hero-heading');
  const hero = document.getElementById('hero');
  const browser = document.getElementById('device-browser');
  const phone = document.getElementById('device-phone');
  if (!heroDevices || !hero) return;

  scrollManager.add(() => {
    const scrollY = window.scrollY;
    const heroHeight = hero.offsetHeight;
    const progress = Math.min(scrollY / heroHeight, 1);

    // Opacity fade on wrapper
    heroDevices.style.opacity = 1 - progress * 0.6;

    // Scale/translate on individual devices — no transform conflict with tilt on wrapper
    if (browser) {
      const scale = 1 - progress * 0.15;
      const translateY = -progress * 60;
      browser.style.transform = `scale(${scale}) translateY(${translateY}px)`;
    }
    if (phone && window.innerWidth >= 768) {
      const phoneRotate = Math.sin(progress * Math.PI) * 5;
      const phoneLift = -progress * 20;
      const phoneScale = 1 - progress * 0.1;
      phone.style.transform = `rotate(${phoneRotate}deg) translateY(${phoneLift}px) scale(${phoneScale})`;
    }

    // Fade heading
    if (heroHeading) {
      heroHeading.style.opacity = 1 - progress * 1.5;
      heroHeading.style.transform = `translateY(${-progress * 30}px)`;
    }
  });
}

// ─── Feature Showcase — Scroll-Triggered Entry ─────────────────
function initShowcase() {
  const features = document.querySelectorAll('[data-feature]');
  if (!features.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -60px 0px' },
  );

  features.forEach((f) => observer.observe(f));
}

// ─── Scroll Reveal ─────────────────────────────────────────────
function initScrollReveal() {
  const elements = document.querySelectorAll('[data-reveal]');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  elements.forEach((el) => observer.observe(el));
}

// ─── Nav Scroll Effect ─────────────────────────────────────────
function initNavScroll() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  scrollManager.add(() => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  });
}

// ─── Copy Install Command ──────────────────────────────────────
function initCopyButton() {
  const copyStatus = document.getElementById('copy-status');

  function bindCopy(installBtnId, copyBtnId) {
    const installBtn = document.getElementById(installBtnId);
    const copyBtn = document.getElementById(copyBtnId);
    if (!installBtn || !copyBtn) return;

    installBtn.addEventListener('click', () => {
      navigator.clipboard
        .writeText('npx termbeam')
        .then(() => {
          installBtn.classList.add('copied');
          copyBtn.classList.add('copied');
          if (copyStatus) copyStatus.textContent = 'Copied to clipboard';
          setTimeout(() => {
            installBtn.classList.remove('copied');
            copyBtn.classList.remove('copied');
            if (copyStatus) copyStatus.textContent = '';
          }, 2000);
        })
        .catch(() => {
          // Fallback: select text for manual copy with visible instruction
          const range = document.createRange();
          range.selectNodeContents(installBtn);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          if (copyStatus) copyStatus.textContent = 'Press Ctrl+C to copy';
          setTimeout(() => {
            if (copyStatus) copyStatus.textContent = '';
          }, 3000);
        });
    });
  }

  bindCopy('install-btn', 'copy-btn');
  bindCopy('cta-install-btn', 'cta-copy-btn');
}

// ─── Mobile Nav Toggle ─────────────────────────────────────────
function initMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');
  if (!toggle || !links) return;

  // Create overlay element
  const overlay = document.createElement('div');
  overlay.className = 'nav-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);

  const mainContent = document.getElementById('main-content');

  function getFocusableElements() {
    return links.querySelectorAll('a, button, [tabindex]:not([tabindex="-1"])');
  }

  function openMenu() {
    toggle.classList.add('open');
    links.classList.add('open');
    overlay.classList.add('visible');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('nav-open');
    if (mainContent) mainContent.inert = true;
    const firstLink = links.querySelector('a');
    if (firstLink) firstLink.focus();
  }

  function closeMenu() {
    toggle.classList.remove('open');
    links.classList.remove('open');
    overlay.classList.remove('visible');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-open');
    if (mainContent) mainContent.inert = false;
    toggle.focus();
  }

  toggle.addEventListener('click', () => {
    toggle.classList.contains('open') ? closeMenu() : openMenu();
  });

  // Close on link click
  links.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', closeMenu);
  });

  // Close on overlay click
  overlay.addEventListener('click', closeMenu);

  // Close on Escape + focus trap
  document.addEventListener('keydown', (e) => {
    if (!toggle.classList.contains('open')) return;

    if (e.key === 'Escape') {
      closeMenu();
      return;
    }

    if (e.key === 'Tab') {
      const focusable = [...getFocusableElements(), toggle];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

// ─── GitHub Star Count ─────────────────────────────────────────
function initStarCount() {
  const badge = document.getElementById('stars-badge');
  if (!badge) return;
  const span = badge.querySelector('span');
  if (!span) return;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  fetch('https://api.github.com/repos/dorlugasigal/TermBeam', {
    headers: { Accept: 'application/vnd.github.v3+json' },
    signal: controller.signal,
  })
    .then((r) => {
      clearTimeout(timeoutId);
      return r.ok ? r.json() : null;
    })
    .then((data) => {
      if (data && typeof data.stargazers_count === 'number') {
        const count = data.stargazers_count;
        span.textContent = count >= 1000 ? (count / 1000).toFixed(1) + 'k' : String(count);
      }
    })
    .catch(() => {});
}

// ─── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('js');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  scrollManager.init();
  initWordReveal();
  initScrollReveal();
  initNavScroll();
  initShowcase();
  if (!reducedMotion) {
    initDeviceTilt();
    initHeroParallax();
  }
  initCopyButton();
  initMobileNav();
  initStarCount();

  // Cursor spotlight on hero (RAF-throttled)
  const hero = document.querySelector('.hero');
  if (hero && !reducedMotion) {
    let spotlightRaf = null;
    hero.addEventListener('mousemove', (e) => {
      if (spotlightRaf) return;
      spotlightRaf = requestAnimationFrame(() => {
        hero.style.setProperty('--mouse-x', e.clientX + 'px');
        hero.style.setProperty('--mouse-y', e.clientY + 'px');
        spotlightRaf = null;
      });
    });
  }
});
