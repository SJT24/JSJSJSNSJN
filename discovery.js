import { load } from 'cheerio';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeUrl } from './clean.js';

function privateIp(ip) {
  if (isIP(ip) === 4) { const p=ip.split('.').map(Number); return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127); }
  if (isIP(ip) === 6) { const v=ip.toLowerCase(); return v==='::'||v==='::1'||v.startsWith('fc')||v.startsWith('fd')||/^fe[89ab]/.test(v)||v.startsWith('::ffff:127.')||v.startsWith('::ffff:10.')||v.startsWith('::ffff:192.168.'); }
  return true;
}
async function assertPublic(url) {
  const u=new URL(url); if(!['http:','https:'].includes(u.protocol)||u.username||u.password) throw new Error('Non-public URL blocked');
  if(u.hostname==='localhost'||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')) throw new Error('Private hostname blocked');
  if(isIP(u.hostname)){if(privateIp(u.hostname))throw new Error('Private IP blocked');return;}
  const a=await lookup(u.hostname,{all:true,verbatim:true}); if(!a.length||a.some(x=>privateIp(x.address)))throw new Error('Non-public DNS result blocked');
}
async function safeText(url, fetchFn=fetch, maxBytes=2_000_000) {
  let current=url;
  for(let i=0;i<=3;i++) {
    await assertPublic(current);
    const r=await fetchFn(current,{redirect:'manual',headers:{'user-agent':process.env.CRAWLER_USER_AGENT||'ShanjitongBot/1.0'},signal:AbortSignal.timeout(8000)});
    if([301,302,303,307,308].includes(r.status)){const loc=r.headers.get('location');if(!loc||i===3)throw new Error('Redirect limit');current=new URL(loc,current).toString();continue;}
    if(!r.ok)return null;
    const len=Number(r.headers.get('content-length')||0);if(len>maxBytes)throw new Error('Discovery response too large');
    const text=await r.text();if(Buffer.byteLength(text)>maxBytes)throw new Error('Discovery response too large');return text;
  }
  return null;
}

const allowed = (url) => { try { const u = new URL(url); return ['http:','https:'].includes(u.protocol) && !/\.(pdf|zip|rar|7z|jpg|jpeg|png|gif|webp|mp4|mp3|css|js|woff2?)(\?|$)/i.test(u.pathname); } catch { return false; } };
export function extractLinks(html, baseUrl) {
  const $ = load(html); const found = new Set();
  $('a[href]').each((_, el) => { const url = normalizeUrl($(el).attr('href'), baseUrl); if (url && allowed(url)) found.add(url); });
  return [...found];
}
export async function discoverSitemaps(seedUrl, fetchFn = fetch) {
  const origin = new URL(seedUrl).origin;
  const sitemaps = new Set([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]);
  try {
    const robots = await safeText(`${origin}/robots.txt`, fetchFn, 500000);
    if (robots) for (const m of robots.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) { const n=normalizeUrl(m[1]); if(n) sitemaps.add(n); }
  } catch {}
  const urls = new Set();
  const visited = new Set();
  const queue = [...sitemaps].slice(0, 8);
  while(queue.length && visited.size<20 && urls.size<10000) {
    const sm=queue.shift(); if(visited.has(sm))continue; visited.add(sm);
    try {
      const xml=await safeText(sm,fetchFn,5_000_000); if(!xml)continue;
      const $=load(xml,{xmlMode:true});
      const locs=$('url > loc').map((_,el)=>$(el).text().trim()).get();
      const nested=$('sitemap > loc').map((_,el)=>$(el).text().trim()).get();
      for(const value of locs){const n=normalizeUrl(value,seedUrl);if(n&&allowed(n))urls.add(n);if(urls.size>=10000)break;}
      for(const value of nested){const n=normalizeUrl(value,sm);if(n&&!visited.has(n)&&queue.length<20)queue.push(n);}
    } catch {}
  }
  return [...urls];
}
