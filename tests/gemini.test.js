import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEstimate, estimateSalary, testKey, mergeSources, mapApiError, buildPrompt } from '../extension/lib/gemini.js';

const JOB = { title: 'Senior Data Analyst', company: 'Northwind', location: 'Bengaluru', experience: '4-7 yrs', listedText: '' };

function reply(text, grounding) {
  return {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: 'STOP',
        groundingMetadata: grounding ? { groundingChunks: grounding.map(([title, uri]) => ({ web: { title, uri } })) } : undefined,
      },
    ],
  };
}

/** Fake fetch that returns queued responses and records requests. */
function fakeFetch(queue) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = queue.shift();
    return { ok: next.status === 200, status: next.status, json: async () => next.body };
  };
  fn.calls = calls;
  return fn;
}

const ANSWER = JSON.stringify({
  min: 1800000,
  max: 2600000,
  median: 2150000,
  currency: 'INR',
  confidence: 'medium',
  basis: 'company',
  note: 'Based on reported salaries for data analysts at Northwind.',
  sources: [
    { name: 'AmbitionBox', min: 1700000, max: 2400000 },
    { name: 'Glassdoor', min: 1900000, max: 2700000 },
    { name: 'MadeUpSite', min: 1, max: 2 },
  ],
});

test('parseEstimate tolerates code fences and swaps min/max', () => {
  const e = parseEstimate('```json\n{"min": "26,00,000", "max": 1800000, "currency": "inr", "confidence": "HIGH"}\n```');
  assert.equal(e.min, 1800000);
  assert.equal(e.max, 2600000);
  assert.equal(e.currency, 'INR');
  assert.equal(e.confidence, 'high');
});

test('parseEstimate rejects answers without numbers', () => {
  assert.throws(() => parseEstimate('Sorry, I cannot help.'), { code: 'BAD_RESPONSE' });
  assert.throws(() => parseEstimate('{"min": null, "max": null}'), { code: 'BAD_RESPONSE' });
});

test('grounded estimate links sources and drops unlinked ones', async () => {
  const f = fakeFetch([
    { status: 200, body: reply(ANSWER, [['ambitionbox.com', 'https://g/1'], ['glassdoor.co.in', 'https://g/2'], ['levels.fyi', 'https://g/3']]) },
  ]);
  const est = await estimateSalary({ apiKey: 'k', model: 'm', job: JOB, allowSearch: true, fetchImpl: f });
  assert.equal(est.grounded, true);
  assert.deepEqual(
    est.sources.map((s) => [s.name, s.url, s.min]),
    [
      ['AmbitionBox', 'https://g/1', 1700000],
      ['Glassdoor', 'https://g/2', 1900000],
      ['levels.fyi', 'https://g/3', null],
    ]
  );
  assert.deepEqual(f.calls[0].body.tools, [{ google_search: {} }]);
  assert.equal(f.calls[0].headers['x-goog-api-key'], 'k');
  assert.match(f.calls[0].url, /models\/m:generateContent$/);
});

test('falls back to AI-only estimate when search grounding is refused', async () => {
  let flagged = false;
  const f = fakeFetch([
    { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests with google_search grounding' } } },
    { status: 200, body: reply(ANSWER) },
  ]);
  const est = await estimateSalary({
    apiKey: 'k',
    model: 'm',
    job: JOB,
    allowSearch: true,
    fetchImpl: f,
    onSearchUnavailable: () => (flagged = true),
  });
  assert.equal(flagged, true);
  assert.equal(est.grounded, false);
  assert.deepEqual(est.sources, []);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].body.tools, undefined);
  assert.equal(f.calls[1].body.generationConfig.responseMimeType, 'application/json');
});

test('plain quota error is reported, not retried', async () => {
  const f = fakeFetch([{ status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota).' } } }]);
  await assert.rejects(estimateSalary({ apiKey: 'k', model: 'm', job: JOB, allowSearch: true, fetchImpl: f }), { code: 'QUOTA' });
  assert.equal(f.calls.length, 1);
});

test('invalid key and missing model map to clear errors', () => {
  assert.equal(mapApiError(400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }, true).code, 'INVALID_KEY');
  assert.equal(mapApiError(404, { error: { message: 'models/foo is not found for API version v1beta' } }, false).code, 'MODEL');
});

test('testKey reports a free key without search', async () => {
  const f = fakeFetch([
    { status: 200, body: reply('OK') },
    { status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'Search grounding is not available on the free tier.' } } },
  ]);
  const r = await testKey({ apiKey: 'k', model: 'm', fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.search, false);
});

test('mergeSources matches names loosely', () => {
  const out = mergeSources([{ name: 'Levels.fyi', min: 1, max: 2 }], [{ title: 'levels.fyi', url: 'u' }]);
  assert.equal(out[0].url, 'u');
});

test('prompt keeps page text short', () => {
  const p = buildPrompt({ title: 'x'.repeat(500), company: 'A\nB' }, true);
  assert.ok(!p.includes('x'.repeat(121)));
  assert.ok(p.includes('Company: A B'));
  assert.ok(p.includes('Experience required: not stated'));
});

// --- Overloaded models (HTTP 503) -------------------------------------------------------
import { _setSleepForTests, callGemini, BACKUP_MODELS } from '../extension/lib/gemini.js';
_setSleepForTests(async () => {});

const BUSY = { status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.' } } };

test('503 is retried on the same model, then succeeds', async () => {
  const f = fakeFetch([BUSY, { status: 200, body: reply('OK') }]);
  const resp = await callGemini({ apiKey: 'k', model: 'gemini-3.5-flash', prompt: 'x', fetchImpl: f });
  assert.equal(resp._model, 'gemini-3.5-flash');
  assert.equal(f.calls.length, 2);
});

test('persistent 503 moves on to a backup model', async () => {
  const f = fakeFetch([BUSY, BUSY, BUSY, { status: 200, body: reply(ANSWER) }]);
  const est = await estimateSalary({ apiKey: 'k', model: 'gemini-3.5-flash', job: JOB, allowSearch: false, fetchImpl: f });
  assert.equal(est.model, BACKUP_MODELS[0]);
  assert.match(f.calls[3].url, new RegExp(BACKUP_MODELS[0] + ':generateContent$'));
});

test('everything busy gives a clear BUSY error', async () => {
  const f = fakeFetch(Array.from({ length: 10 }, () => BUSY));
  await assert.rejects(callGemini({ apiKey: 'k', model: 'gemini-3.5-flash', prompt: 'x', fetchImpl: f }), { code: 'BUSY' });
});

test('bad key is not retried', async () => {
  const f = fakeFetch([{ status: 400, body: { error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } } }]);
  await assert.rejects(callGemini({ apiKey: 'k', model: 'm', prompt: 'x', fetchImpl: f }), { code: 'INVALID_KEY' });
  assert.equal(f.calls.length, 1);
});

test('key test during an overload says the key was accepted', async () => {
  const f = fakeFetch(Array.from({ length: 10 }, () => BUSY));
  const r = await testKey({ apiKey: 'k', model: 'gemini-3.5-flash', fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.search, null);
  assert.match(r.message, /accepted/);
});
