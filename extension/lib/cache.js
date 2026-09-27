// Caches estimates per job so reopening a posting costs no API call.
const PREFIX = 'cache:';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

export function cacheKey(job) {
  return PREFIX + [job.title, job.company, job.location].map((s) => String(s || '').trim().toLowerCase()).join('|');
}

export async function getCached(job) {
  const key = cacheKey(job);
  const got = await chrome.storage.local.get(key);
  const entry = got[key];
  if (!entry || !entry.fetchedAt || Date.now() - entry.fetchedAt > TTL_MS) return null;
  return entry;
}

export async function setCached(job, estimate) {
  await chrome.storage.local.set({ [cacheKey(job)]: estimate });
  await prune();
}

async function prune() {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all).filter(([k]) => k.startsWith(PREFIX));
  const now = Date.now();
  const stale = entries.filter(([, v]) => !v || !v.fetchedAt || now - v.fetchedAt > TTL_MS).map(([k]) => k);
  const fresh = entries.filter(([k]) => !stale.includes(k)).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
  const overflow = fresh.slice(MAX_ENTRIES).map(([k]) => k);
  const remove = stale.concat(overflow);
  if (remove.length) await chrome.storage.local.remove(remove);
}

export async function countCached() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith(PREFIX)).length;
}

export async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}
