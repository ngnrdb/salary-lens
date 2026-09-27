// Reads job details (title, company, location, experience, listed salary) from the page.
// Classic script (no imports) so it can run as a content script; exposes SL.extract.
//
// Order of attempts:
//   1. A site-specific extractor (LinkedIn, Naukri, Indeed, foundit) using page elements.
//   2. schema.org JobPosting JSON-LD, which many job sites embed. It fills in anything missing
//      and is the main path for "any other site".
//   3. For a manual scan (toolbar click) on an unknown site: the page's <h1> and <title>.
//
// Job sites change their markup often. Each selector list goes from most specific to most
// generic, so when a site redesigns, the generic fallbacks usually still find something.
(function (root) {
  const SL = (root.SL = root.SL || {});

  const MAX_FIELD = 120;

  /** Collapses whitespace and caps length. Slices before regex work so huge pages stay cheap. */
  function clean(s, max) {
    max = max || 300;
    return (s == null ? '' : String(s)).slice(0, max * 4).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function short(s) {
    return clean(s).slice(0, MAX_FIELD);
  }

  function textOf(el, max) {
    return el ? clean(el.textContent, max) : '';
  }

  /** First element matching any selector that has visible text. */
  function first(scope, selectors) {
    for (const sel of selectors) {
      let els;
      try {
        els = scope.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const el of els) if (textOf(el)) return el;
    }
    return null;
  }

  function num(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.]/g, ''));
    return isFinite(n) && n > 0 ? n : null;
  }

  // ---------------------------------------------------------------------------------------
  // Listed salary text found in the page (e.g. "₹ 12-15 Lacs P.A.", "$120K/yr - $150K/yr")
  // ---------------------------------------------------------------------------------------

  const CUR = '(?:₹|\\$|€|£|INR|USD|EUR|GBP|Rs\\.?)';
  const AMT = '\\d[\\d,]*(?:\\.\\d+)?\\s?(?:[kKmM]\\b|L\\b|Lacs?\\b|Lakhs?\\b|LPA\\b|Cr\\b)?';
  const PER = '(?:\\s?\\/\\s?(?:yr|year|mo|month|hr|hour)\\b)?';
  const SALARY_RE = new RegExp(
    CUR + '\\s?' + AMT + PER +
      '(?:\\s?(?:-|–|to)\\s?' + CUR + '?\\s?' + AMT + PER + ')?' +
      '(?:\\s?(?:Lacs?|Lakhs?)?\\s?(?:P\\.?\\s?A\\.?|per annum|a year|per year|an hour|per hour|a month|per month))?',
    'i'
  );

  /** Finds a salary-looking snippet in text, or null. */
  function findSalaryText(text) {
    if (!text) return null;
    const m = clean(text, 4000).match(SALARY_RE);
    if (!m) return null;
    const s = clean(m[0]);
    // Needs at least two digits so "$1" in random copy doesn't count.
    if ((s.match(/\d/g) || []).length < 2) return null;
    return s;
  }

  /** Salary text that says it isn't disclosed. */
  function isUndisclosed(text) {
    return /not\s+disclosed|not\s+specified|undisclosed|competitive|as per industry/i.test(text || '');
  }

  // ---------------------------------------------------------------------------------------
  // schema.org JobPosting (JSON-LD)
  // ---------------------------------------------------------------------------------------

  function findJobPosting(node, depth) {
    depth = depth || 0;
    if (!node || typeof node !== 'object' || depth > 6) return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const f = findJobPosting(n, depth + 1);
        if (f) return f;
      }
      return null;
    }
    const t = node['@type'];
    if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return node;
    if (node['@graph']) return findJobPosting(node['@graph'], depth + 1);
    if (node.mainEntity) return findJobPosting(node.mainEntity, depth + 1);
    return null;
  }

  const PERIODS = { YEAR: 'year', ANNUAL: 'year', MONTH: 'month', WEEK: 'week', DAY: 'day', HOUR: 'hour' };

  function salaryFromLd(bs) {
    if (!bs) return null;
    if (typeof bs === 'string' || typeof bs === 'number') {
      const t = findSalaryText(String(bs));
      return t ? { text: t } : null;
    }
    const b = Array.isArray(bs) ? bs[0] : bs;
    if (!b || typeof b !== 'object') return null;
    const v = b.value && typeof b.value === 'object' ? b.value : { value: b.value };
    const min = num(v.minValue);
    const max = num(v.maxValue);
    const single = num(v.value);
    if (min == null && max == null && single == null) return null;
    const unit = clean(v.unitText || b.unitText).toUpperCase();
    return {
      min: min ?? single ?? max,
      max: max ?? single ?? min,
      currency: clean(b.currency || b.salaryCurrency || v.currency) || null,
      period: PERIODS[unit] || 'year',
    };
  }

  function nameOf(x) {
    if (!x) return '';
    if (typeof x === 'string') return x;
    if (Array.isArray(x)) return nameOf(x[0]);
    return x.name || '';
  }

  function locationFromLd(jp) {
    if (/TELECOMMUTE/i.test(clean(jp.jobLocationType))) return 'Remote';
    const locs = Array.isArray(jp.jobLocation) ? jp.jobLocation : jp.jobLocation ? [jp.jobLocation] : [];
    for (const loc of locs) {
      const a = (loc && loc.address) || loc;
      if (!a) continue;
      if (typeof a === 'string') return clean(a);
      const parts = [a.addressLocality, a.addressRegion, nameOf(a.addressCountry)].map(clean).filter(Boolean);
      // Keep it short: city + country is enough for a salary lookup.
      const uniq = [...new Set(parts)];
      if (uniq.length) return uniq.length > 2 ? uniq[0] + ', ' + uniq[uniq.length - 1] : uniq.join(', ');
    }
    return '';
  }

  function experienceFromLd(jp) {
    const e = jp.experienceRequirements;
    if (!e) return '';
    if (typeof e === 'string') return clean(e);
    const months = num(e.monthsOfExperience);
    if (months) return Math.round(months / 12) + '+ yrs';
    return clean(e.description || '');
  }

  function decodeEntities(s) {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  /** Parses JSON-LD script texts and returns job fields from the first JobPosting, or null. */
  function parseJsonLdTexts(texts) {
    for (const t of texts) {
      let data;
      try {
        data = JSON.parse(t);
      } catch (e) {
        continue;
      }
      const jp = findJobPosting(data);
      if (!jp) continue;
      return {
        title: short(decodeEntities(clean(jp.title || jp.name))),
        company: short(decodeEntities(clean(nameOf(jp.hiringOrganization)))),
        location: short(locationFromLd(jp)),
        experience: short(experienceFromLd(jp)),
        listed: salaryFromLd(jp.baseSalary || jp.estimatedSalary),
      };
    }
    return null;
  }

  const MAX_LD_CHARS = 300000; // a hostile page could embed megabytes of JSON; don't parse that every second
  let ldMemo = { sig: null, result: null };

  function fromJsonLd(doc) {
    const texts = [];
    let total = 0;
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      const t = s.textContent || '';
      total += t.length;
      if (total > MAX_LD_CHARS) break;
      texts.push(t);
      if (texts.length >= 20) break;
    }
    const sig = texts.length + ':' + total + ':' + texts.map((t) => t.slice(0, 64)).join('|');
    if (sig === ldMemo.sig) return ldMemo.result ? Object.assign({}, ldMemo.result) : null;
    const result = parseJsonLdTexts(texts);
    ldMemo = { sig, result };
    return result ? Object.assign({}, result) : null;
  }

  // ---------------------------------------------------------------------------------------
  // Site-specific extractors. Each returns { title, company, location, experience, listed,
  // anchor } where anchor is the title element the badge is placed after.
  // ---------------------------------------------------------------------------------------

  // ---- Layout-independent helpers ------------------------------------------------------
  // Job sites (LinkedIn especially) rename their CSS classes often. These helpers find things
  // by what the user can see instead: the visible heading whose text is the job title, and
  // the "City, State, Country · 4 days ago · …" line under it.

  function isShown(el) {
    if (!el || !el.isConnected || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 20 && r.height >= 10; // screen-reader-only copies are 1px
  }

  let titleMemo = { title: null, el: null, missAt: 0 };

  /** The visible element showing exactly this title, in the largest font (the page heading). */
  function findVisibleTitle(doc, title) {
    if (!title) return null;
    if (titleMemo.title === title) {
      if (isShown(titleMemo.el)) return titleMemo.el;
      if (!titleMemo.el && Date.now() - titleMemo.missAt < 5000) return null; // don't rescan every tick
    }
    const want = title.toLowerCase();
    let best = null;
    let bestSize = 0;
    let n = 0;
    for (const el of doc.querySelectorAll('h1, h2, h3, p, a, strong, span, div')) {
      if (++n > 8000) break;
      if (el.childElementCount > 3) continue;
      if (textOf(el, 200).toLowerCase() !== want) continue;
      if (!isShown(el)) continue;
      const size = parseFloat((doc.defaultView || window).getComputedStyle(el).fontSize) || 0;
      if (size > bestSize) {
        best = el; // ancestors come first, so for <p><a>Title</a></p> we keep the <p>
        bestSize = size;
      }
    }
    titleMemo = { title, el: best, missAt: best ? 0 : Date.now() };
    return best;
  }

  const NOT_A_PLACE = /\bago\b|applicant|clicked|people|promoted|reposted|posted|hour|minute|responses|easy apply|full[- ]time|part[- ]time|contract|internship|on-site|hybrid|premium|apply|save/i;

  /** Reads the location from the "Bengaluru, Karnataka, India · 4 days ago · …" line after the title. */
  function locationAfter(titleEl, scope) {
    if (!titleEl || !scope) return '';
    const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
    let checked = 0;
    for (const el of scope.querySelectorAll('div, p, span, li')) {
      if (!(titleEl.compareDocumentPosition(el) & FOLLOWING) || titleEl.contains(el)) continue;
      if (++checked > 150) break;
      const t = textOf(el, 400);
      if (!t || t.length > 300 || t.indexOf('·') < 0) continue;
      const firstPart = clean(t.split('·')[0]);
      if (firstPart.length >= 2 && firstPart.length <= 80 && !NOT_A_PLACE.test(firstPart)) return firstPart;
    }
    return '';
  }

  /** "(3) Associate Software Engineer | Emmes Group | LinkedIn" -> ["Associate Software Engineer", "Emmes Group"] */
  function linkedinDocTitle(doc) {
    const parts = clean(doc.title).replace(/^\(\d+\)\s*/, '').split(' | ');
    if (parts.length >= 3 && /linkedin/i.test(parts[parts.length - 1])) return [parts[0], parts[1]];
    return ['', ''];
  }

  function linkedin(doc, loc) {
    if (!/\/jobs\//.test(loc.pathname) && !/currentJobId=/.test(loc.search)) return null;
    const [docTitle, docCompany] = linkedinDocTitle(doc);
    let titleEl = first(doc, [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      'h1.top-card-layout__title',
      '.topcard__title',
      '.jobs-search__job-details h1',
      '.jobs-details h1',
      'main h1',
    ]);
    const title = textOf(titleEl) || docTitle;
    if (!title) return null;
    // The element we found may be a hidden copy; anchor the badge to the heading the user sees.
    if (!isShown(titleEl)) titleEl = findVisibleTitle(doc, title) || titleEl;

    const card =
      (titleEl &&
        titleEl.closest(
          '.job-details-jobs-unified-top-card__container--two-pane, .job-details-jobs-unified-top-card__container, .jobs-unified-top-card, .top-card-layout, .jobs-details__main-content'
        )) ||
      (titleEl && titleEl.parentElement && titleEl.parentElement.parentElement && titleEl.parentElement.parentElement.parentElement) ||
      doc.body;
    const companyEl = first(card, [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      'a.topcard__org-name-link',
      '.topcard__org-name-link',
      'a[href*="/company/"]',
    ]);
    const locationEl = first(card, [
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
      '.job-details-jobs-unified-top-card__bullet',
      '.jobs-unified-top-card__bullet',
      '.topcard__flavor--bullet',
    ]);
    const company = textOf(companyEl) || docCompany;
    let location = clean(textOf(locationEl).split('·')[0]);
    if (!location || NOT_A_PLACE.test(location)) location = locationAfter(titleEl, card);
    const salaryText = findSalaryText(textOf(card, 4000));
    return {
      title: short(title),
      company: short(company),
      location: short(location),
      experience: '',
      listed: salaryText ? { text: salaryText } : null,
      anchor: isShown(titleEl) ? titleEl : null,
    };
  }

  function naukri(doc) {
    const titleEl = first(doc, ['[class*="jd-header-title"]', 'header h1', 'main h1', 'h1']);
    if (!titleEl) return null;
    const companyEl = first(doc, ['[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]']);
    const salaryEl = first(doc, ['[class*="jhc__salary"]', '[class*="salary"]']);
    const expEl = first(doc, ['[class*="jhc__exp"]']);
    const locEl = first(doc, ['[class*="jhc__location"] a', '[class*="jhc__location"]']);
    const salaryRaw = textOf(salaryEl);
    const listedText = !isUndisclosed(salaryRaw) ? findSalaryText(salaryRaw) || (/\d/.test(salaryRaw) ? salaryRaw : null) : null;
    return {
      title: short(textOf(titleEl)),
      // Naukri's company block can include a rating and review count; keep just the name.
      company: short(textOf(companyEl).replace(/\s*\d(\.\d)?\s*[\d,.]*\s*Reviews?.*$/i, '')),
      location: short(textOf(locEl)),
      experience: short(textOf(expEl)),
      listed: listedText ? { text: short(listedText) } : null,
      anchor: titleEl,
    };
  }

  function indeed(doc) {
    const titleEl = first(doc, [
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      'h1.jobsearch-JobInfoHeader-title',
      '.jobsearch-JobInfoHeader-title',
      'h2[data-testid="jobsearch-JobInfoHeader-title"]',
    ]);
    if (!titleEl) return null;
    const companyEl = first(doc, ['[data-testid="inlineHeader-companyName"] a', '[data-testid="inlineHeader-companyName"]', '[data-company-name]']);
    const locEl = first(doc, ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]', '[data-testid="jobsearch-JobInfoHeader-companyLocation"]']);
    const salaryEl = first(doc, ['#salaryInfoAndJobType', '[data-testid="jobsearch-OtherJobDetailsContainer"]', '#jobDetailsSection']);
    const salaryText = findSalaryText(textOf(salaryEl, 2000));
    return {
      title: short(textOf(titleEl).replace(/\s*-\s*job post\s*$/i, '')),
      company: short(textOf(companyEl)),
      location: short(textOf(locEl)),
      experience: '',
      listed: salaryText ? { text: salaryText } : null,
      anchor: titleEl,
    };
  }

  function foundit(doc) {
    const titleEl = first(doc, ['.jdTitle h1', '.jd-header h1', 'h1']);
    if (!titleEl) return null;
    const companyEl = first(doc, ['.jdCompanyName a', '.jdCompanyName', '[class*="companyName"]']);
    const salaryText = findSalaryText(textOf(titleEl.closest('section, header, div') || doc.body, 3000));
    return {
      title: short(textOf(titleEl)),
      company: short(textOf(companyEl)),
      location: '',
      experience: '',
      listed: salaryText ? { text: salaryText } : null,
      anchor: titleEl,
    };
  }

  /** Last resort for a manual scan: the page's <h1> plus og:site_name / <title>. */
  function generic(doc) {
    const h1 = first(doc, ['main h1', 'article h1', 'h1']);
    const title = textOf(h1) || clean((doc.title || '').split(/ [|\-–] /)[0]);
    if (!title) return null;
    const site = doc.querySelector('meta[property="og:site_name"]');
    const titleParts = clean(doc.title).split(/ [|\-–] /);
    const company = titleParts.length >= 3 ? titleParts[1] : '';
    return {
      title: short(title),
      company: short(company || (site && site.getAttribute('content')) || ''),
      location: '',
      experience: '',
      listed: null,
      anchor: h1,
      guessed: true, // not clearly a job posting; never looked up without the user asking
    };
  }

  function siteOf(host) {
    if (/(^|\.)linkedin\.com$/.test(host)) return 'linkedin';
    if (/(^|\.)naukri\.com$/.test(host)) return 'naukri';
    if (/(^|\.)indeed\.com$/.test(host)) return 'indeed';
    if (/(^|\.)foundit\.in$/.test(host)) return 'foundit';
    return 'other';
  }

  /** Fills empty fields of `a` from `b`. */
  function merge(a, b) {
    if (!a) return b ? Object.assign({ anchor: null }, b) : null;
    if (!b) return a;
    for (const k of ['title', 'company', 'location', 'experience']) if (!a[k] && b[k]) a[k] = b[k];
    if (!a.listed && b.listed) a.listed = b.listed;
    return a;
  }

  /** Finds the visible heading showing the title, to anchor the badge on JSON-LD pages. */
  function findTitleEl(doc, title) {
    return findVisibleTitle(doc, title);
  }

  /**
   * Detects the job on the current page. Returns null when this doesn't look like a job page.
   * @param {Document} doc
   * @param {{hostname:string, pathname:string, search:string}} loc
   * @param {{manual?: boolean}} [opts] manual = the user clicked the toolbar button
   */
  function detect(doc, loc, opts) {
    const manual = !!(opts && opts.manual);
    const site = siteOf(loc.hostname);
    let job = null;
    if (site === 'linkedin') job = linkedin(doc, loc);
    else if (site === 'naukri') job = naukri(doc);
    else if (site === 'indeed') job = indeed(doc);
    else if (site === 'foundit') job = foundit(doc);

    // JSON-LD describes the page's main posting; on LinkedIn's split view it can describe a
    // different job than the one open on the right, so only use it there to fill gaps.
    const ld = fromJsonLd(doc);
    if (ld && job && site === 'linkedin' && ld.title && ld.title !== job.title) {
      // Different job: ignore.
    } else {
      job = merge(job, ld);
    }
    if (job && !job.anchor) job.anchor = findTitleEl(doc, job.title);

    if (!job && manual) job = generic(doc);
    if (!job || !job.title) return null;
    job.site = site;
    return job;
  }

  /** Stable identity for a job, used to notice when the user opens a different posting. */
  function jobKey(job) {
    return [job.title, job.company, job.location].map((s) => clean(s).toLowerCase()).join('|');
  }

  SL.extract = { detect, jobKey, parseJsonLdTexts, findSalaryText, isUndisclosed, siteOf };
})(typeof globalThis !== 'undefined' ? globalThis : window);
