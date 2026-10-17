import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, scoreQuality, scoreSpam } from '../src/quality.js';
import { reciprocalRank, recallAtK, ndcgAtK, evaluateQuerySet } from '../src/evaluate.js';

test('offline: language detector handles Chinese, Japanese, Korean and English', () => {
  assert.equal(detectLanguage('搜索网页'), 'zh');
  assert.equal(detectLanguage('東京の検索'), 'ja');
  assert.equal(detectLanguage('검색 엔진'), 'ko');
  assert.equal(detectLanguage('Search engine'), 'en');
});

test('offline: quality and spam scores stay in [0,1]', () => {
  for (const body of ['', 'Useful research information. '.repeat(50), 'casino '.repeat(100)]) {
    const spam = scoreSpam({ title: 'Test page', body });
    const quality = scoreQuality({ title: 'Test page', description: 'Useful page description', body, language: 'en', spamScore: spam });
    assert.ok(spam >= 0 && spam <= 1, `spam=${spam}`);
    assert.ok(quality >= 0 && quality <= 1, `quality=${quality}`);
  }
});

test('offline: evaluation metrics calculate expected values', () => {
  assert.equal(reciprocalRank(['b'], ['a', 'b']), 0.5);
  assert.equal(recallAtK(['a', 'b'], ['a'], 1), 0.5);
  assert.equal(ndcgAtK(['a'], ['a']), 1);
});

test('offline: evaluation runner returns aggregate metrics', async () => {
  const mockSearch = async q => ({ results: [{ url: q === 'one' ? 'https://example.test/a' : 'https://example.test/b' }] });
  const result = await evaluateQuerySet([
    { query: 'one', relevantUrls: ['https://example.test/a'] },
    { query: 'two', relevantUrls: ['https://example.test/b'] },
  ], mockSearch, 10);
  assert.equal(result.count, 2);
  assert.equal(result.meanMRR, 1);
  assert.equal(result.meanRecallAtK, 1);
  assert.equal(result.meanNDCGAtK, 1);
});
