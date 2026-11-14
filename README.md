# Choco Quick Search

A fast, keyboard-driven search box for [Chocolatey community packages](https://community.chocolatey.org/packages), packaged as a PWA you can run locally and install as a desktop app.

## Run it

Requires Node.js 18+ (no dependencies).

```bash
npm start
# or: PORT=8080 node server.js
```

Then open http://localhost:4173.

## Install as a desktop app

Open http://localhost:4173 in Chrome or Edge and use **Install app** (the install icon in the address bar, or menu → Cast/Save → Install). It then launches in its own window like a native app, with an offline app shell via service worker.

## Features

- Instant, debounced search across package Id, title, and tags (top 30 results by downloads, latest versions only)
- Package icon, version, download count, approval status, and tags per result
- `Enter` or click copies `choco install <id> -y` to the clipboard
- `Ctrl+O` opens the package page on community.chocolatey.org
- `↑`/`↓` to move through results, `Esc` to clear, `/` anywhere to focus the box
- 5-minute server-side result cache; search term is sanitized before it reaches the upstream OData API

## How it works

- `server.js` — zero-dependency Node server. Serves the static PWA from `public/` and proxies `/api/search` to the Chocolatey v2 OData feed (`Search()` with `$filter=IsLatestVersion`, ordered by download count), parsing the Atom XML response into JSON. A proxy is required because the upstream API sends no CORS headers, so browsers cannot call it directly.
- `public/` — the PWA: `index.html`, `styles.css`, `app.js`, `manifest.webmanifest`, `sw.js`, icons.
- `make_icons.py` — regenerates the PNG icons (pure stdlib, no Pillow).
