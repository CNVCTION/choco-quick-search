const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const CACHE_MS = 30000;
const cache = new Map();
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
function decodeXml(s=''){return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));}
function tag(entry,name){const re=new RegExp(`<d:${name}(?:\\s[^>]*)?>([\\s\\S]*?)</d:${name}>`,'i');return decodeXml(entry.match(re)?.[1]?.replace(/<[^>]+>/g,'').trim()||'');}
function parse(xml){return [...xml.matchAll(/<entry(?:\\s[^>]*)?>([\\s\\S]*?)<\\/entry>/gi)].map(([,e])=>{const id=tag(e,'Id');return{id,title:tag(e,'Title')||id,version:tag(e,'Version'),description:tag(e,'Description'),downloads:Number(tag(e,'DownloadCount')||0),url:`https://community.chocolatey.org/packages/${encodeURIComponent(id)}`};}).filter(p=>p.id);}
function fetchFeed(q){return new Promise((resolve,reject)=>{const u=new URL('https://community.chocolatey.org/api/v2/Search()');u.searchParams.set('searchTerm',`'${q.replace(/'/g,"''")}'`);u.searchParams.set('includePrerelease','false');u.searchParams.set('$top','30');https.get(u,{headers:{Accept:'application/atom+xml, application/xml;q=0.9'}},r=>{let b='';r.setEncoding('utf8');r.on('data',c=>b+=c);r.on('end',()=>r.statusCode>=200&&r.statusCode<300?resolve(parse(b)):reject(new Error('Feed error')));}).on('error',reject).setTimeout(10000,function(){this.destroy(new Error('Timeout'));});});}
module.exports = async (req,res)=>{
 const url=new URL(req.url,'https://app.invalid');
 if(url.pathname==='/api/search'||url.searchParams.get('route')==='search'){
  const q=String(url.searchParams.get('q')||'').trim().slice(0,80);if(q.length<2)return res.status(200).json({results:[]});if(/[<>]/.test(q))return res.status(400).json({error:'Please use a package name or keyword.'});
  const k=q.toLowerCase(),v=cache.get(k);if(v&&Date.now()-v.time<CACHE_MS)return res.status(200).json(v.data);
  try{const data={results:await fetchFeed(q)};cache.set(k,{time:Date.now(),data});if(cache.size>100)cache.delete(cache.keys().next().value);return res.status(200).json(data);}catch{return res.status(502).json({error:"Couldn't reach the Chocolatey package feed. Try again in a moment."});}
 }
 const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\\/+/, '');if(rel.split('/').includes('..'))return res.status(400).send('Bad path');
 try{const data=await fs.readFile(path.join(process.cwd(),'public',rel));res.setHeader('Content-Type',mime[path.extname(rel)]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');return res.status(200).send(data);}catch{return res.status(404).send('Not found');}
};
