'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_MS = 30_000;
const cache = new Map();
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png' };

function decodeXml(value = '') {
  return value.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (entity, name, decimal, hex) => {
    if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" }[name.toLowerCase()] || entity;
  });
}
function tag(entry, name) {
  const re = new RegExp(`<d:${name}(?:\\s[^>]*)?>([\\s\\S]*?)</d:${name}>`, 'i');
  return decodeXml(entry.match(re)?.[1]?.replace(/<[^>]+>/g, '').trim() || '');
}
function parseEntries(xml) {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map(([, entry]) => {
    const id = tag(entry, 'Id');
    return { id, title: tag(entry, 'Title') || id, version: tag(entry, 'Version'), description: tag(entry, 'Description'), downloads: Number(tag(entry, 'DownloadCount') || 0), url: `https://community.chocolatey.org/packages/${encodeURIComponent(id)}` };
  }).filter(p => p.id);
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(body)); }
function search(q) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL('https://community.chocolatey.org/api/v2/Search()');
    endpoint.searchParams.set('searchTerm', `'${q.replace(/'/g, "''")}'`);
    endpoint.searchParams.set('includePrerelease', 'false');
    endpoint.searchParams.set('$top', '30');
    https.get(endpoint, { headers: { Accept:'application/atom+xml, application/xml;q=0.9' } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk);
      response.on('end', () => response.statusCode >= 200 && response.statusCode < 300 ? resolve(parseEntries(body)) : reject(new Error(`Upstream HTTP ${response.statusCode}`)));
    }).on('error', reject).setTimeout(10000, function(){ this.destroy(new Error('Upstream timeout')); });
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return json(res, 200, { results: [] });
    if (/[<>]/.test(q)) return json(res, 400, { error: 'Please use a package name or keyword.' });
    const key = q.toLowerCase(); const old = cache.get(key);
    if (old && Date.now() - old.time < CACHE_MS) return json(res, 200, old.data);
    try { const data = { results: await search(q) }; cache.set(key, {time:Date.now(),data}); if(cache.size>100) cache.delete(cache.keys().next().value); return json(res,200,data); }
    catch { return json(res,502,{error:"Couldn't reach the Chocolatey package feed. Try again in a moment."}); }
  }
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const normalized = path.normalize(requested).replace(/^([.][.][/\\\\])+/, '').replace(/^[/\\\\]+/, '');
  const file = path.join(PUBLIC_DIR, normalized);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(400); return res.end('Bad path'); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, {'Content-Type':MIME[path.extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'}); res.end(data); });
});
server.listen(PORT, '0.0.0.0', () => console.log(`Choco Quick Search listening on http://localhost:${PORT}`));
