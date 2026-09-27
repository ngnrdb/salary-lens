// User settings, kept in chrome.storage.local. background.js restricts chrome.storage.local
// to trusted extension contexts, so job pages (content scripts) can never read the API key;
// they only get the non-secret fields from publicSettings() via a message.
import { DEFAULT_MODEL } from './gemini.js';

export const DEFAULTS = {
  apiKey: '',
  model: DEFAULT_MODEL,
  autoFetch: true,
  useSearch: true,
  unit: 'year', // 'year' | 'month'
  dailyLimit: 100, // max Gemini lookups per 24 hours
  searchBlockedUntil: 0,
};

/** Settings keys a content script is allowed to know about (no secrets). */
export const PUBLIC_KEYS = ['apiKey', 'autoFetch', 'unit'];

export async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return Object.assign({}, DEFAULTS, s);
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

/** What a job page may see: whether a key exists, never the key itself. */
export function publicSettings(s) {
  return { hasKey: !!s.apiKey, autoFetch: !!s.autoFetch, unit: s.unit === 'month' ? 'month' : 'year' };
}
