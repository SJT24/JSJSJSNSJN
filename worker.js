import { migrate, query, closePool } from './db.js';
import { crawlOne } from './crawler.js';
import { createEmbedding } from './embeddings.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await migrate(); console.log('crawler and embedding worker started');
let stopped=false; for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>{stopped=true;});
let lastEmbeddingAt=0;
async function backfillOneEmbedding() {
  if (!process.env.EMBEDDING_API_KEY || !process.env.EMBEDDING_API_URL) return false;
  const r=await query(`SELECT id,title,description,LEFT(body,6000) AS body FROM documents WHERE embedding IS NULL ORDER BY updated_at DESC LIMIT 1`);
  if (!r.rowCount) return false;
  const d=r.rows[0];
  const vector=await createEmbedding(`${d.title}\n${d.description}\n${d.body}`);
  if (vector) await query('UPDATE documents SET embedding=$2::jsonb,updated_at=NOW() WHERE id=$1 AND embedding IS NULL',[d.id,JSON.stringify(vector)]);
  return Boolean(vector);
}
while(!stopped){
  try {
    const did=await crawlOne();
    if (!did && Date.now()-lastEmbeddingAt>30000) { lastEmbeddingAt=Date.now(); await backfillOneEmbedding(); }
    if(!did) await sleep(2500);
  } catch(e) { console.error('worker iteration failed',e); await sleep(5000); }
}
await closePool();
