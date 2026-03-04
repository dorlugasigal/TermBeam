/**
 * Terminal search bar logic.
 * Depends on globals defined in terminal.html:
 *   - managed (Map of session objects)
 *   - activeId (current active session ID)
 */

// ===== Terminal Search =====
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const searchCount = document.getElementById('search-count');
const searchRegexBtn = document.getElementById('search-regex');
let searchRegex = false;
let searchResultIndex = 0;
let searchResultTotal = 0;

function getActiveSearchAddon() {
  if (!activeId) return null;
  const ms = managed.get(activeId);
  return ms ? ms.searchAddon : null;
}

function updateSearchCount(idx, total) {
  searchResultIndex = idx;
  searchResultTotal = total;
  searchCount.textContent = total > 0 ? idx + 1 + ' of ' + total : 'No results';
}

function doSearch(direction) {
  const addon = getActiveSearchAddon();
  if (!addon) return;
  const query = searchInput.value;
  if (!query) {
    searchCount.textContent = '';
    return;
  }
  const opts = {
    regex: searchRegex,
    caseSensitive: false,
    incremental: direction === 'next',
  };
  let result;
  if (direction === 'prev') {
    result = addon.findPrevious(query, opts);
  } else {
    result = addon.findNext(query, opts);
  }
  // SearchAddon returns boolean; no match count API in v0.15
  searchCount.textContent = result ? 'Found' : 'No results';
}

function openSearchBar() {
  searchBar.classList.add('visible');
  searchInput.focus();
  searchInput.select();
}

function closeSearchBar() {
  searchBar.classList.remove('visible');
  searchCount.textContent = '';
  searchInput.value = '';
  const addon = getActiveSearchAddon();
  if (addon) addon.clearDecorations();
  // Re-focus terminal
  if (activeId) {
    const ms = managed.get(activeId);
    if (ms) ms.term.focus();
  }
}

searchInput.addEventListener('input', () => doSearch('next'));
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSearchBar();
    e.preventDefault();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    doSearch(e.shiftKey ? 'prev' : 'next');
  }
});
document.getElementById('search-next').addEventListener('click', () => doSearch('next'));
document.getElementById('search-prev').addEventListener('click', () => doSearch('prev'));
document.getElementById('search-close').addEventListener('click', closeSearchBar);
document.getElementById('search-regex').addEventListener('click', () => {
  searchRegex = !searchRegex;
  searchRegexBtn.classList.toggle('active', searchRegex);
  if (searchInput.value) doSearch('next');
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    openSearchBar();
  }
});
