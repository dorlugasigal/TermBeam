// Shared theme switching logic for index.html and terminal.html
const THEMES = [
  { id: 'dark', name: 'Dark', bg: '#1e1e1e' },
  { id: 'light', name: 'Light', bg: '#f3f3f3' },
  { id: 'monokai', name: 'Monokai', bg: '#272822' },
  { id: 'solarized-dark', name: 'Solarized Dark', bg: '#002b36' },
  { id: 'solarized-light', name: 'Solarized Light', bg: '#fdf6e3' },
  { id: 'nord', name: 'Nord', bg: '#2e3440' },
  { id: 'dracula', name: 'Dracula', bg: '#282a36' },
  { id: 'github-dark', name: 'GitHub Dark', bg: '#0d1117' },
  { id: 'one-dark', name: 'One Dark', bg: '#282c34' },
  { id: 'catppuccin', name: 'Catppuccin', bg: '#1e1e2e' },
  { id: 'gruvbox', name: 'Gruvbox', bg: '#282828' },
  { id: 'night-owl', name: 'Night Owl', bg: '#011627' },
];

function getTheme() {
  return localStorage.getItem('termbeam-theme') || 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const t = THEMES.find((x) => x.id === theme) || THEMES[0];
  document.querySelector('meta[name="theme-color"]').content = t.bg;
  localStorage.setItem('termbeam-theme', theme);
  document.querySelectorAll('.theme-option').forEach((el) => {
    el.classList.toggle('active', el.dataset.themeOption === theme);
  });
  if (typeof window.onThemeApplied === 'function') {
    window.onThemeApplied(theme);
  }
}

// Theme toggle button
document.getElementById('theme-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('theme-picker').classList.toggle('open');
});

// Close picker on outside click
document.addEventListener('click', () => {
  document.getElementById('theme-picker').classList.remove('open');
});

// Theme option click handlers
document.querySelectorAll('.theme-option').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    applyTheme(el.dataset.themeOption);
  });
});

// Apply saved theme on load
applyTheme(getTheme());
