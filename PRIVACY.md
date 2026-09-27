# Salary Lens — Privacy Policy

_Last updated: 28 September 2026_

Salary Lens is an open-source Chrome extension that shows the expected salary for job postings you open. Its full source code is public, so you can check everything below yourself.

## What the extension reads
When you open a job posting on a supported site (LinkedIn, Naukri, Indeed, foundit), or click the Salary Lens toolbar button on any other page, the extension reads the job's title, company, location, required experience and any salary listed on that page. It does not read anything else on the page, and it does not read pages you haven't opened.

## What is sent, and to whom
To estimate a salary, Salary Lens sends the job title, company, location, required experience and any listed salary to **Google's Gemini API**, using the API key **you** provide. That request is covered by [Google's Gemini API terms](https://ai.google.dev/gemini-api/terms) and [Google's Privacy Policy](https://policies.google.com/privacy).

Nothing is sent to the developer of Salary Lens or to any other party. The extension has no server, no analytics, no tracking and no ads.

## What is stored
The following is stored only in your browser (`chrome.storage.local`) and never synced or uploaded:
- your Gemini API key,
- your settings,
- salary estimates for jobs you've looked up, kept for up to 7 days so repeat views don't use your quota,
- the times of your recent lookups (no job details), used only to enforce your spending limit.

Job websites can't read any of this: the extension locks its storage so that only its own settings page and background worker can access it.

You can remove your key and clear saved lookups at any time from the extension's settings page. Uninstalling the extension deletes all of it.

## Contact
Questions about this policy: open an issue in this project's GitHub repository.
