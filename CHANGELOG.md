# Changelog

## v0.2.3: 2026-09-28
- LinkedIn's newer job page layout: the badge now attaches to the visible job title (it could end up in the corner), and the location is read from the "City, State, Country · 4 days ago" line. Estimates are more accurate because the prompt now includes the city.
- Title and location detection no longer depend only on LinkedIn's CSS class names.

## v0.2.2: 2026-09-28
- When Gemini is overloaded (HTTP 503 "high demand"), Salary Lens now retries automatically, then switches to a backup model (Flash-Lite, then newer Flash) instead of failing.
- "Save and test" during an overload now says the key was accepted rather than showing an error.

## v0.2.1: 2026-09-28
- Fix: valid Gemini API keys in newer formats (containing characters like `.`) were rejected as "doesn't look like a Gemini API key". The check now only blocks spaces, line breaks and control characters.

## v0.2.0: 2026-09-28
Security hardening. See [SECURITY.md](SECURITY.md) for the full review.
- Job pages can no longer read the API key: storage is locked to the extension, and content scripts only learn whether a key exists.
- Spending guard: at most 6 lookups a minute and 30 an hour, plus a daily limit you can set (default 100). Automatic lookups wait until a job has been on screen for 1.5 s in a visible tab.
- Background messages are checked by sender and type.
- Model output is sanitized: no links, no key or login prompts, https-only source links, sanity-checked amounts.
- The badge and card use closed Shadow DOM and ignore clicks faked by the page.
- Scanning a non-job page no longer sends anything until you press the button.
- New settings: daily lookup limit, key-safety tips.

## v0.1.0: 2026-09-28
First version.
- Salary badge next to the job title on LinkedIn, Naukri, Indeed, and foundit, plus a toolbar scan for any page with schema.org job data.
- Listed salaries shown directly; otherwise a Gemini estimate with Google Search sources, falling back to an AI-only estimate for free-tier keys.
- 7-day cache, per-year or per-month amounts, first-run settings page.
