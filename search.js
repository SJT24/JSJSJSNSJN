import { query as dbQuery } from './db.js';
import { expandSearchText } from './clean.js';
import { createEmbedding, cosineSimilarity } from './embeddings.js';
function tokenize(s = '') { return s.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []; }
export function reciprocalRankFusion(lists, k = 60) {
  const scores = new Map();
  for (const list of lists) list.forEach((item, i) => scores.set(String(item.id), (scores.get(String(item.id)) || 0) + 1 / (k + i + 1)));
  return scores;
}
export function rankCandidates(queryText, candidates, semanticScores = new Map(), fusionScores = new Map()) {
  const terms = [...new Set(tokenize(queryText))];
  return candidates.map(d => {
    const title = (d.title || '').toLocaleLowerCase(), body = (d.body || '').toLocaleLowerCase();
    const termCoverage = terms.length ? terms.filter(t => title.includes(t) || body.includes(t)).length / terms.length : 0;
    const titleMatch = terms.length ? terms.filter(t => title.includes(t)).length / terms.length : 0;
    const phrase = queryText.trim().length > 2 && title.includes(queryText.trim().toLocaleLowerCase()) ? 1 : 0;
    const semantic = semanticScores.get(String(d.id)) || 0;
    const fusion = fusionScores.get(String(d.id)) || 0;
    const freshness = d.published_at ? Math.exp(-Math.max(0, Date.now() - new Date(d.published_at).getTime()) / (1000 * 60 * 60 * 24 * 365)) : 0.35;
    const score = 0.30 * (d.lexical_score || 0) + 0.22 * semantic + 0.12 * fusion + 0.14 * termCoverage + 0.10 * titleMatch + 0.08 * (d.quality || 0) + 0.04 * freshness + 0.10 * phrase - 0.20 * (d.spam_score || 0);
    return { ...d, score: Number(score.toFixed(6)), score_parts: { lexical: Number((d.lexical_score || 0).toFixed(3)), semantic: Number(semantic.toFixed(3)), fusion: Number(fusion.toFixed(4)), quality: d.quality, spam: d.spam_score } };
  }).sort((a, b) => b.score - a.score);
}
export async function search(queryText, { limit = 10, offset = 0, semantic = true } = {}) {
  const q = String(queryText || '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);
  if (!q) return { query: q, results: [], total: 0, mode: 'empty' };
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const safeOffset = Math.max(0, Math.min(10000, Number(offset) || 0));
  const lexicalResult = await dbQuery(`SELECT d.id,d.canonical_url AS url,d.title,d.description,LEFT(d.body,1400) AS snippet,d.body,d.language,d.published_at,d.quality,d.spam_score,
    ts_rank_cd(d.search_vector, plainto_tsquery('simple',$1)) AS lexical_score
    FROM documents d WHERE d.spam_score < 0.85 AND d.search_vector @@ plainto_tsquery('simple',$1)
    ORDER BY lexical_score DESC,d.quality DESC LIMIT 150`, [expandSearchText(q)]);
  const lexicalRows = lexicalResult.rows.map(d => ({ ...d, id: String(d.id), lexical_score: Number(d.lexical_score) || 0 }));
  let vectorRows = [], semanticScores = new Map(), mode = 'keyword';
  if (semantic && process.env.EMBEDDING_API_KEY && process.env.EMBEDDING_API_URL) {
    try {
      const qVec = await createEmbedding(q);
      if (qVec) {
        // Starter implementation scans stored vectors in bounded batches. Replace with pgvector/OpenSearch ANN for large indexes.
        const stored = await dbQuery(`SELECT d.id,d.canonical_url AS url,d.title,d.description,LEFT(d.body,1400) AS snippet,d.body,d.language,d.published_at,d.quality,d.spam_score,d.embedding
          FROM documents d WHERE d.embedding IS NOT NULL AND d.spam_score < 0.85 ORDER BY d.updated_at DESC LIMIT 10000`);
        vectorRows = stored.rows.map(d => ({ ...d, id: String(d.id), lexical_score: 0 })).map(d => ({ ...d, semantic_score: cosineSimilarity(qVec, d.embedding) })).sort((a,b)=>b.semantic_score-a.semantic_score).slice(0,150);
        for (const d of vectorRows) semanticScores.set(String(d.id), Math.max(0, d.semantic_score));
        mode = 'hybrid';
      }
    } catch (e) { console.warn('semantic retrieval unavailable; using keyword search', e.message); mode = 'keyword-fallback'; }
  }
  const all = new Map();
  for (const d of lexicalRows) all.set(String(d.id), { ...d });
  for (const d of vectorRows) { const key = String(d.id); all.set(key, { ...(all.get(key) || d), ...d, lexical_score: all.get(key)?.lexical_score || d.lexical_score || 0 }); }
  const fusion = reciprocalRankFusion([lexicalRows, vectorRows]);
  const ranked = rankCandidates(q, [...all.values()], semanticScores, fusion);
  return { query: q, total: ranked.length, offset: safeOffset, limit: safeLimit, mode, results: ranked.slice(safeOffset, safeOffset + safeLimit).map(({ body, embedding, ...r }) => r) };
}
