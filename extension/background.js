// Background service worker: runs Gemini lookups for the page, caches them, and handles the
// toolbar button (scans the current tab, even on sites the extension doesn't run on by default).
//
// Security model:
// - The API key lives only in chrome.storage.local, locked to trusted extension contexts, and is
//   only ever read here and on the settings page. Content scripts (which run inside job sites)
//   can't read it, and never receive it.
// - Every message is checked: who sent it, and whether that kind of sender may make that request.
// - Lookups are rate-limited so a hostile page can't burn the user's quota or money.
import { estimateSalary, testKey, GeminiError } from './lib/gemini.js';
import { getSettings, saveSettings, publicSettings, PUBLIC_KEYS } from './lib/settings.js';
import { getCached, setCached, clearCache, countCached, cacheKey } from './lib/cache.js';
import { takeToken } from './lib/ratelimit.js';
import { senderKind, isPlausibleApiKey } from './lib/security.js';

const CONTENT_FILES = ['content/format.js', 'content/extract.js', 'content/ui.js', 'content/main.js'];
const SEARCH_RETRY_MS = 24 * 60 * 60 * 1000;
const EXT_ORIGIN = chrome.runtime.getURL('');

// Content scripts get access to chrome.storage.local by default. Take it away: they must go
// through the messages below, which never include the key. Runs on every worker start.
function lockStorage() {
  if (chrome.storage.local.setAccessLevel) {
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
  }
}
lockStorage();
chrome.runtime.onStartup.addListener(lockStorage);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  lockStorage();
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?welcome=1') });
  }
});

// Which requests each kind of sender may make.
const ALLOWED = {
  'content-script': new Set(['SL_ESTIMATE', 'SL_GET_SETTINGS', 'SL_OPEN_OPTIONS']),
  'extension-page': new Set(['SL_ESTIMATE', 'SL_GET_SETTINGS', 'SL_OPEN_OPTIONS', 'SL_TEST', 'SL_CACHE_COUNT', 'SL_CLEAR_CACHE']),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const kind = senderKind(sender, chrome.runtime.id, EXT_ORIGIN);
  const type = msg && typeof msg.type === 'string' ? msg.type : '';
  if (!ALLOWED[kind] || !ALLOWED[kind].has(type)) {
    sendResponse({ ok: false, error: { code: 'FORBIDDEN', message: 'Request not allowed.' } });
    return false;
  }
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: toError(e) }));
  return true; // keep the channel open for the async answer
});

// Pages never talk to us directly (no externally_connectable), but refuse loudly if anything tries.
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((_m, _s, sendResponse) => sendResponse({ ok: false }));
}

function toError(e) {
  if (e instanceof GeminiError) return { code: e.code, message: e.message };
  // Unexpected errors: don't forward internals to the page.
  return { code: 'UNKNOWN', message: 'Something went wrong. Try again.' };
}

/** Only the fields the lookup needs, as short plain strings; nothing else from the page is sent to Gemini. */
function jobFields(job) {
  const pick = (s) => (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120);
  job = job && typeof job === 'object' ? job : {};
  return {
    title: pick(job.title),
    company: pick(job.company),
    location: pick(job.location),
    experience: pick(job.experience),
    listedText: pick(job.listedText),
  };
}

// Identical lookups in flight (two tabs on the same job) share one API call.
const inFlight = new Map();

async function lookup(job, force) {
  const s = await getSettings();
  if (!s.apiKey) return { ok: false, error: { code: 'NO_KEY', message: 'Add your Gemini API key to see an estimate.' } };
  if (!force) {
    const hit = await getCached(job);
    if (hit) return { ok: true, estimate: hit, cached: true };
  }
  const key = cacheKey(job);
  if (inFlight.has(key)) return inFlight.get(key);

  const p = (async () => {
    const limit = await takeToken({ daily: Math.max(1, Math.min(10000, Number(s.dailyLimit) || 100)) });
    if (!limit.ok) {
      const mins = Math.ceil(limit.retryInMs / 60000);
      return {
        ok: false,
        error: { code: 'RATE_LIMIT', message: limit.reason + ' Salary Lens paused lookups to protect your API quota. Try again in ' + mins + ' min.' },
      };
    }
    const allowSearch = s.useSearch && !(s.searchBlockedUntil > Date.now());
    const estimate = await estimateSalary({
      apiKey: s.apiKey,
      model: s.model,
      job,
      allowSearch,
      onSearchUnavailable: () => saveSettings({ searchBlockedUntil: Date.now() + SEARCH_RETRY_MS }),
    });
    if (estimate.grounded && s.searchBlockedUntil) await saveSettings({ searchBlockedUntil: 0 });
    await setCached(job, estimate);
    return { ok: true, estimate };
  })();
  inFlight.set(key, p);
  try {
    return await p;
  } finally {
    inFlight.delete(key);
  }
}

async function handle(msg) {
  switch (msg.type) {
    case 'SL_ESTIMATE': {
      const job = jobFields(msg.job);
      if (!job.title.trim()) return { ok: false, error: { code: 'NO_JOB', message: 'No job title found on this page.' } };
      return lookup(job, msg.force === true);
    }
    case 'SL_GET_SETTINGS':
      return { ok: true, settings: publicSettings(await getSettings()) };
    case 'SL_TEST': {
      const s = await getSettings();
      const apiKey = typeof msg.apiKey === 'string' ? msg.apiKey.trim() : s.apiKey;
      if (!isPlausibleApiKey(apiKey)) return { ok: false, search: false, message: "That doesn't look like a Gemini API key. Copy it again from Google AI Studio." };
      const model = typeof msg.model === 'string' && /^[a-z0-9.-]{3,60}$/i.test(msg.model) ? msg.model : s.model;
      const result = await testKey({ apiKey, model });
      // A successful search check clears any earlier "search unavailable" note.
      // search === null means "couldn't tell" (Gemini busy): leave the previous state alone.
      if (result.ok && result.search !== null) await saveSettings({ searchBlockedUntil: result.search ? 0 : Date.now() + SEARCH_RETRY_MS });
      return result;
    }
    case 'SL_OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'SL_CACHE_COUNT':
      return { ok: true, count: await countCached() };
    case 'SL_CLEAR_CACHE':
      return { ok: true, removed: await clearCache() };
    default:
      return { ok: false, error: { code: 'UNKNOWN', message: 'Unknown request.' } };
  }
}

// Content scripts can no longer watch storage, so tell open tabs when a public setting changes
// (for example, the user just added a key). The message carries no secrets.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !PUBLIC_KEYS.some((k) => k in changes)) return;
  const settings = publicSettings(await getSettings());
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.id != null) chrome.tabs.sendMessage(t.id, { type: 'SL_SETTINGS', settings }).catch(() => {});
  }
});

// Toolbar button: open the card on the current tab. On sites without the content script,
// inject it first (allowed by the activeTab permission, only for the tab the user clicked on).
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'SL_OPEN' });
    return;
  } catch (e) {
    // No content script in this tab yet.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    await chrome.tabs.sendMessage(tab.id, { type: 'SL_OPEN' });
  } catch (e) {
    // Chrome's own pages (chrome://, the Web Store) can't be scripted. Show a hint on the icon.
    chrome.action.setBadgeBackgroundColor({ color: '#6A6D74', tabId: tab.id });
    chrome.action.setBadgeText({ text: '–', tabId: tab.id });
    chrome.action.setTitle({ title: "Salary Lens can't run on this page", tabId: tab.id });
  }
});
