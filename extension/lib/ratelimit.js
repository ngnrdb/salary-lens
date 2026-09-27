// Spending guard. Every lookup uses the user's own API key (and possibly their money), so a
// hostile or glitchy page must not be able to trigger lookups in a loop.
// Timestamps live in chrome.storage.local, which background.js locks to trusted extension
// contexts (content scripts can't read or reset it), so limits survive browser restarts.

export const DEFAULT_LIMITS = {
  burst: 6, // lookups
  burstWindowMs: 60 * 1000, // per minute
  hourly: 30,
  daily: 100, // user-configurable in settings
};

/**
 * Pure check. `stamps` = times of past lookups (ms). Returns { ok, retryInMs, reason }.
 */
export function checkLimit(stamps, now, limits) {
  const L = Object.assign({}, DEFAULT_LIMITS, limits || {});
  const within = (ms) => stamps.filter((t) => now - t < ms);
  const windows = [
    { list: within(L.burstWindowMs), max: L.burst, ms: L.burstWindowMs, reason: 'Too many lookups in the last minute.' },
    { list: within(60 * 60 * 1000), max: L.hourly, ms: 60 * 60 * 1000, reason: 'Hourly lookup limit reached.' },
    { list: within(24 * 60 * 60 * 1000), max: L.daily, ms: 24 * 60 * 60 * 1000, reason: 'Daily lookup limit reached (change it in settings).' },
  ];
  for (const w of windows) {
    if (w.max > 0 && w.list.length >= w.max) {
      const oldest = Math.min(...w.list);
      return { ok: false, retryInMs: Math.max(1000, oldest + w.ms - now), reason: w.reason };
    }
  }
  return { ok: true, retryInMs: 0, reason: '' };
}

const KEY = 'lookupStamps';

export async function takeToken(limits) {
  const now = Date.now();
  const got = await chrome.storage.local.get(KEY);
  const stamps = (got[KEY] || []).filter((t) => typeof t === 'number' && now - t < 24 * 60 * 60 * 1000);
  const verdict = checkLimit(stamps, now, limits);
  if (verdict.ok) {
    stamps.push(now);
    await chrome.storage.local.set({ [KEY]: stamps });
  }
  return verdict;
}
