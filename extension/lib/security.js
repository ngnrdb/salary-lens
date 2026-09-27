// Small security helpers used by the background worker and the Gemini client.

/** Only plain https links may be shown to the user. */
export function safeHttpsUrl(u) {
  try {
    const url = new URL(String(u));
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch (e) {
    return null;
  }
}

const URLISH = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|net|org|io|co|app|xyz|ly|me|info|biz|link|site|online|top|ru|cn)\b(?:\/\S*)?/gi;

/**
 * Text that came from the model (or indirectly from a job page via the model) is shown in the
 * card as plain text. Strip links, control characters and anything that looks like an
 * instruction to the user about their key, so a poisoned job posting can't turn our card into
 * a phishing prompt ("your key expired, re-enter it at ...").
 */
export function safeModelText(s, max) {
  let t = String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(URLISH, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/api[\s-]?key|password|log\s?in|sign\s?in|verify|re-?enter|credential|token|otp/i.test(t)) return '';
  return t.slice(0, max || 200);
}

/**
 * Site names shown as source link text ("AmbitionBox", "levels.fyi"). The link itself always
 * points at the Google Search result, so a domain-looking name is fine; it just can't carry
 * a scheme, path, instructions or odd characters.
 */
export function safeSourceName(s) {
  const t = String(s == null ? '' : s)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[^\p{L}\p{N} .&'()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/api[\s-]?key|password|log\s?in|sign\s?in|verify|re-?enter|credential|token|otp/i.test(t)) return '';
  return t.slice(0, 40);
}

/**
 * Loose sanity check for a pasted API key. Google has used more than one key format (classic
 * "AIza…" keys, and newer ones that can contain other characters such as "."), so don't
 * whitelist a format. Only reject what could cause harm or is clearly a paste mistake:
 * spaces, line breaks, control or non-ASCII characters (these could break or inject into the
 * request header), and implausible lengths. Google itself decides whether the key is valid.
 */
export function isPlausibleApiKey(k) {
  return typeof k === 'string' && /^[\x21-\x7E]{20,300}$/.test(k);
}

/** Sender check for runtime messages. */
export function senderKind(sender, extensionId, extensionOrigin) {
  if (!sender || sender.id !== extensionId) return 'foreign';
  // Extension pages (settings) have our own origin and no tab, or a tab showing our page.
  if (typeof sender.url === 'string' && sender.url.startsWith(extensionOrigin)) return 'extension-page';
  if (sender.tab) return 'content-script';
  return 'foreign';
}
