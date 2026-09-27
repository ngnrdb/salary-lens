// Money formatting shared by the badge and the card.
// Classic script (no imports) so it can run as a content script; exposes SL.format.
(function (root) {
  const SL = (root.SL = root.SL || {});

  const PERIOD_TO_YEAR = { year: 1, month: 12, week: 52, day: 260, hour: 2080 };

  /** Convert an amount paid per `period` into a yearly amount. */
  function toYearly(amount, period) {
    const factor = PERIOD_TO_YEAR[period] || 1;
    return amount * factor;
  }

  function trimZero(n) {
    return String(n).replace(/\.0$/, '');
  }

  function roundSmart(n) {
    return n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  }

  function symbolFor(currency) {
    if (!currency) return '';
    const map = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };
    return map[currency.toUpperCase()] ?? currency.toUpperCase() + ' ';
  }

  /**
   * Short amount without a currency symbol: 1800000 INR -> "18L", 12500000 INR -> "1.3Cr",
   * 120000 USD -> "120K".
   */
  function shortAmount(amount, currency) {
    if (amount == null || !isFinite(amount)) return '?';
    const inr = (currency || '').toUpperCase() === 'INR';
    if (inr) {
      if (amount >= 1e7) return trimZero(roundSmart(amount / 1e7)) + 'Cr';
      if (amount >= 1e5) return trimZero(Math.round(amount / 1e4) / 10) + 'L';
      if (amount >= 1e3) return trimZero(roundSmart(amount / 1e3)) + 'K';
      return String(Math.round(amount));
    }
    if (amount >= 1e6) return trimZero(roundSmart(amount / 1e6)) + 'M';
    if (amount >= 1e3) return trimZero(roundSmart(amount / 1e3)) + 'K';
    return String(Math.round(amount));
  }

  /** Scale a yearly amount to the unit the user prefers ("year" or "month"). */
  function toUnit(yearly, unit) {
    return unit === 'month' ? yearly / 12 : yearly;
  }

  /** "₹18L" */
  function money(yearly, currency, unit) {
    return symbolFor(currency) + shortAmount(toUnit(yearly, unit), currency);
  }

  /** Big range for the card: "₹18L – ₹26L" */
  function range(minYearly, maxYearly, currency, unit) {
    if (Math.round(minYearly) === Math.round(maxYearly)) return money(minYearly, currency, unit);
    return money(minYearly, currency, unit) + ' – ' + money(maxYearly, currency, unit);
  }

  /** Suffix describing the unit: "per year" / "per month". */
  function unitLabel(unit) {
    return unit === 'month' ? 'per month' : 'per year';
  }

  /**
   * Compact badge text.
   * INR yearly -> "~₹18–26 LPA"; INR monthly -> "~₹1.5L–2.2L/mo"; USD -> "~$120K–150K/yr".
   */
  function badge(minYearly, maxYearly, currency, unit) {
    const sym = symbolFor(currency);
    const inr = (currency || '').toUpperCase() === 'INR';
    if (inr && unit !== 'month') {
      const lo = trimZero(roundSmart(minYearly / 1e5));
      const hi = trimZero(roundSmart(maxYearly / 1e5));
      if (maxYearly >= 1e7) {
        return '~' + sym + shortAmount(minYearly, 'INR') + '–' + shortAmount(maxYearly, 'INR') + ' /yr';
      }
      return '~' + sym + (lo === hi ? lo : lo + '–' + hi) + ' LPA';
    }
    const lo = shortAmount(toUnit(minYearly, unit), currency);
    const hi = shortAmount(toUnit(maxYearly, unit), currency);
    return '~' + sym + (lo === hi ? lo : lo + '–' + hi) + (unit === 'month' ? '/mo' : '/yr');
  }

  /** Text for a salary listed as structured data on the page (JSON-LD). */
  function listed(l, unit) {
    if (!l) return '';
    if (l.text) return l.text;
    if (l.min == null) return '';
    const period = l.period || 'year';
    const minY = toYearly(l.min, period);
    const maxY = toYearly(l.max ?? l.min, period);
    return range(minY, maxY, l.currency, unit) + (unit === 'month' ? '/mo' : '/yr');
  }

  /** "2 min ago" */
  function ago(ts, now) {
    const s = Math.max(0, Math.round(((now ?? Date.now()) - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  SL.format = { toYearly, shortAmount, money, range, badge, listed, unitLabel, ago, symbolFor };
})(typeof globalThis !== 'undefined' ? globalThis : window);
