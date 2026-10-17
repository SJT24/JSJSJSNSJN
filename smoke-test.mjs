// Run against a deployed instance after setting SEARCH_BASE_URL and ADMIN_TOKEN.
// This intentionally uses a tiny, public test site. Do not point it at private networks.
const base = (process.env.SEARCH_BASE_URL || '').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN || '';
if (!base || !token) {
  console.error('Usage: SEARCH_BASE_URL=https://your-service.onrender.com ADMIN_TOKEN=... node scripts/smoke-test.mjs');
  process.exit(2);
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const request = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  assert(response.ok, `${options.method || 'GET'} ${path} returned HTTP ${response.status}: ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`);
  return data;
};

console.log('1/4 checking API + database health');
const health = await request('/health');
assert(health.ok === true, 'health endpoint did not report ok=true');

console.log('2/4 adding a small public test seed (example.com)');
const seed = await request('/api/admin/seeds', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ url: 'https://example.com/' }),
});
assert(Array.isArray(seed.results) && seed.results.length === 1, 'seed endpoint returned an unexpected payload');

console.log('3/4 waiting for the background worker to crawl and index');
let stats;
for (let i = 0; i < 18; i++) {
  await new Promise(resolve => setTimeout(resolve, 5000));
  stats = await request('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } });
  if (Number(stats.counts?.indexed) > 0 || Number(stats.counts?.documents) > 0) break;
}
assert(Number(stats?.counts?.documents) > 0, `no document indexed after 90 seconds; stats=${JSON.stringify(stats)}`);

console.log('4/4 searching for indexed content');
const search = await request('/api/search?q=example%20domain&semantic=false');
assert(Array.isArray(search.results), 'search response has no results array');
assert(search.results.some(row => String(row.url).includes('example.com')), 'expected example.com in search results');
console.log(JSON.stringify({ ok: true, health, seed, counts: stats.counts, searchMode: search.mode, matched: search.results.length }, null, 2));
