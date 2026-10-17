import pg from 'pg';
const { Pool } = pg;
let pool;
export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false }, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  }
  return pool;
}
export async function query(sql, params) { return getPool().query(sql, params); }
export async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS urls (
    id BIGSERIAL PRIMARY KEY, url TEXT NOT NULL UNIQUE, host TEXT NOT NULL,
    discovered_from TEXT, status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','fetching','indexed','blocked','error')),
    priority REAL NOT NULL DEFAULT 1, depth INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0, next_fetch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_fetch_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS urls_queue_idx ON urls(status, next_fetch_at, priority DESC);
  CREATE TABLE IF NOT EXISTS documents (
    id BIGSERIAL PRIMARY KEY, url_id BIGINT NOT NULL UNIQUE REFERENCES urls(id) ON DELETE CASCADE,
    canonical_url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'unknown', published_at TIMESTAMPTZ,
    content_hash TEXT NOT NULL, quality REAL NOT NULL DEFAULT 0.5, spam_score REAL NOT NULL DEFAULT 0,
    search_text TEXT NOT NULL DEFAULT '', embedding JSONB, fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_text, title || ' ' || description || ' ' || body))) STORED
  );
  ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';
  DO $$ BEGIN
    IF position('search_text' in pg_get_expr((SELECT adbin FROM pg_attrdef WHERE adrelid='documents'::regclass AND adnum=(SELECT attnum FROM pg_attribute WHERE attrelid='documents'::regclass AND attname='search_vector')), 'documents'::regclass)) = 0 THEN
      ALTER TABLE documents DROP COLUMN search_vector CASCADE;
      ALTER TABLE documents ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_text, title || ' ' || description || ' ' || body))) STORED;
    END IF;
  END $$;
  UPDATE documents SET search_text=concat_ws(' ',title,description,body) WHERE search_text='';
  CREATE INDEX IF NOT EXISTS documents_search_idx ON documents USING GIN(search_vector);
  CREATE INDEX IF NOT EXISTS documents_hash_idx ON documents(content_hash);
  CREATE INDEX IF NOT EXISTS documents_quality_idx ON documents(quality DESC);
  CREATE TABLE IF NOT EXISTS crawl_events (
    id BIGSERIAL PRIMARY KEY, url TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT, duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS crawl_events_created_idx ON crawl_events(created_at DESC);
  CREATE TABLE IF NOT EXISTS evaluation_queries (
    id BIGSERIAL PRIMARY KEY, query TEXT NOT NULL, relevant_urls TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
}
export async function closePool() { if (pool) await pool.end(); pool = undefined; }
