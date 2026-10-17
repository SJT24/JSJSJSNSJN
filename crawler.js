import robotsParser from 'robots-parser';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { query } from './db.js';
import { cleanHtml, normalizeUrl } from './clean.js';
import { extractLinks, discoverSitemaps } from './discovery.js';
import { createEmbedding } from './embeddings.js';
const agent = () => process.env.CRAWLER_USER_AGENT || 'ShanjitongBot/1.0 (+https://example.com/bot)';
const maxBytes = Number(process.env.CRAWL_MAX_BYTES || 2000000);
const timeoutMs = Number(process.env.CRAWL_TIMEOUT_MS || 12000);
const hostTimes = new Map();
const robotsCache = new Map();
function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
  }
  return true;
}
async function assertPublicHttpUrl(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Only public HTTP(S) URLs are allowed');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private host is not crawlable');
  if (isIP(host)) { if (isPrivateAddress(host)) throw new Error('Private IP address is not crawlable'); return; }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) throw new Error('Host resolves to a non-public IP address');
}
async function allowedByRobots(url) {
  const u = new URL(url); let entry = robotsCache.get(u.origin);
  if (!entry || Date.now() - entry.time > 3600000) {
    try { await assertPublicHttpUrl(`${u.origin}/robots.txt`); const r = await fetch(`${u.origin}/robots.txt`, { redirect: 'manual', headers: { 'user-agent': agent() }, signal: AbortSignal.timeout(5000) }); entry = { parser: robotsParser(`${u.origin}/robots.txt`, r.ok ? (await r.text()).slice(0, 500000) : ''), time: Date.now() }; }
    catch { entry = { parser: robotsParser(`${u.origin}/robots.txt`, 'User-agent: *\nDisallow: /'), time: Date.now() }; }
    robotsCache.set(u.origin, entry);
  }
  return entry.parser.isAllowed(url, agent()) !== false;
}
async function delayHost(host) {
  const interval = Number(process.env.CRAWL_INTERVAL_MS || 1500);
  const wait = Math.max(0, interval - (Date.now() - (hostTimes.get(host) || 0)));
  if (wait) await new Promise(r => setTimeout(r, wait));
  hostTimes.set(host, Date.now());
}
async function enqueue(url, source, depth = 0) {
  const normalized = normalizeUrl(url); if (!normalized) return;
  try { await query(`INSERT INTO urls(url,host,discovered_from,depth,status) VALUES($1,$2,$3,$4,'queued') ON CONFLICT(url) DO NOTHING`, [normalized, new URL(normalized).host, source || null, depth]); } catch {}
}
export async function addSeed(url) {
  const normalized = normalizeUrl(url); if (!normalized) throw new Error('Invalid HTTP(S) seed URL');
  await assertPublicHttpUrl(normalized);
  await enqueue(normalized, null, 0);
  const discovered = await discoverSitemaps(normalized);
  for (const u of discovered.slice(0, 5000)) await enqueue(u, normalized, 1);
  return { seed: normalized, sitemapUrlsFound: discovered.length };
}
async function fetchPage(url) {
  let currentUrl = url;
  let response;
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicHttpUrl(currentUrl);
    if (!await allowedByRobots(currentUrl)) { const e = new Error('Disallowed by robots.txt'); e.code = 'ROBOTS_BLOCKED'; throw e; }
    const host = new URL(currentUrl).host; await delayHost(host);
    response = await fetch(currentUrl, { redirect: 'manual', headers: { 'user-agent': agent(), accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' }, signal: AbortSignal.timeout(timeoutMs) });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 5) throw new Error('Redirect limit exceeded');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    break;
  }
  if (!response || !response.ok) throw new Error(`HTTP ${response?.status || 'fetch failed'}`);
  const type = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error(`Unsupported content type: ${type}`);
  const len = Number(response.headers.get('content-length') || 0); if (len > maxBytes) throw new Error('Response too large');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error('Response too large'); } chunks.push(value); }
  return { html: new TextDecoder().decode(Buffer.concat(chunks)), finalUrl: currentUrl };
}
async function upsertDocument(urlId, doc) {
  if (doc.spamScore >= 0.85 || doc.body.length < 80 || !doc.title) {
    await query(`UPDATE urls SET status='blocked',last_fetch_at=NOW(),last_error=$2 WHERE id=$1`, [urlId, 'Filtered by content quality gate']); return 'filtered';
  }
  const duplicate = await query('SELECT id FROM documents WHERE content_hash=$1 AND url_id<>$2 LIMIT 1', [doc.contentHash, urlId]);
  if (duplicate.rowCount) doc.quality = Math.max(0, doc.quality - 0.15);
  let embedding = null;
  try { embedding = await createEmbedding(`${doc.title}\n${doc.description}\n${doc.body.slice(0, 6000)}`); } catch (e) { console.warn('embedding generation failed; indexed lexically', e.message); }
  await query(`INSERT INTO documents(url_id,canonical_url,title,description,body,language,published_at,content_hash,quality,spam_score,search_text,embedding)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(url_id) DO UPDATE SET canonical_url=EXCLUDED.canonical_url,title=EXCLUDED.title,description=EXCLUDED.description,body=EXCLUDED.body,language=EXCLUDED.language,published_at=EXCLUDED.published_at,content_hash=EXCLUDED.content_hash,quality=EXCLUDED.quality,spam_score=EXCLUDED.spam_score,search_text=EXCLUDED.search_text,embedding=COALESCE(EXCLUDED.embedding,documents.embedding),updated_at=NOW()`,
    [urlId, doc.canonicalUrl, doc.title, doc.description, doc.body, doc.language, doc.publishedAt, doc.contentHash, doc.quality, doc.spamScore, doc.searchText || `${doc.title} ${doc.description} ${doc.body}`, embedding ? JSON.stringify(embedding) : null]);
  await query(`UPDATE urls SET status='indexed',last_fetch_at=NOW(),last_error=NULL WHERE id=$1`, [urlId]); return 'indexed';
}
export async function crawlOne() {
  const claimed = await query(`WITH candidate AS (SELECT id FROM urls WHERE status IN ('queued','error') AND next_fetch_at<=NOW() AND attempts<5 ORDER BY priority DESC,next_fetch_at ASC,id ASC FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE urls u SET status='fetching',attempts=attempts+1 FROM candidate c WHERE u.id=c.id RETURNING u.id,u.url,u.depth`);
  if (!claimed.rowCount) return false;
  const row = claimed.rows[0]; const start = Date.now(); let outcome = 'error'; let detail = null;
  try {
    const { html, finalUrl } = await fetchPage(row.url); const doc = cleanHtml(html, finalUrl);
    const result = await upsertDocument(row.id, doc); outcome = result;
    if (row.depth < 4) { const links = extractLinks(html, finalUrl); for (const u of links.slice(0, 150)) await enqueue(u, finalUrl, row.depth + 1); }
  } catch (err) {
    detail = String(err?.message || err).slice(0, 500); outcome = err?.code === 'ROBOTS_BLOCKED' ? 'blocked' : 'error';
    await query(`UPDATE urls SET status=$2,last_error=$3,next_fetch_at=NOW() + (LEAST(attempts,5) * INTERVAL '5 minutes') WHERE id=$1`, [row.id, outcome, detail]);
  } finally {
    await query('INSERT INTO crawl_events(url,outcome,detail,duration_ms) VALUES($1,$2,$3,$4)', [row.url, outcome, detail, Date.now() - start]);
  }
  return true;
}
