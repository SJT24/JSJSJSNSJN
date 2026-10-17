import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { detectLanguage, scoreQuality, scoreSpam } from './quality.js';
export function expandSearchText(text = '') {
  const source = String(text).toLocaleLowerCase();
  const extras = [];
  // PostgreSQL's `simple` parser does not segment continuous CJK text. Add overlapping
  // bigrams so Chinese/Japanese queries have searchable terms without external binaries.
  const runs = source.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]{2,}/gu) || [];
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) extras.push(run.slice(i, i + 2));
  }
  return `${source} ${extras.join(' ')}`.trim().slice(0, 250000);
}
const DROP = 'script,style,noscript,svg,canvas,iframe,nav,footer,header,aside,form,button,[aria-hidden="true"],.advertisement,.ads,.cookie,.menu,.sidebar';
export function normalizeUrl(input, base) {
  try {
    const u = new URL(input, base);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = ''; u.username = ''; u.password = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|ref|source)$/i.test(key)) u.searchParams.delete(key);
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/{2,}/g, '/');
    return u.toString();
  } catch { return null; }
}
export function cleanHtml(html, url) {
  const $ = load(html);
  $('head').find('meta[http-equiv="refresh"]').remove();
  const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || $('h1').first().text()).trim().replace(/\s+/g, ' ').slice(0, 500);
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
  const canonical = normalizeUrl($('link[rel="canonical"]').attr('href') || url, url) || url;
  const dateRaw = $('meta[property="article:published_time"]').attr('content') || $('meta[name="date"]').attr('content') || $('time[datetime]').first().attr('datetime');
  const publishedAt = dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw).toISOString() : null;
  $(DROP).remove();
  let body = $('article').text() || $('[role="main"]').text() || $('main').text() || $('body').text();
  body = body.replace(/[\u00a0\t\r]+/g, ' ').replace(/\n\s*\n+/g, '\n').replace(/ {2,}/g, ' ').trim().slice(0, 200000);
  const links = $('a[href]').map((_, el) => normalizeUrl($(el).attr('href'), url)).get().filter(Boolean).slice(0, 500);
  const language = detectLanguage(`${title} ${body.slice(0, 4000)}`);
  const spamScore = scoreSpam({ title, body, links });
  const quality = scoreQuality({ title, description, body, language, spamScore });
  const contentHash = createHash('sha256').update(`${title}\n${body}`).digest('hex');
  return { url, canonicalUrl: canonical, title, description, body, searchText: expandSearchText(`${title} ${description} ${body}`), language, publishedAt, links: [...new Set(links)], contentHash, spamScore, quality };
}
