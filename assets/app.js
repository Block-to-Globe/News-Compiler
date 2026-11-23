/* Block to Globe: loads four data files independently and renders each block.
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

  function localDateStr(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // "2026-11-21" -> "Nov 21, 2026" without timezone shifts.
  function prettyDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return ymd || '';
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var mo = names[parseInt(m[2], 10) - 1];
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

    var textOk = s && isStr(s.text) && isStr(s.reference) && (!dRef || s.reference === dRef);

    var nodes = [];
    if (textOk) {
      var bq = el('blockquote', null, s.text);
      nodes.push(bq);
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
    } else if (s && isStr(s.text) && isStr(s.reference)) {
      nodes.push(el('blockquote', null, s.text));
      nodes.push(el('cite', null, '— ' + s.reference + ' (KJV)'));
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
    return h && isStr(h.text) && isNum(h.year) && h.date === localDateStr(new Date());
  }

  var GRIM = /massacre|killed|kills|terror|bomb|execut|assassinat|genocide|murder|shot dead|dies|died|death/i;

  function wikiFallback() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var url = 'https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/' + p(d.getMonth() + 1) + '/' + p(d.getDate());
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 3000);
    var race = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 3000); });
    var req = fetch(url, { signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('wiki ' + r.status); return r.json(); })
      .then(function (j) {
        clearTimeout(timer);
        var list = (j.selected || []).filter(function (e) {
          return e && isStr(e.text) && isNum(e.year) && !GRIM.test(e.text);
        });
        if (!list.length) throw new Error('no entries');
        var e = list[0];
        var page = e.pages && e.pages[0] && e.pages[0].content_urls && e.pages[0].content_urls.desktop;
        return { year: e.year, text: e.text, url: page && page.page };
      });
    return Promise.race([req, race]);
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
      SECTIONS.forEach(function (key) {
        var sec = res.ok && res.data && res.data.sections ? res.data.sections[key] : null;
        renderSection(key, sec);
      });
    });

    files.digest.then(renderMarket);
    Promise.all([files.scripture, files.digest]).then(function (r) { renderScripture(r[0], r[1]); });
    files.history.then(runHistory);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
