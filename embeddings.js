export async function createEmbedding(text) {
  if (!process.env.EMBEDDING_API_KEY || !process.env.EMBEDDING_API_URL) return null;
  const response = await fetch(process.env.EMBEDDING_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.EMBEDDING_API_KEY}` },
    body: JSON.stringify({ model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small', input: String(text || '').slice(0, 8000) }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Embedding provider HTTP ${response.status}`);
  const payload = await response.json();
  const vector = payload.data?.[0]?.embedding;
  return Array.isArray(vector) ? vector : null;
}
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}
