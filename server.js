'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPSTREAM_HOST = 'community.chocolatey.org';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  if (hit) cache.delete(key);
  return null;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

function fetchUpstream(searchTerm, top) {
  const query =
    `searchTerm='${encodeURIComponent(searchTerm)}'` +
    `&includePrerelease=false&$filter=IsLatestVersion` +
    `&$orderby=DownloadCount%20desc&$skip=0&$top=${top}`;
  const options = {
    host: UPSTREAM_HOST,
    path: `/api/v2/Search()?${query}`,
    headers: { Accept: 'application/atom+xml, application/xml' },
  };
  return new Promise((resolve, reject) => {
    const req = https.get(options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Upstream responded ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Upstream request timed out'));
    });
  });
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  return decodeXmlEntities(s.replace(/<[^>]*>/g, '')).trim();
}

function firstMatch(s, re) {
  const m = s.match(re);
  return m ? m[1] : '';
}

function parseAtom(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch;
  while ((entryMatch = entryRe.exec(xml)) !== null) {
    const entry = entryMatch[1];
    const properties = {
      Id: firstMatch(entry, /Packages\(Id='([^']*)'/) || firstMatch(entry, /<title[^>]*>([\s\S]*?)<\/title>/),
      Summary: firstMatch(entry, /<summary[^>]*>([\s\S]*?)<\/summary>/),
      Authors: firstMatch(entry, /<author>\s*<name[^>]*>([\s\S]*?)<\/name>/),
    };
    const propRe = /<d:(\w+)(?:\s[^>]*)?>([\s\S]*?)<\/d:\1>|<d:(\w+)(?:\s[^>]*)?\/>/g;
    let propMatch;
    while ((propMatch = propRe.exec(entry)) !== null) {
      const name = propMatch[1] || propMatch[3];
      const raw = propMatch[2] !== undefined ? propMatch[2] : '';
      properties[name] = raw.includes('<') ? stripTags(raw) : decodeXmlEntities(raw);
    }
    entries.push(properties);
  }
  return entries;
}

function compareVersions(a, b) {
  const pa = a.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function toResults(entries) {
  const byId = new Map();
  for (const e of entries) {
    const id = e.Id || '';
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing || compareVersions(e.Version || '0', existing.Version || '0') > 0) {
      byId.set(id, e);
    }
  }
  const results = [];
  for (const e of byId.values()) {
    const downloads = Number(e.DownloadCount) || 0;
    results.push({
      id: e.Id,
      title: e.Title || e.Id,
      version: e.Version,
      summary: e.Summary || '',
      downloads,
      iconUrl: e.IconUrl || null,
      tags: e.Tags ? e.Tags.split(/\s+/).filter(Boolean) : [],
      authors: e.Authors || '',
      approved: e.IsApproved === 'true',
      galleryUrl: e.GalleryDetailsUrl || `https://community.chocolatey.org/packages/${e.Id}`,
      installCommand: `choco install ${e.Id} -y`,
    });
  }
  results.sort((a, b) => b.downloads - a.downloads);
  return results;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function handleSearch(req, res, url) {
  const q = (url.searchParams.get('q') || '').replace(/'/g, '').trim();
  const top = Math.min(Math.max(parseInt(url.searchParams.get('top'), 10) || 30, 1), 100);
  if (!q) {
    sendJson(res, 200, { query: q, results: [] });
    return;
  }
  const key = `${q.toLowerCase()}|${top}`;
  const cached = cacheGet(key);
  if (cached) {
    sendJson(res, 200, { query: q, cached: true, results: cached });
    return;
  }
  fetchUpstream(q, top)
    .then((xml) => toResults(parseAtom(xml)))
    .then((results) => {
      cacheSet(key, results);
      sendJson(res, 200, { query: q, results });
    })
    .catch((err) => {
      sendJson(res, 502, { query: q, error: err.message || 'Search failed' });
    });
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/search') {
    handleSearch(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Choco Quick Search running at http://localhost:${PORT}`);
});
