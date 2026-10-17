import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, query } from './db.js';
import { addSeed } from './crawler.js';
import { search } from './search.js';
import { evaluateQuerySet } from './evaluate.js';
const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'32kb'}));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Serve the Simplified Chinese search UI from the same service.
app.use(express.static(path.resolve(__dirname, '../public'), { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
// Small per-process limiter: protects public search from accidental or abusive bursts.
const buckets=new Map();
app.use((req,res,next)=>{const key=req.ip||'unknown';const now=Date.now();let b=buckets.get(key);if(!b||now-b.start>=60000){b={start:now,count:0};buckets.set(key,b);}b.count++;if(b.count>(req.path.startsWith('/api/admin')?30:120)){res.setHeader('Retry-After','60');return res.status(429).json({error:'rate_limited'});}if(buckets.size>5000){for(const [k,v] of buckets)if(now-v.start>120000)buckets.delete(k);}next();});
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');next();});
const auth=(req,res,next)=>{const token=process.env.ADMIN_TOKEN;if(!token||req.get('authorization')!==`Bearer ${token}`) return res.status(401).json({error:'Unauthorized'});next();};
app.get('/health',async(_req,res)=>{try{await query('SELECT 1');res.json({ok:true,service:'shanjitong-search',time:new Date().toISOString()});}catch{res.status(503).json({ok:false,error:'database_unavailable'});}});
app.get('/api/search',async(req,res)=>{try{const result=await search(req.query.q,{limit:req.query.limit,offset:req.query.offset,semantic:req.query.semantic!=='false'});res.json(result);}catch(e){console.error('search error',e);res.status(500).json({error:'search_failed'});}});
app.post('/api/admin/seeds',auth,async(req,res)=>{try{const urls=Array.isArray(req.body.urls)?req.body.urls:[req.body.url];if(!urls.filter(Boolean).length)return res.status(400).json({error:'Provide url or urls'});const results=[];for(const u of urls.filter(Boolean).slice(0,50)){try{results.push(await addSeed(u));}catch(e){results.push({url:u,error:e.message});}}res.json({results});}catch(e){res.status(500).json({error:'seed_failed'});}});
app.get('/api/admin/stats',auth,async(_req,res)=>{try{const r=await query(`SELECT (SELECT COUNT(*) FROM urls) AS discovered,(SELECT COUNT(*) FROM urls WHERE status='queued') AS queued,(SELECT COUNT(*) FROM urls WHERE status='indexed') AS indexed,(SELECT COUNT(*) FROM urls WHERE status='blocked') AS blocked,(SELECT COUNT(*) FROM urls WHERE status='error') AS errors,(SELECT COUNT(*) FROM documents) AS documents,(SELECT COUNT(*) FROM documents WHERE embedding IS NOT NULL) AS embedded`);const recent=await query('SELECT outcome,COUNT(*)::int AS count FROM crawl_events WHERE created_at>NOW()-INTERVAL \'24 hours\' GROUP BY outcome');res.json({counts:r.rows[0],last24Hours:recent.rows});}catch(e){res.status(500).json({error:'stats_failed'});}});
app.post('/api/admin/evaluate',auth,async(req,res)=>{try{const cases=Array.isArray(req.body.cases)?req.body.cases:[];if(!cases.length||cases.length>100)return res.status(400).json({error:'cases must contain 1 to 100 items'});res.json(await evaluateQuerySet(cases,search,10));}catch(e){res.status(500).json({error:'evaluation_failed'});}});
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 32)) { console.error('ADMIN_TOKEN must be at least 32 characters in production'); process.exit(1); }
const port=Number(process.env.PORT||10000);
migrate().then(()=>app.listen(port,'0.0.0.0',()=>console.log(`shanjitong search API listening on ${port}`))).catch(e=>{console.error('startup migration failed',e);process.exit(1);});
