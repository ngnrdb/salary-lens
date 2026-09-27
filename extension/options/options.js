import { DEFAULTS, getSettings, saveSettings } from '../lib/settings.js';
import { SUGGESTED_MODELS, DEFAULT_MODEL } from '../lib/gemini.js';
import { isPlausibleApiKey } from '../lib/security.js';

const $ = (id) => document.getElementById(id);

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

async function refreshCacheCount() {
  const res = await chrome.runtime.sendMessage({ type: 'SL_CACHE_COUNT' });
  const n = (res && res.count) || 0;
  setStatus($('cacheStatus'), n === 1 ? '1 saved lookup' : n + ' saved lookups');
}

async function init() {
  if (new URLSearchParams(location.search).has('welcome')) $('welcome').hidden = false;

  for (const m of SUGGESTED_MODELS) {
    const o = document.createElement('option');
    o.value = m;
    $('models').appendChild(o);
  }

  const s = await getSettings();
  $('apiKey').value = s.apiKey;
  $('autoFetch').checked = s.autoFetch;
  $('useSearch').checked = s.useSearch;
  $('model').value = s.model || DEFAULT_MODEL;
  $('dailyLimit').value = s.dailyLimit;
  (s.unit === 'month' ? $('unitMonth') : $('unitYear')).checked = true;
  if (s.apiKey) setStatus($('keyStatus'), 'A key is saved.');
  refreshCacheCount();

  $('toggleKey').addEventListener('click', () => {
    const show = $('apiKey').type === 'password';
    $('apiKey').type = show ? 'text' : 'password';
    $('toggleKey').textContent = show ? 'Hide' : 'Show';
    $('toggleKey').setAttribute('aria-pressed', String(show));
  });

  $('saveKey').addEventListener('click', async () => {
    const key = $('apiKey').value.trim();
    if (!key) {
      setStatus($('keyStatus'), 'Paste a key first.', 'bad');
      return;
    }
    if (!isPlausibleApiKey(key)) {
      setStatus($('keyStatus'), "That doesn't look like a Gemini API key. Copy it again from Google AI Studio.", 'bad');
      return;
    }
    $('saveKey').disabled = true;
    await saveSettings({ apiKey: key, searchBlockedUntil: 0 });
    setStatus($('keyStatus'), 'Saved. Testing the key…');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SL_TEST', apiKey: key, model: $('model').value.trim() || DEFAULT_MODEL });
      setStatus($('keyStatus'), res.message, res.ok ? 'ok' : 'bad');
    } catch (e) {
      setStatus($('keyStatus'), 'Saved, but the test could not run: ' + e.message, 'bad');
    } finally {
      $('saveKey').disabled = false;
    }
  });

  $('removeKey').addEventListener('click', async () => {
    $('apiKey').value = '';
    await saveSettings({ apiKey: '' });
    setStatus($('keyStatus'), 'Key removed.');
  });

  $('autoFetch').addEventListener('change', (e) => saveSettings({ autoFetch: e.target.checked }));
  $('useSearch').addEventListener('change', (e) => saveSettings({ useSearch: e.target.checked, searchBlockedUntil: 0 }));
  for (const r of document.querySelectorAll('input[name="unit"]')) {
    r.addEventListener('change', (e) => e.target.checked && saveSettings({ unit: e.target.value }));
  }
  $('model').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    // Model ids are short lowercase names; anything else would end up in the request URL.
    if (/^[a-z0-9.-]{3,60}$/i.test(v)) saveSettings({ model: v });
    else e.target.value = DEFAULTS.model, saveSettings({ model: DEFAULTS.model });
  });
  $('dailyLimit').addEventListener('change', (e) => {
    const n = Math.round(Number(e.target.value));
    const v = Number.isFinite(n) ? Math.max(1, Math.min(10000, n)) : DEFAULTS.dailyLimit;
    e.target.value = v;
    saveSettings({ dailyLimit: v });
  });

  $('clearCache').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'SL_CLEAR_CACHE' });
    setStatus($('cacheStatus'), 'Cleared ' + ((res && res.removed) || 0) + ' saved lookups.', 'ok');
  });
}

init();
