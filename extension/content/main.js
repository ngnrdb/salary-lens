// Content script entry: watches the page for a job posting, shows the badge, and asks the
// background worker for an estimate. Runs on the job sites in manifest.json, or on any page
// when the user clicks the toolbar button.
//
// This script runs inside the job site's page, so it is treated as untrusted territory:
// it never sees the API key (only "is there a key?"), and it only asks for lookups when the
// job on screen has been stable for a moment and the tab is visible, so a page that keeps
// changing its title can't trigger a stream of paid API calls.
(function () {
  if (window.__salaryLensLoaded) return;
  window.__salaryLensLoaded = true;

  const SL = window.SL;
  const POLL_MS = 1000;
  const STABLE_MS = 1500; // a job must stay on screen this long before an automatic lookup

  let settings = { hasKey: false, autoFetch: true, unit: 'year' };
  const state = {
    key: null, // identity of the job currently shown
    job: null,
    status: 'idle', // idle | loading | done | error | nokey
    est: null,
    error: null,
    cached: false,
    manual: false, // true once the user clicked the toolbar button on this page
    seenAt: 0, // when the current job first appeared
    autoTried: false, // one automatic lookup per job at most
    requestId: 0,
  };

  const badge = SL.ui.createBadge(() => toggleCard());
  const card = SL.ui.createCard({
    onClose: () => card.hide(),
    onFetch: (force) => fetchEstimate(!!force),
    onOpenSettings: () => send({ type: 'SL_OPEN_OPTIONS' }),
  });

  function hasKey() {
    return !!settings.hasKey;
  }

  function applySettings(s) {
    if (!s || typeof s !== 'object') return;
    settings = { hasKey: !!s.hasKey, autoFetch: !!s.autoFetch, unit: s.unit === 'month' ? 'month' : 'year' };
  }

  /** chrome.runtime.sendMessage that survives the extension being reloaded under the page. */
  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      return { ok: false, error: { code: 'RELOAD', message: 'Salary Lens was updated. Reload this page to use it again.' } };
    }
  }

  function listedText() {
    return state.job ? SL.format.listed(state.job.listed, settings.unit) : '';
  }

  // ---------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------

  function badgeState() {
    const listed = listedText();
    if (listed) return { kind: 'listed', text: listed + ' · listed', label: 'Listed salary: ' + listed + '. Open Salary Lens.' };
    if (state.status === 'loading') return { kind: 'loading', text: 'Finding salary…' };
    if (state.status === 'done' && state.est) {
      const t = SL.format.badge(state.est.min, state.est.max, state.est.currency, settings.unit);
      return { kind: 'estimate', text: t, label: 'Estimated salary ' + t + '. Open Salary Lens for details.' };
    }
    if (state.status === 'error') return { kind: 'muted', text: 'Salary unavailable', label: 'Salary unavailable. Open Salary Lens for details.' };
    return { kind: 'idle', text: 'Check salary', label: 'Check the salary for this job' };
  }

  function render() {
    if (!state.job) return;
    badge.set(badgeState());
    if (card.isOpen) {
      card.render({
        job: state.job,
        listedText: listedText(),
        status: state.status,
        est: state.est,
        error: state.error,
        unit: settings.unit,
        cached: state.cached,
      });
    }
  }

  function toggleCard() {
    if (card.isOpen) {
      card.hide();
      return;
    }
    card.show();
    render();
    // Opening the card is an explicit request, so fetch even when auto lookup is off
    // (but not for a page we only guessed is a job; the user presses the button for that).
    if (state.status === 'idle' && hasKey() && state.job && !state.job.guessed) fetchEstimate(false);
  }

  function attachBadge(anchor) {
    if (anchor && anchor.isConnected) {
      if (badge.host.parentElement !== anchor) {
        badge.setFloating(false);
        anchor.appendChild(badge.host);
      }
    } else if (!badge.host.isConnected || badge.host.parentElement !== document.documentElement) {
      badge.setFloating(true);
      document.documentElement.appendChild(badge.host);
    }
  }

  function clearUI() {
    badge.host.remove();
    card.hide();
  }

  // ---------------------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------------------

  async function fetchEstimate(force) {
    if (!state.job) return;
    if (!hasKey()) {
      state.status = 'nokey';
      render();
      return;
    }
    if (state.status === 'loading') return;
    const id = ++state.requestId;
    state.status = 'loading';
    state.error = null;
    render();
    const job = state.job;
    const res = await send({
      type: 'SL_ESTIMATE',
      force,
      job: {
        title: job.title,
        company: job.company,
        location: job.location,
        experience: job.experience,
        listedText: SL.format.listed(job.listed, 'year'),
      },
    });
    if (id !== state.requestId) return; // the user moved to another job meanwhile
    if (res && res.ok) {
      state.status = 'done';
      state.est = res.estimate;
      state.cached = !!res.cached;
    } else {
      const err = (res && res.error) || { code: 'UNKNOWN', message: 'Something went wrong.' };
      state.status = err.code === 'NO_KEY' ? 'nokey' : 'error';
      state.error = err;
    }
    render();
  }

  function maybeAutoFetch() {
    if (!state.job || state.autoTried || state.status !== 'idle') return;
    if (!hasKey() || !settings.autoFetch || state.job.guessed) return;
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - state.seenAt < STABLE_MS) return;
    state.autoTried = true;
    fetchEstimate(false);
  }

  // ---------------------------------------------------------------------------------------
  // Page watching. Job sites like LinkedIn are single-page apps: clicking another job swaps
  // the content without a page load, and can re-render the title (dropping our badge). A
  // cheap once-a-second check handles both.
  // ---------------------------------------------------------------------------------------

  function tick() {
    let job = null;
    try {
      job = SL.extract.detect(document, location, { manual: state.manual });
    } catch (e) {
      job = null;
    }
    if (!job) {
      if (state.job) {
        state.job = null;
        state.key = null;
        state.requestId++;
        clearUI();
      }
      return;
    }
    const key = SL.extract.jobKey(job);
    if (key !== state.key) {
      state.key = key;
      state.job = job;
      state.est = null;
      state.error = null;
      state.cached = false;
      state.status = hasKey() ? 'idle' : 'nokey';
      state.seenAt = Date.now();
      state.autoTried = false;
      state.requestId++;
      attachBadge(job.anchor);
      render();
      return;
    }
    // Same job: keep the freshest anchor and listed salary (the page may still be loading).
    state.job.anchor = job.anchor;
    if (!state.job.listed && job.listed) {
      state.job.listed = job.listed;
      render();
    }
    attachBadge(job.anchor);
    maybeAutoFetch();
  }

  function openFromToolbar() {
    state.manual = true;
    tick();
    card.show();
    if (state.job) {
      render();
      if (state.status === 'idle' && hasKey() && !state.job.guessed) fetchEstimate(false);
    } else {
      card.render({ job: null, status: 'nojob', unit: settings.unit });
    }
  }

  // Messages come only from our own background worker (pages can't send runtime messages).
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender || sender.id !== chrome.runtime.id || !msg) return;
    if (msg.type === 'SL_OPEN') {
      openFromToolbar();
      sendResponse({ ok: true });
    } else if (msg.type === 'SL_SETTINGS') {
      const hadKey = hasKey();
      applySettings(msg.settings);
      // A key was just added: pick up where we left off.
      if (!hadKey && hasKey() && state.job && (state.status === 'nokey' || state.status === 'error')) {
        state.status = 'idle';
        state.autoTried = false;
        if (card.isOpen && !state.job.guessed) fetchEstimate(false);
      }
      if (!hasKey() && state.job && state.status !== 'done') state.status = 'nokey';
      render();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') maybeAutoFetch();
  });

  send({ type: 'SL_GET_SETTINGS' }).then((res) => {
    if (res && res.ok) applySettings(res.settings);
    // The toolbar button may have opened the card before settings arrived.
    if (state.job && state.status === 'nokey' && hasKey()) {
      state.status = 'idle';
      if (card.isOpen && !state.job.guessed) fetchEstimate(false);
      else render();
    }
    tick();
    setInterval(tick, POLL_MS);
  });
})();
