/* Block to Globe: loads three data files independently and renders each block.
   A missing or malformed file only affects its own block. Relative paths only. */
(function () {
  'use strict';

  var STALE_MS = 26 * 60 * 60 * 1000;
  var SECTIONS = ['local', 'state', 'federal', 'international'];

  // ---------- helpers ----------

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isHttps(u) { return typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u); }

  function getJSON(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.json();
    });
  }

  // Resolve to {ok:true, data} or {ok:false} so one failure never rejects the rest.
  function load(path) {
    return getJSON(path).then(
      function (data) { return { ok: true, data: data }; },
      function () { return { ok: false }; }
    );
  }

  function setBlock(root, state, nodes) {
    root.setAttribute('data-state', state);
    var content = root.querySelector('.content');
    while (content.firstChild) content.removeChild(content.firstChild);
    (nodes || []).forEach(function (n) { content.appendChild(n); });
  }

  function failBlock(root, msg) {
    setBlock(root, 'error', [el('p', 'fallback', msg || "Couldn't load this section right now.")]);
  }

  var TZ = 'America/Chicago';
  var SECTION_STALE_MS = 30 * 60 * 60 * 1000;
  var MARKET_STALE_DAYS = 4;

  // Built once and reused: creating an Intl.DateTimeFormat is the expensive part.
  var CHICAGO_FMT = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Date parts for a Date in Central time: {y, m, d} as numbers.
  function chicagoParts(d) {
    var out = {};
    CHICAGO_FMT.formatToParts(d).forEach(function (x) { out[x.type] = x.value; });
    return { y: +out.year, m: +out.month, d: +out.day };
  }

  function chicagoDateStr(d) {
    var c = chicagoParts(d);
    return c.y + '-' + pad2(c.m) + '-' + pad2(c.d);
  }

  // Whole days between a YYYY-MM-DD string and today in Central time (null if unparseable).
  function daysOld(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return null;
    var t = chicagoParts(new Date());
    return Math.round((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000);
  }

  // Muted note when a section's updatedAt is older than ~30 hours; null otherwise.
  function staleNote(updatedAt) {
    if (!isStr(updatedAt)) return null;
    var t = new Date(updatedAt);
    if (isNaN(t.getTime()) || Date.now() - t.getTime() <= SECTION_STALE_MS) return null;
    var label = t.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' });
    return el('p', 'stale-note', 'Last updated ' + label + '.');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "2026-11-21" -> "Nov 21, 2026" without timezone shifts.
  function prettyDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return ymd || '';
    var mo = MONTHS[parseInt(m[2], 10) - 1];
    return mo ? mo + ' ' + parseInt(m[3], 10) + ', ' + m[1] : ymd;
  }

  function sourcesEl(sources) {
    var good = (sources || []).filter(function (s) { return s && isStr(s.title) && isHttps(s.url); });
    if (!good.length) return null;
    var p = el('p', 'sources');
    p.appendChild(document.createTextNode('Sources: '));
    var ul = el('ul');
    good.forEach(function (s) {
      var li = el('li');
      var a = el('a', null, s.title);
      a.href = s.url;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      li.appendChild(a);
      if (isStr(s.outlet)) li.appendChild(document.createTextNode(' (' + s.outlet + ')'));
      ul.appendChild(li);
    });
    p.appendChild(ul);
    return p;
  }

  function validBody(b) {
    return Array.isArray(b) && b.length > 0 && b.every(isStr);
  }

  // ---------- news sections ----------

  function comingSoon(root) {
    setBlock(root, 'ok', [el('p', 'fallback', 'Coming soon.')]);
  }

  function renderSection(key, sec) {
    var root = $('sec-' + key);
    if (sec && sec.mock === true) { comingSoon(root); return; }
    if (!sec || !isStr(sec.headline) || !validBody(sec.body)) {
      failBlock(root);
      return;
    }
    var h3 = el('h3', null, sec.headline);
    if (sec.quiet === true) h3.appendChild(el('span', 'quiet-tag', 'Quiet day'));
    var nodes = [h3];
    var note = staleNote(sec.updatedAt);
    if (note) nodes.push(note);
    sec.body.forEach(function (t) { nodes.push(el('p', null, t)); });
    var src = sourcesEl(sec.sources);
    if (src) nodes.push(src);
    setBlock(root, 'ok', nodes);
  }

  // ---------- market (words only) ----------

  function renderMarket(digestRes) {
    var root = $('sec-market');
    var narr = digestRes.ok && digestRes.data && digestRes.data.sections
      ? digestRes.data.sections.market : null;
    if (narr && narr.mock === true) { comingSoon(root); return; }
    if (!narr || !validBody(narr.body)) { failBlock(root); return; }
    var nodes = [];
    if (isStr(narr.asOf)) nodes.push(el('p', 'asof', 'As of ' + prettyDate(narr.asOf)));
    var age = daysOld(narr.asOf);
    if (age !== null && age > MARKET_STALE_DAYS) {
      nodes.push(el('p', 'stale-note', 'This recap is older than expected.'));
    }
    narr.body.forEach(function (t) { nodes.push(el('p', null, t)); });
    var src = sourcesEl(narr.sources);
    if (src) nodes.push(src);
    setBlock(root, 'ok', nodes);
  }

  // ---------- scripture ----------

  function kjvLink(ref) {
    if (!/^[1-3]?\s?[A-Za-z][A-Za-z ]*\s\d+(:\d+(-\d+)?)?$/.test(ref)) return null;
    return 'https://www.biblegateway.com/passage/?version=KJV&search=' + encodeURIComponent(ref);
  }

  function renderScripture(scrRes, digestRes) {
    var root = $('sec-scripture');
    var dScr = digestRes.ok && digestRes.data ? digestRes.data.scripture : null;
    var dRef = dScr && isStr(dScr.reference) ? dScr.reference : null;
    var s = scrRes.ok ? scrRes.data : null;

    var hasText = s && isStr(s.text) && isStr(s.reference);

    var nodes = [];
    // Show the fetched text when it matches today's reference (or there is no reference to match).
    if (hasText && (!dRef || s.reference === dRef)) {
      nodes.push(el('blockquote', null, s.text));
      nodes.push(el('cite', null, '— ' + s.reference + ' (KJV)'));
    } else if (dRef) {
      // Text missing or doesn't match today's reference: show the reference with a link.
      var p = el('p', 'fallback', "Today's verse: " + dRef + ' (KJV). ');
      var link = kjvLink(dRef);
      if (link) {
        var a = el('a', null, 'Read it online');
        a.href = link; a.rel = 'noopener noreferrer'; a.target = '_blank';
        p.appendChild(a);
      }
      nodes.push(p);
    } else {
      failBlock(root, "Today's verse isn't available right now.");
      return;
    }
    if (dScr && isStr(dScr.why)) nodes.push(el('p', 'why', dScr.why));
    setBlock(root, 'ok', nodes);
  }

  // ---------- history ----------

  var BUILT_IN_HISTORY = {
    label: 'Every day is part of history. Check back tomorrow for a new look at this date.',
    plain: true
  };

  function renderHistory(entry) {
    var root = $('history');
    var nodes = [el('span', 'label', 'This day in history')];
    var p = el('p');
    p.style.margin = '0';
    if (entry.plain) {
      p.textContent = entry.label;
    } else {
      p.appendChild(el('span', 'year', entry.year + ': '));
      p.appendChild(document.createTextNode(entry.text));
      if (isHttps(entry.url)) {
        p.appendChild(document.createTextNode(' '));
        var a = el('a', null, 'Read more');
        a.href = entry.url; a.rel = 'noopener noreferrer'; a.target = '_blank';
        p.appendChild(a);
      }
    }
    nodes.push(p);
    setBlock(root, 'ok', nodes);
  }

  function validHistory(h) {
    return h && isStr(h.text) && isNum(h.year) && h.date === chicagoDateStr(new Date());
  }

  // Keep in sync with "avoid" in config/history-filter.json (owned by history-curator).
  // Case-insensitive, matched at the start of a word.
  var GRIM_TERMS = [
    'massacre', 'genocide', 'terror', 'bomb', 'explosion', 'assassinat', 'murder', 'executed', 'execution',
    'shot dead', 'killed', 'kills', 'dead', 'deaths', 'died', 'dies', 'death toll', 'victims', 'hostage',
    'suicide', 'rape', 'torture', 'lynch', 'shooting', 'gunman', 'crash', 'sinks', 'sank', 'famine',
    'epidemic', 'pandemic', 'plague', 'earthquake', 'tsunami', 'hurricane', 'tornado', 'fire destroys',
    'concentration camp', 'holocaust', 'slaughter', 'riot', 'coup', 'invade', 'invasion', 'attack',
    'war breaks', 'declares war', 'surrender', 'siege'
  ];
  var GRIM = new RegExp('\\b(?:' + GRIM_TERMS.join('|') + ')', 'i');

  // One 3-second timer: it aborts the request where AbortController exists and rejects either way.
  function wikiFallback() {
    var c = chicagoParts(new Date());
    var url = 'https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/' + pad2(c.m) + '/' + pad2(c.d);
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer;
    var timeout = new Promise(function (_, rej) {
      timer = setTimeout(function () { if (ctl) ctl.abort(); rej(new Error('timeout')); }, 3000);
    });
    var req = fetch(url, { signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('wiki ' + r.status); return r.json(); })
      .then(function (j) {
        var found = null;
        (j.selected || []).some(function (e) {
          if (!e || !isStr(e.text) || !isNum(e.year) || GRIM.test(e.text)) return false;
          var pages = Array.isArray(e.pages) ? e.pages : [];
          for (var i = 0; i < pages.length; i++) {
            var u = pages[i] && pages[i].content_urls && pages[i].content_urls.desktop;
            if (u && isHttps(u.page)) { found = { year: e.year, text: e.text, url: u.page }; return true; }
          }
          return false;
        });
        if (!found) throw new Error('no entries');
        return found;
      });
    return Promise.race([req, timeout]).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  function runHistory(res) {
    if (res.ok && validHistory(res.data)) { renderHistory(res.data); return; }
    wikiFallback().then(renderHistory, function () { renderHistory(BUILT_IN_HISTORY); });
  }

  // ---------- header / banners ----------

  function renderMeta(digestRes) {
    var updated = $('updated');
    var banners = $('banners');
    while (banners.firstChild) banners.removeChild(banners.firstChild);
    updated.textContent = '';

    var d = digestRes.ok ? digestRes.data : null;
    var when = d && isStr(d.generatedAt) ? new Date(d.generatedAt) : null;
    if (when && !isNaN(when.getTime())) {
      updated.textContent = 'Updated ' + when.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      if (Date.now() - when.getTime() > STALE_MS) {
        banners.appendChild(el('p', 'banner', "Heads up: today's news hasn't updated yet. You're seeing the last good version."));
      }
    }
    var secs = d && d.sections ? d.sections : null;
    var pending = secs && Object.keys(secs).some(function (k) { return secs[k] && secs[k].mock === true; });
    if (pending) {
      banners.appendChild(el('p', 'banner', 'Some sections are still being set up and will appear here soon.'));
    }
  }

  // ---------- go ----------

  function init() {
    var files = {
      digest: load('data/digest.json'),
      scripture: load('data/scripture.json'),
      history: load('data/history.json')
    };

    files.digest.then(function (res) {
      renderMeta(res);
      var secs = res.ok && res.data && res.data.sections ? res.data.sections : null;
      SECTIONS.forEach(function (key) { renderSection(key, secs ? secs[key] : null); });
    });

    // Separate chain on purpose: an error in one block never stops another (rule 6).
    files.digest.then(renderMarket);
    Promise.all([files.scripture, files.digest]).then(function (r) { renderScripture(r[0], r[1]); });
    files.history.then(runHistory);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
