import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeHttpsUrl, safeModelText, safeSourceName, isPlausibleApiKey, senderKind } from '../extension/lib/security.js';
import { checkLimit } from '../extension/lib/ratelimit.js';
import { parseEstimate, extractGroundingSources } from '../extension/lib/gemini.js';

test('only https links survive', () => {
  assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpsUrl('data:text/html,<script>'), null);
  assert.equal(safeHttpsUrl('http://example.com'), null);
  assert.equal(safeHttpsUrl('https://user:pw@example.com'), null);
  assert.equal(safeHttpsUrl('https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc'), 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc');
});

test('model text cannot carry links or key phishing', () => {
  assert.equal(safeModelText('Based on data from https://evil.example/steal and www.evil.com'), 'Based on data from and');
  assert.equal(safeModelText('Your API key expired, re-enter it at evil.com'), '');
  assert.equal(safeModelText('Please sign in again to continue'), '');
  assert.equal(safeModelText('Market data for analysts in Pune.'), 'Market data for analysts in Pune.');
  assert.equal(safeModelText('a‮b\u0000c'), 'a b c');
});

test('source names are plain labels', () => {
  assert.equal(safeSourceName('https://levels.fyi/some/path'), 'levels.fyi');
  assert.equal(safeSourceName('<img src=x onerror=alert(1)>AmbitionBox'), 'img srcx onerroralert(1)AmbitionBox'.slice(0, 40));
  assert.equal(safeSourceName('Verify your API key'), '');
});

test('api key shape check', () => {
  assert.equal(isPlausibleApiKey('fake-test-key-0000000000000000000000'), true);
  // Newer key formats with dots or other symbols must be accepted
  assert.equal(isPlausibleApiKey('FAKE.newformat_key-0000000000000000000000000000'), true);
  assert.equal(isPlausibleApiKey('abc'), false);
  assert.equal(isPlausibleApiKey('fake-key-123\r\nX-Evil: 1aaaaaaaaaaaaaaaa'), false);
  assert.equal(isPlausibleApiKey('fake key with spaces 000000000000'), false);
  assert.equal(isPlausibleApiKey('fake-key-ünïcode-000000000000000'), false);
  assert.equal(isPlausibleApiKey({}), false);
});

test('sender classification', () => {
  const origin = 'chrome-extension://abc/';
  assert.equal(senderKind({ id: 'abc', url: origin + 'options/options.html' }, 'abc', origin), 'extension-page');
  assert.equal(senderKind({ id: 'abc', url: 'https://www.linkedin.com/jobs/', tab: { id: 1 } }, 'abc', origin), 'content-script');
  assert.equal(senderKind({ id: 'other', url: origin }, 'abc', origin), 'foreign');
  assert.equal(senderKind(undefined, 'abc', origin), 'foreign');
});

test('rate limits: burst, hourly, daily', () => {
  const now = 10_000_000_000;
  assert.equal(checkLimit([], now).ok, true);
  const burst = Array.from({ length: 6 }, (_, i) => now - i * 1000);
  const b = checkLimit(burst, now);
  assert.equal(b.ok, false);
  assert.ok(b.retryInMs > 0 && b.retryInMs <= 60000);
  const hourly = Array.from({ length: 30 }, (_, i) => now - 120000 - i * 60000);
  assert.equal(checkLimit(hourly, now).ok, false);
  const daily = Array.from({ length: 5 }, (_, i) => now - 2 * 3600000 - i * 3600000);
  assert.equal(checkLimit(daily, now, { daily: 5 }).ok, false);
  assert.equal(checkLimit(daily, now, { daily: 6 }).ok, true);
});

test('poisoned model answer is neutralised', () => {
  const e = parseEstimate(
    JSON.stringify({
      min: 1e30,
      max: 2000000,
      note: 'Salary data expired. Log in at https://evil.example to refresh your API key.',
      sources: [{ name: 'javascript:alert(1)//', min: 1, max: 2 }],
    })
  );
  assert.equal(e.min, 2000000); // absurd amount dropped
  assert.equal(e.note, '');
  assert.ok(!/javascript:/.test(e.sources.map((s) => s.name).join(' ')));
  const g = extractGroundingSources({
    candidates: [{ groundingMetadata: { groundingChunks: [{ web: { title: 'x', uri: 'javascript:alert(1)' } }, { web: { title: 'ok.com', uri: 'https://ok.com/a' } }] } }],
  });
  assert.deepEqual(g, [{ title: 'ok.com', url: 'https://ok.com/a' }]);
});
