# Contributing

Thanks for helping. The most useful contributions are usually:

- **Fixing a site that stopped working.** Job sites change their markup often. Selectors live in `extension/content/extract.js`, one function per site.
- **Adding a job site.** Add a function next to `linkedin()` and `naukri()`, register the domain in `siteOf()`, and add the domain to `content_scripts.matches` in `extension/manifest.json`. Many sites already embed schema.org `JobPosting` data. If yours does, the toolbar button may already work without any new code.

## Setup

No build step and no dependencies; you only need Chrome and Node 20+ for tests.

1. Clone the repo and load the `extension` folder with **Load unpacked** in `chrome://extensions`.
2. After editing, click the reload icon on the extension card, then reload the job page.
3. Run `npm test` and `npm run check` before opening a pull request.

## Ground rules

- **Never commit an API key**, even a revoked one. Tests use obviously fake keys and a fake `fetch`.
- **Keep the key out of content scripts.** Anything under `extension/content/` runs inside a job website and must be treated as untrusted. It asks the background worker for results and only ever learns whether a key exists.
- **Build UI with `textContent`, never `innerHTML` with dynamic data.** Links must go through the existing `https`-only checks.
- **Every new background message type** needs an entry in the `ALLOWED` table in `extension/background.js`. Give content scripts the smallest set possible.
- **No remote code, no analytics, no new network hosts.** The extension only talks to `generativelanguage.googleapis.com`.

Read [SECURITY.md](SECURITY.md) before changing messaging, storage, or anything shown in the card.
