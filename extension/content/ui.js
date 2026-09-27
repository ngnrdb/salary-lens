// The badge next to the job title and the details card. Both live in Shadow DOM so the job
// site's CSS can't affect them (and theirs can't affect the site).
// Classic script (no imports) so it can run as a content script; exposes SL.ui.
(function (root) {
  const SL = (root.SL = root.SL || {});

  const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif";

  const ICON = {
    lens: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
    refresh: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path></svg>',
    external: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path></svg>',
  };

  /** Links in the card may only be https (or our own "#" placeholder). */
  function safeHref(v) {
    if (v === '#') return '#';
    try {
      const u = new URL(String(v));
      return u.protocol === 'https:' ? u.href : '#';
    } catch (e) {
      return '#';
    }
  }

  /**
   * Ignore clicks the page's own scripts fake (element.click(), dispatchEvent). Only a real
   * user click can trigger a lookup, a refresh, or open settings.
   */
  function trustedOnly(fn) {
    return function (e) {
      if (e && e.isTrusted === false) {
        e.preventDefault();
        return;
      }
      return fn.apply(this, arguments);
    };
  }

  /** Tiny element builder. Text is always set as text, never as HTML. */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'icon') el.innerHTML = ICON[v]; // static, trusted markup only
        else if (k === 'href') el.setAttribute('href', safeHref(v));
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), trustedOnly(v));
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach((x) => x && el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x));
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  // ---------------------------------------------------------------------------------------
  // Badge
  // ---------------------------------------------------------------------------------------

  const BADGE_CSS = `
    :host { all: initial; }
    button {
      all: unset; box-sizing: border-box; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      height: 30px; padding: 0 12px; border-radius: 999px;
      font: 700 13px/1 ${FONT}; letter-spacing: 0; white-space: nowrap;
      border: 1.5px solid currentColor; max-width: 320px;
      box-shadow: 0 1px 2px rgba(27,29,34,.08);
    }
    button:focus-visible { outline: 3px solid #7FB8A4; outline-offset: 2px; }
    .t { overflow: hidden; text-overflow: ellipsis; }
    .estimate { color: #0B6B4F; background: #E3F1EA; }
    .listed   { color: #1F4F8F; background: #E6EEF8; }
    .idle     { color: #0B6B4F; background: #FFFFFF; }
    .loading  { color: #4A4D54; background: #F1EFE9; border-color: #D9D5CA; }
    .muted    { color: #4A4D54; background: #F1EFE9; border-color: #D9D5CA; }
    .spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #C9C5BA; border-top-color: #0B6B4F; animation: r .8s linear infinite; }
    @keyframes r { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
  `;

  function createBadge(onClick) {
    const host = document.createElement('span');
    host.setAttribute('data-salary-lens', 'badge');
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.appendChild(h('style', { text: BADGE_CSS }));
    const btn = h('button', { type: 'button', class: 'idle' });
    shadow.appendChild(btn);
    // The title is often inside a link; don't let a badge click navigate or open the job.
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    btn.addEventListener('click', (e) => {
      stop(e);
      if (!e.isTrusted) return; // the page itself can't open the card or start a lookup
      onClick();
    });
    btn.addEventListener('mousedown', (e) => e.stopPropagation());

    function setFloating(floating) {
      host.style.cssText = floating
        ? 'position:fixed;right:20px;bottom:20px;z-index:2147483646;display:block;line-height:0;'
        : 'display:inline-block;vertical-align:middle;margin-left:10px;line-height:0;';
    }
    setFloating(false);

    /** @param {{kind:string, text:string, label?:string}} s */
    function set(s) {
      btn.className = s.kind;
      btn.textContent = '';
      btn.appendChild(s.kind === 'loading' ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : h('span', { icon: 'lens', style: 'display:inline-flex' }));
      btn.appendChild(h('span', { class: 't', text: s.text }));
      btn.setAttribute('aria-label', s.label || s.text);
      btn.title = s.label || s.text;
    }

    return { host, set, setFloating };
  }

  // ---------------------------------------------------------------------------------------
  // Card
  // ---------------------------------------------------------------------------------------

  const CARD_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      position: fixed; top: 72px; right: 24px; z-index: 2147483647;
      width: 380px; max-width: calc(100vw - 32px); max-height: calc(100vh - 96px); overflow: auto;
      display: flex; flex-direction: column; gap: 18px;
      background: #FFFFFF; color: #1B1D22; border: 1px solid #D9D5CA; border-radius: 16px;
      padding: 20px 24px 22px; box-shadow: 0 12px 32px rgba(27,29,34,.14);
      font: 400 14px/1.45 ${FONT}; text-align: left;
    }
    a { color: #0B6B4F; font-weight: 600; text-decoration: none; }
    a:hover { color: #084F3A; text-decoration: underline; }
    button { font: inherit; }
    .head { display: flex; align-items: center; gap: 10px; }
    .logo { width: 28px; height: 28px; border-radius: 8px; background: #0B6B4F; color: #fff; display: flex; align-items: center; justify-content: center; }
    .brand { flex-grow: 1; font-weight: 700; font-size: 16px; }
    .icon-btn { all: unset; cursor: pointer; width: 44px; height: 44px; margin: -8px -12px -8px 0; display: flex; align-items: center; justify-content: center; color: #5E6168; border-radius: 10px; }
    .icon-btn:hover { background: #F1EFE9; color: #1B1D22; }
    .icon-btn:focus-visible, .btn:focus-visible, a:focus-visible { outline: 3px solid #7FB8A4; outline-offset: 2px; }
    .job-title { font-weight: 700; font-size: 15px; }
    .muted { color: #5E6168; font-size: 13px; }
    .label { font-size: 13px; color: #5E6168; margin-bottom: 4px; }
    .section-title { font-size: 13px; font-weight: 600; color: #5E6168; }
    .big { font-family: Georgia, 'Times New Roman', serif; font-size: 36px; font-weight: 600; line-height: 1.1; letter-spacing: -0.01em; }
    .sub { font-size: 14px; color: #4A4D54; margin-top: 4px; }
    .chip { display: inline-block; padding: 6px 12px; border-radius: 999px; font-weight: 700; font-size: 14px; background: #E6EEF8; color: #1F4F8F; }
    .tag { display: inline-block; margin-top: 10px; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; background: #FBF1DC; color: #7A4F00; }
    .note { font-size: 13px; color: #5E6168; margin-top: 8px; }
    .sources { display: flex; flex-direction: column; gap: 8px; }
    .src { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
    .src a { display: inline-flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .src span { white-space: nowrap; color: #1B1D22; }
    .actions { display: flex; gap: 10px; }
    .btn { all: unset; cursor: pointer; flex-grow: 1; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 16px; border-radius: 10px; font-weight: 600; font-size: 15px; text-align: center; }
    .btn.outline { border: 1.5px solid #0B6B4F; color: #0B6B4F; }
    .btn.outline:hover { background: #E3F1EA; text-decoration: none; }
    .btn.solid { background: #0B6B4F; color: #FFFFFF; }
    .btn.solid:hover { background: #084F3A; }
    .btn.square { flex-grow: 0; width: 44px; padding: 0; border: 1.5px solid #D9D5CA; color: #4A4D54; }
    .btn.square:hover { background: #F1EFE9; }
    .skel { height: 34px; width: 70%; border-radius: 8px; background: linear-gradient(90deg, #F1EFE9, #E6E3DB, #F1EFE9); background-size: 200% 100%; animation: sh 1.2s ease-in-out infinite; }
    @keyframes sh { from { background-position: 100% 0; } to { background-position: -100% 0; } }
    @media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
    .error { color: #8A2A1E; font-size: 14px; }
    .foot { font-size: 12px; color: #5E6168; }
  `;

  const CONF = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' };

  // Job details come from the page, which may be hostile. Inside our card (a UI users trust)
  // show them as short plain labels without links, so a page can't use the card to phish.
  const URLISH = /\b(?:https?:\/\/|www\.)\S+/gi;
  function label(s, max) {
    const t = String(s || '').replace(URLISH, '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
  }

  function googleUrl(job) {
    const q = [job.title, 'salary', job.company, job.location].filter(Boolean).join(' ');
    return 'https://www.google.com/search?q=' + encodeURIComponent(q);
  }

  function createCard(handlers) {
    const host = document.createElement('div');
    host.setAttribute('data-salary-lens', 'card');
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.appendChild(h('style', { text: CARD_CSS }));
    const box = h('div', { class: 'card', role: 'dialog', 'aria-label': 'Salary Lens' });
    shadow.appendChild(box);
    let open = false;

    function onKey(e) {
      if (e.key === 'Escape' && open) handlers.onClose();
    }

    function show() {
      if (!host.isConnected) document.documentElement.appendChild(host);
      if (!open) document.addEventListener('keydown', onKey, true);
      open = true;
    }

    function hide() {
      host.remove();
      if (open) document.removeEventListener('keydown', onKey, true);
      open = false;
    }

    function estimateBlock(m) {
      const F = SL.format;
      const est = m.est;
      const inr = est && est.currency === 'INR';
      const what = m.unit === 'month' ? 'Estimated monthly pay' : inr ? 'Estimated annual CTC' : 'Estimated annual pay';

      if (m.status === 'loading') {
        return h('div', null, h('div', { class: 'label', text: what }), h('div', { class: 'skel' }), h('div', { class: 'note', text: 'Looking up salary data…' }));
      }
      if (m.status === 'nokey') {
        return h(
          'div',
          null,
          h('div', { class: 'section-title', text: 'Market estimate' }),
          h('p', { class: 'sub', text: 'Add your Gemini API key to see an estimated salary range with sources.' }),
          h('div', { class: 'actions', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn solid', text: 'Add Gemini API key', onClick: handlers.onOpenSettings }))
        );
      }
      if (m.status === 'idle') {
        return h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn solid', text: 'Get salary estimate', onClick: handlers.onFetch }));
      }
      if (m.status === 'error') {
        const settingsFix = m.error && ['INVALID_KEY', 'MODEL', 'NO_KEY'].includes(m.error.code);
        return h(
          'div',
          null,
          h('p', { class: 'error', role: 'alert', text: (m.error && m.error.message) || 'Something went wrong.' }),
          h(
            'div',
            { class: 'actions', style: 'margin-top:12px' },
            settingsFix
              ? h('button', { type: 'button', class: 'btn solid', text: 'Open settings', onClick: handlers.onOpenSettings })
              : h('button', { type: 'button', class: 'btn solid', text: 'Try again', onClick: () => handlers.onFetch(true) })
          )
        );
      }
      if (m.status !== 'done' || !est) return null;

      const lines = [];
      if (est.median) lines.push('Median ~' + F.money(est.median, est.currency, m.unit));
      lines.push(CONF[est.confidence] || CONF.low);

      const sources = (est.sources || []).map((s) =>
        h(
          'div',
          { class: 'src' },
          h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.name, h('span', { icon: 'external', style: 'display:inline-flex;color:inherit' })),
          s.min ? h('span', { text: F.range(s.min, s.max || s.min, est.currency, m.unit) }) : null
        )
      );

      return h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:18px' },
        h(
          'div',
          null,
          h('div', { class: 'label', text: what }),
          h('div', { class: 'big', text: F.range(est.min, est.max, est.currency, m.unit) }),
          h('div', { class: 'sub', text: lines.join(' · ') }),
          est.note ? h('div', { class: 'note', text: est.note }) : null,
          est.grounded ? null : h('div', { class: 'tag', text: 'AI estimate, not live-searched' })
        ),
        sources.length ? h('div', { class: 'sources' }, h('div', { class: 'section-title', text: 'Sources' }), sources) : null
      );
    }

    /**
     * @param {object} m view model: { job, listedText, status, est, error, unit, cached }
     *   status: idle | loading | done | error | nokey | nojob
     */
    function render(m) {
      const F = SL.format;
      box.textContent = '';
      box.appendChild(
        h(
          'div',
          { class: 'head' },
          h('div', { class: 'logo', icon: 'lens' }),
          h('div', { class: 'brand', text: 'Salary Lens' }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', icon: 'close', onClick: handlers.onClose })
        )
      );

      if (m.status === 'nojob' || !m.job) {
        box.appendChild(
          h('p', { class: 'sub', text: "Couldn't find a job posting on this page. Open a job's detail page, then click the Salary Lens icon again." })
        );
        return;
      }

      const job = m.job;
      box.appendChild(
        h(
          'div',
          null,
          h('div', { class: 'job-title', text: label(job.title, 90) }),
          h('div', { class: 'muted', text: [job.company, job.location, job.experience].map((x) => label(x, 50)).filter(Boolean).join(' · ') })
        )
      );

      if (m.listedText) {
        box.appendChild(h('div', null, h('div', { class: 'label', text: 'Listed on this posting' }), h('span', { class: 'chip', text: label(m.listedText, 60) })));
      }

      const est = estimateBlock(m);
      if (est) box.appendChild(est);

      box.appendChild(
        h(
          'div',
          { class: 'actions' },
          h('a', { class: 'btn outline', href: googleUrl(job), target: '_blank', rel: 'noopener noreferrer', text: 'Search this on Google' }),
          m.status === 'done'
            ? h('button', { type: 'button', class: 'btn square', 'aria-label': 'Refresh estimate', title: 'Refresh estimate', icon: 'refresh', onClick: () => handlers.onFetch(true) })
            : null
        )
      );

      let foot = 'Salary Lens';
      if (m.status === 'done' && m.est) {
        foot =
          (m.est.grounded ? 'Gemini + Google Search' : 'Gemini, no live search') +
          ' · ' +
          (m.cached ? 'saved ' : 'updated ') +
          F.ago(m.est.fetchedAt);
      }
      box.appendChild(h('div', { class: 'foot' }, foot, ' · ', h('a', { href: '#', text: 'Settings', onClick: (e) => (e.preventDefault(), handlers.onOpenSettings()) })));
    }

    return {
      show,
      hide,
      render,
      get isOpen() {
        return open;
      },
    };
  }

  SL.ui = { createBadge, createCard };
})(typeof globalThis !== 'undefined' ? globalThis : window);
