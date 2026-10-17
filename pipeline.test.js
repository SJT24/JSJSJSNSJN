import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, cleanHtml, expandSearchText } from '../src/clean.js';
import { extractLinks } from '../src/discovery.js';
import { detectLanguage, scoreSpam, scoreQuality } from '../src/quality.js';
import { reciprocalRankFusion, rankCandidates } from '../src/search.js';
import { reciprocalRank, recallAtK, ndcgAtK } from '../src/evaluate.js';
test('normalizes URL and removes tracking params',()=>assert.equal(normalizeUrl('https://Example.com/a?utm_source=x&ok=1#part'),'https://example.com/a?ok=1'));
test('extracts only HTTP(S) links',()=>assert.deepEqual(extractLinks('<a href="/x">x</a><a href="javascript:alert(1)">bad</a>','https://example.com/'),['https://example.com/x']));
test('cleans page and hashes content',()=>{const d=cleanHtml('<html><head><title>Useful page</title><meta name="description" content="A useful description"></head><body><nav>menu</nav><main><h1>Useful page</h1><p>'+('Search engines discover and index web pages. '.repeat(20))+'</p></main><script>alert(1)</script></body></html>','https://example.com');assert.equal(d.title,'Useful page');assert.ok(!d.body.includes('alert'));assert.equal(d.contentHash.length,64);});
test('detects languages and bounds spam score',()=>{assert.equal(detectLanguage('搜索网页'), 'zh');assert.equal(detectLanguage('Search engine'),'en');assert.ok(scoreSpam({title:'x',body:'short'})<=1);assert.ok(scoreQuality({body:'long '.repeat(100),title:'Useful title'})>=0);});
test('RRF combines ranking lists',()=>{const s=reciprocalRankFusion([[{id:'a'},{id:'b'}],[{id:'b'},{id:'a'}]]);assert.ok(s.get('a')>0);assert.ok(s.get('b')>0);});
test('ranking prioritizes exact title match',()=>{const r=rankCandidates('climate change',[{id:'1',title:'Climate change guide',body:'',quality:.8,spam_score:0,lexical_score:.2},{id:'2',title:'Other topic',body:'climate change',quality:.8,spam_score:0,lexical_score:.2}]);assert.equal(r[0].id,'1');});
test('evaluation metrics',()=>{assert.equal(reciprocalRank(['b'],['a','b']),.5);assert.equal(recallAtK(['a','b'],['a'],1),.5);assert.ok(ndcgAtK(['a'],['a'])===1);});

test('expands Chinese query text into overlapping bigrams',()=>{const s=expandSearchText('善鸡通搜索引擎');assert.ok(s.includes('善鸡'));assert.ok(s.includes('搜索'));assert.ok(s.includes('引擎'));});
