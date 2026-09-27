# Security

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private reporting instead: go to this repository's **Security** tab and choose **Report a vulnerability**. Include steps to reproduce, and never include a real API key.

Expect an initial reply within a week. Fixes go out as a new release, with credit if you'd like it.

## Security review

Last reviewed 28 September 2026 (v0.2.0). The threat model assumes three kinds of attacker:
- **a hostile job page**, for example a fake LinkedIn-lookalike, a compromised career site, or any page the user scans with the toolbar button;
- **a malicious job posting** on a real site, where the attacker controls the title and description text;
- **a compromised page renderer**, where page code manages to run inside the extension's content script.

## Findings and fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **High** | The content script loaded the user's API key into every job page (`chrome.storage.local.get` with `apiKey`). A bug or renderer compromise on any job site could read it. By default, content scripts can also read all of `chrome.storage.local`. | The content script never sees the key; it only learns "is there a key?". `chrome.storage.local` is locked to trusted extension contexts with `setAccessLevel`. Verified: storage reads from the content script now fail with "Access to storage is not allowed from this context". |
| 2 | **High** | **Denial of wallet.** A page that keeps changing the job title (or a user rapidly flicking through jobs) triggered one paid Gemini call per change, with no upper bound. | The job must stay on screen for 1.5 s in a visible tab before an automatic lookup. A persistent spending guard caps lookups at 6 per minute, 30 per hour, and a user-set daily limit (default 100). Identical in-flight lookups are merged. Verified: a page changing its title every 0.4 s caused 0 calls, and one changing it every 2.5 s for a minute was capped at 6. |
| 3 | Medium | Any part of the extension, including content scripts, could make any background request (key test, clear cache…). | Every message is checked for sender and type. Content scripts may only request an estimate, read public settings, or open settings. Anything else returns `FORBIDDEN`. |
| 4 | Medium | **Prompt-injection phishing.** A job title or description could steer Gemini into writing "your key expired, re-enter it at evil.example" in the card's note, or naming a source `javascript:…`. | Model text is shown as plain text, stripped of links, and dropped entirely if it mentions keys, passwords, logins, or verification. Source names are plain labels. Links must be `https:` and come only from Google's grounding results, never from the model's text. Absurd amounts (over 10¹¹) are rejected. |
| 5 | Medium | Page scripts could read the badge and card (open Shadow DOM), and fake clicks on them to trigger lookups. | Shadow roots are `closed`, and every handler ignores synthetic (`isTrusted === false`) events. Verified: `shadowRoot` returns `null` to the page, and `element.click()` from page script does nothing. |
| 6 | Low | Page-controlled text (job title, company) was echoed in full inside our card, lending it credibility. | Labels in the card are shortened and have links removed. |
| 7 | Low | The toolbar scan on a non-job page would send that page's `<h1>` to Gemini automatically. | When a page is only a guess (no job data found), nothing is sent until the user presses "Get salary estimate". |
| 8 | Low | Performance DoS: huge pages or megabytes of JSON-LD were re-parsed every second. | Text is capped before regex work, JSON-LD is size-limited, and parsing is skipped when unchanged. |
| 9 | Low | Arbitrary strings could be saved as the key or model id. The model id ends up in the request URL. | The key must be 20–300 printable ASCII characters with no spaces or line breaks (any Google key format passes; header injection does not). The model id must match `[a-z0-9.-]`. |
| 10 | Info | No explicit extension CSP. | An explicit CSP is set: `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Minimum Chrome version is 114. |

## Already safe (checked, no change needed)
- **The key never goes in a URL.** It is sent only in the `x-goog-api-key` header, and only to `generativelanguage.googleapis.com`, the extension's only host permission.
- **Pages can't message the extension.** There's no `externally_connectable`, and `chrome.runtime` is not exposed to page scripts (verified).
- **No `web_accessible_resources`.** Sites can't load, frame, or fingerprint the settings page.
- **No remote code, no third-party libraries, no analytics.** There is no supply chain to compromise.
- **All UI is built with `textContent`.** The only `innerHTML` is static icon markup bundled with the extension.
- **Outbound links use `rel="noopener noreferrer"`,** so source sites don't learn which job page you came from.
- **The Gemini request carries only the job title, company, location, experience, and listed salary.** It contains nothing about the user.

## Residual risks (can't be fixed inside the extension)
- **The key is stored unencrypted in the Chrome profile on disk.** Malware on the computer, or someone with access to the unlocked profile, could read it. Encrypting it would need a passphrase on every use. Mitigation: the settings page tells users to restrict the key to the Generative Language API and to set a billing budget alert.
- **A page can draw a fake "Salary Lens" box asking for the key.** The extension can't stop a page from drawing lookalike UI. Mitigation: the real extension never asks for the key on a website, and the settings page says so.
- **A page can detect that the extension is installed** by spotting the badge element. It can't read its contents.
- **Prompt injection can still bias the estimate** itself (for example, inflating the number). The values are sanity-checked, but an estimate is only as trustworthy as its sources, which are shown.
