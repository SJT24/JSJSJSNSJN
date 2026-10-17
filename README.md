# Shanjitong Search Pipeline 1.2

A deployable starter implementation of the complete pipeline: discovery → crawling → cleaning/deduplication → PostgreSQL full-text index → hybrid-ready retrieval → ranking → offline quality evaluation.

## Search interface (v1.2)

- A responsive Simplified Chinese (`zh-CN`) search page is served at `/` by the same Express service.
- Added animated aurora/grid background, floating logo, glowing hero title, interactive search field, loading skeletons, staggered result entrances, hover motion, and responsive mobile layout.
- Respects `prefers-reduced-motion`; external result links use `noopener noreferrer`, and UI text is escaped before rendering.
- Search UI uses `/api/search`; it requires no separate frontend build step.

## What is implemented

- URL discovery from seed URLs, `robots.txt` sitemap declarations, sitemap XML, and page links.
- Crawl queue stored in PostgreSQL; retry/backoff, bounded response size/time, content-type checks, per-host crawl delay, and `robots.txt` checks using the configured bot identity. Discovery fetches validate public DNS/IPs and manually check redirects to reduce SSRF risk; a robots network failure is fail-closed.
- HTML extraction, canonical URL normalization, tracking parameter removal, metadata/body extraction, SHA-256 content hashes, language heuristic, quality and spam heuristics.
- PostgreSQL GIN full-text index and search endpoint; ingestion/query text expands CJK runs into overlapping bigrams to improve basic Chinese/Japanese matching under PostgreSQL's `simple` parser. This is a baseline tokenizer, not a replacement for a production-grade language analyzer.
- Ranking combines lexical rank, query-term coverage, title match, exact title phrase, quality, freshness, and spam penalty.
- Optional OpenAI-compatible embedding API integration. The worker generates embeddings for new pages and backfills missing embeddings at a controlled interval after an API key is configured. Semantic candidates are retrieved independently from lexical candidates and merged with Reciprocal Rank Fusion (RRF); the JSONB vector scan is bounded to 10,000 recent vectors and is only suitable for small indexes.
- Admin APIs for seed submission, crawl statistics, and evaluation. Admin endpoints require a bearer token; production startup refuses short/missing admin tokens. A basic per-process IP rate limiter protects endpoints (use a shared gateway/Redis limiter for multi-instance deployments).
- Evaluation metrics: Recall@K, MRR, NDCG@K.

## Validation status (2026-10-17)

- Passed: JavaScript syntax checks (`node --check src/*.js`, `node --check scripts/smoke-test.mjs`).
- Passed: offline unit tests (`npm run test:offline`, 4/4), covering language heuristics, bounded quality/spam scores, and Recall/MRR/NDCG calculations. These tests caught and fixed Japanese language detection order (kana must be checked before Han characters).
- Blocked by environment: `npm install --no-audit --no-fund` timed out because this execution environment cannot resolve `registry.npmjs.org`; `cheerio`, `express`, `pg`, and `robots-parser` are therefore unavailable. The full integration test suite cannot start.
- Not yet verified: PostgreSQL migration, real HTTP crawling, end-to-end indexing/search, embedding provider, and Render deployment. There is no PostgreSQL server/client installed in this environment and outbound DNS/network access is unavailable. Do not treat these as passed.

After dependencies and a PostgreSQL database are available, run `npm install`, `npm test`, then start the web service and worker against the same database. The remote smoke test below checks health/database connectivity, adds `https://example.com/`, waits for indexing, and searches for the indexed page.

## Important limitations

This is a production-oriented starter, not a Google-scale index. PostgreSQL `simple` text search does not provide high-quality Chinese segmentation by itself. For serious Chinese search, add a Chinese tokenizer (e.g. Jieba-based tokenization at ingestion/query time) or move to OpenSearch with a Chinese analyzer. The initial semantic branch only re-scores documents retrieved by keyword search, so it cannot find semantically related documents that have zero keyword overlap. A production hybrid system should retrieve lexical and vector candidates independently, then merge with Reciprocal Rank Fusion (RRF). Do not crawl private, paywalled, or disallowed content; comply with site terms and applicable law.

## Run locally

Requires Node.js 20+ and PostgreSQL 14+.

```bash
cp .env.example .env
# Edit DATABASE_URL and ADMIN_TOKEN
npm install
npm test
npm start
```

In another terminal, run the crawler worker:

```bash
npm run worker
```

Seed a site (replace token and URL):

```bash
curl -X POST http://localhost:10000/api/admin/seeds \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer replace-with-a-long-random-secret' \
  -d '{"url":"https://example.com/"}'
```

Search:

```bash
curl 'http://localhost:10000/api/search?q=search%20engine&limit=10'
```

Stats:

```bash
curl http://localhost:10000/api/admin/stats \
  -H 'authorization: Bearer replace-with-a-long-random-secret'
```

Evaluate with a manually judged query set:

```bash
curl -X POST http://localhost:10000/api/admin/evaluate \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer replace-with-a-long-random-secret' \
  -d '{"cases":[{"query":"search engine","relevantUrls":["https://example.com/guide"]}]}'
```

## End-to-end smoke test

With the API and worker deployed and sharing the same database, set `SEARCH_BASE_URL` and `ADMIN_TOKEN`, then run:

```bash
SEARCH_BASE_URL=https://your-service.onrender.com ADMIN_TOKEN=your-long-secret npm run smoke:remote
```

The test uses only `https://example.com/`, waits up to 90 seconds for an indexed document, and checks that a search result includes `example.com`. It requires outbound access from the deployed worker and a valid admin token.

## Render deployment

1. Push this directory to a **separate repository** or merge it deliberately into your existing search backend; do not overwrite your website repository accidentally.
2. Create a Render PostgreSQL database.
3. Create a Web Service using `npm install` / `npm start`, and a Background Worker using `npm install` / `npm run worker`.
4. Set `DATABASE_URL`, a strong `ADMIN_TOKEN`, and a truthful `CRAWLER_USER_AGENT` with contact information.
5. Keep the worker and web service pointed at the same database.
6. Test `/health`, add one small site as a seed, check `/api/admin/stats`, then run several hand-judged queries through `/api/admin/evaluate`.

`render.yaml` is a starting blueprint. Review the current Render database/service plan availability and pricing before deploying. Never commit `.env` or API keys.
