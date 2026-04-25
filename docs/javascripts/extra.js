// Lightweight enhancements for the unified docs site.
// Currently: copy the install command from the homepage hero.
(function () {
  function bindCopy() {
    var btn = document.getElementById('tb-copy');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var text = 'npx termbeam';
      var done = function () {
        btn.classList.add('is-copied');
        setTimeout(function () {
          btn.classList.remove('is-copied');
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch (_e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  }

  // Material's instant navigation: rebind on each page swap.
  if (window.document$ && typeof window.document$.subscribe === 'function') {
    window.document$.subscribe(bindCopy);
  } else if (document.readyState !== 'loading') {
    bindCopy();
  } else {
    document.addEventListener('DOMContentLoaded', bindCopy);
  }
})();
