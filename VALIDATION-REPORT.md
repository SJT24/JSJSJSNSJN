# Shanjitong Search Pipeline — validation report

Date: 2026-10-17

## Executed

- `node --check src/*.js` — PASS
- `node --check scripts/smoke-test.mjs` — PASS
- `node --test test/offline.test.js` — PASS (4 tests)
- `npm install --no-audit --no-fund` — BLOCKED: command timed out; DNS lookup for `registry.npmjs.org` fails in this execution environment.
- `node --test` — BLOCKED: `ERR_MODULE_NOT_FOUND` for `cheerio`, due to dependency installation being unavailable.
- Live HTTP check for `https://example.com/` — BLOCKED: DNS resolution for `example.com` fails in this execution environment.

## Not executed / not claimed as passed

- PostgreSQL database migration and schema validation: no PostgreSQL server/client available.
- Real crawler → cleaner → database index → search end-to-end flow.
- Embedding API request.
- Render deployment.

## Fix discovered by tests

Japanese detection previously checked Han characters before Hiragana/Katakana, incorrectly classifying Japanese text containing Kanji as Chinese. The order is corrected and covered by the offline test suite.

## Next run in a network-enabled environment

1. `npm install --no-audit --no-fund`
2. `npm run test:offline`
3. `npm test`
4. Configure a PostgreSQL database and start API + worker.
5. Run `SEARCH_BASE_URL=... ADMIN_TOKEN=... npm run smoke:remote`.


## UI upgrade (v1.2)

- Added `public/index.html`: Simplified Chinese default (`lang=zh-CN`) responsive search UI with animated aurora/grid, logo float, title glow, focus transitions, loading skeletons, staggered result animations, hover effects, and reduced-motion support.
- Express now serves the static UI at `/`; search requests go to `/api/search`.
- Verified JavaScript server syntax and offline tests after changes. Full npm dependency install, PostgreSQL migration, real crawl, and deployed browser check remain blocked/unverified in this environment.
