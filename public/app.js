'use strict';

const searchInput = document.getElementById('search');
const clearButton = document.getElementById('clear');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const toastEl = document.getElementById('toast');

const DEBOUNCE_MS = 250;
let debounceTimer = null;
let activeController = null;
let requestId = 0;
let results = [];
let activeIndex = -1;

function setStatus(text, isError) {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('error', Boolean(isError));
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function formatDownloads(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function render() {
  resultsEl.textContent = '';
  activeIndex = -1;

  if (!results.length) return;

  for (const pkg of results) {
    const li = document.createElement('li');
    li.className = 'result';
    li.dataset.id = pkg.id;

    const icon = document.createElement('img');
    icon.className = 'pkg-icon';
    icon.loading = 'lazy';
    icon.alt = '';
    if (pkg.iconUrl) {
      icon.src = pkg.iconUrl;
      icon.onerror = () => { icon.removeAttribute('src'); };
    }

    const body = document.createElement('div');
    body.className = 'body';

    const topRow = document.createElement('div');
    topRow.className = 'top-row';

    const id = document.createElement('span');
    id.className = 'pkg-id';
    id.textContent = pkg.id;

    const version = document.createElement('span');
    version.className = 'version';
    version.textContent = pkg.version;

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = pkg.title !== pkg.id ? pkg.title : '';

    topRow.append(id, version, title);

    const summary = document.createElement('div');
    summary.className = 'summary';
    summary.textContent = pkg.summary;

    const meta = document.createElement('div');
    meta.className = 'meta';

    const downloads = document.createElement('span');
    downloads.className = 'chip';
    downloads.textContent = '⬇ ' + formatDownloads(pkg.downloads);
    meta.append(downloads);

    if (pkg.approved) {
      const approved = document.createElement('span');
      approved.className = 'chip approved';
      approved.textContent = 'approved';
      meta.append(approved);
    }

    for (const tag of pkg.tags.slice(0, 3)) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = tag;
      meta.append(chip);
    }

    body.append(topRow, summary, meta);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'copy install';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyInstall(pkg);
    });

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = 'open page';
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(pkg.galleryUrl, '_blank', 'noopener');
    });

    actions.append(copyBtn, openBtn);

    li.append(icon, body, actions);
    li.addEventListener('click', () => copyInstall(pkg));
    resultsEl.append(li);
  }
}

function setActive(index) {
  const items = resultsEl.children;
  if (!items.length) return;
  if (activeIndex >= 0 && items[activeIndex]) {
    items[activeIndex].classList.remove('active');
  }
  activeIndex = ((index % items.length) + items.length) % items.length;
  const el = items[activeIndex];
  el.classList.add('active');
  el.scrollIntoView({ block: 'nearest' });
}

function activePackage() {
  if (activeIndex < 0 || !results[activeIndex]) return null;
  return results[activeIndex];
}

async function copyInstall(pkg) {
  const command = pkg.installCommand;
  try {
    await navigator.clipboard.writeText(command);
    showToast('Copied: ' + command);
  } catch {
    const input = document.createElement('textarea');
    input.value = command;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast('Copied: ' + command);
  }
}

async function runSearch(term) {
  requestId += 1;
  const thisRequest = requestId;

  if (activeController) activeController.abort();
  activeController = new AbortController();

  setStatus('Searching…', false);

  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(term) + '&top=30', {
      signal: activeController.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + res.status);
    }
    const data = await res.json();
    if (thisRequest !== requestId) return;

    results = data.results || [];
    render();

    if (!results.length) {
      setStatus('No packages found for “' + term + '”.', false);
    } else {
      setStatus(results.length + ' package' + (results.length === 1 ? '' : 's') + ' (top by downloads)', false);
      setActive(0);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (thisRequest !== requestId) return;
    results = [];
    render();
    setStatus('Search failed: ' + err.message, true);
  }
}

function onInput() {
  const term = searchInput.value.trim();
  clearButton.hidden = !searchInput.value;
  clearTimeout(debounceTimer);
  if (!term) {
    requestId += 1;
    if (activeController) activeController.abort();
    results = [];
    render();
    setStatus('', false);
    return;
  }
  debounceTimer = setTimeout(() => runSearch(term), DEBOUNCE_MS);
}

searchInput.addEventListener('input', onInput);
clearButton.addEventListener('click', () => {
  searchInput.value = '';
  clearButton.hidden = true;
  searchInput.focus();
  onInput();
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActive(activeIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActive(activeIndex - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const pkg = activePackage();
    if (pkg) copyInstall(pkg);
  } else if (e.key === 'Escape') {
    searchInput.value = '';
    clearButton.hidden = true;
    onInput();
  } else if (e.key.toLowerCase() === 'o' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const pkg = activePackage();
    if (pkg) window.open(pkg.galleryUrl, '_blank', 'noopener');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
