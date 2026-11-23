// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const root = new URL('..', import.meta.url).pathname;

// The sandbox uses a full sample digest (tests/fixtures) so every rule has something to check.
function sandbox({ rawRepoData = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'btg-'));
  cpSync(join(root, 'data'), join(dir, 'data'), { recursive: true });
  if (!rawRepoData) {
    cpSync(join(root, 'tests/fixtures/digest.full.json'), join(dir, 'data/digest.json'));
    cpSync(join(root, 'tests/fixtures/market.full.json'), join(dir, 'data/market.json'));
  }
  return dir;
}
function validate(dir, extra = []) {
  return spawnSync('node', [join(root, 'scripts/validate.mjs'), '--dir', join(dir, 'data'), ...extra], { encoding: 'utf8' });
}
function edit(dir, file, fn) {
  const p = join(dir, 'data', file);
  const o = JSON.parse(readFileSync(p, 'utf8')); fn(o); writeFileSync(p, JSON.stringify(o, null, 2));
}

test('repo data (sections marked mock) passes validation', () => {
  const d = sandbox({ rawRepoData: true });
  // Mirrors the deploy, which runs `validate --only digest,market`. Scripture is excluded: the repo's mock
  // scripture.json is replaced at deploy and drifts from the verse the scheduled task writes into digest.json daily.
  const r = validate(d, ['--only', 'digest,market,history']);
  assert.equal(r.status, 0, r.stderr);
  rmSync(d, { recursive: true });
});

test('full sample digest passes validation', () => {
  const d = sandbox();
  const r = validate(d);
  assert.equal(r.status, 0, r.stderr);
  rmSync(d, { recursive: true });
});

const bad = [
  ['not JSON', (d) => writeFileSync(join(d, 'data/digest.json'), '{ nope'), /not valid JSON/],
  ['missing file', (d) => rmSync(join(d, 'data/digest.json')), /file is missing/],
  ['missing section', (d) => edit(d, 'digest.json', (o) => { delete o.sections.federal; }), /sections\.federal is missing/],
  ['headline too long', (d) => edit(d, 'digest.json', (o) => { o.sections.local.headline = 'x'.repeat(91); }), /max 90/],
  ['three paragraphs', (d) => edit(d, 'digest.json', (o) => { o.sections.state.body = ['a', 'b', 'c']; }), /1 to 2 paragraphs/],
  ['paragraph too long', (d) => edit(d, 'digest.json', (o) => { o.sections.state.body = ['x'.repeat(701)]; }), /max 700/],
  ['empty string', (d) => edit(d, 'digest.json', (o) => { o.sections.federal.body = ['  ']; }), /non-empty string/],
  ['HTML in text', (d) => edit(d, 'digest.json', (o) => { o.sections.federal.headline = '<b>Hi</b>'; }), /no HTML/],
  ['http link', (d) => edit(d, 'digest.json', (o) => { o.sections.federal.sources[0].url = 'http://example.com'; }), /https URL/],
  ['javascript link', (d) => edit(d, 'digest.json', (o) => { o.sections.federal.sources[0].url = 'javascript:alert(1)'; }), /https URL/],
  ['no sources', (d) => edit(d, 'digest.json', (o) => { o.sections.international.sources = []; }), /1 to 5 sources/],
  ['bad timestamp', (d) => edit(d, 'digest.json', (o) => { o.generatedAt = 'yesterday'; }), /ISO 8601/],
  ['bad scripture reference', (d) => edit(d, 'digest.json', (o) => { o.scripture.reference = 'Psalm'; }), /scripture\.reference/],
  ['market asOf', (d) => edit(d, 'digest.json', (o) => { o.sections.market.asOf = '11/21'; }), /asOf must be YYYY-MM-DD/],
  ['market zero value', (d) => edit(d, 'market.json', (o) => { o.items[0].value = 0; }), /above zero/],
  ['market NaN-ish', (d) => edit(d, 'market.json', (o) => { o.items[1].change = '12'; }), /must be a number/],
  ['scripture wrong translation', (d) => edit(d, 'scripture.json', (o) => { o.translation = 'ESV'; }), /KJV/],
  ['scripture reference mismatch', (d) => edit(d, 'scripture.json', (o) => { o.reference = 'Romans 8:28'; }), /does not match digest/],
  ['history bad year', (d) => edit(d, 'history.json', (o) => { o.year = '1900'; }), /year must be an integer/],
];
for (const [name, mutate, expect] of bad) {
  test(`rejects: ${name}`, () => {
    const d = sandbox(); mutate(d);
    const r = validate(d);
    assert.equal(r.status, 1, 'expected failure');
    assert.match(r.stderr, expect);
    rmSync(d, { recursive: true });
  });
}

test('stale digest fails the freshness check', () => {
  const d = sandbox();
  edit(d, 'digest.json', (o) => { o.generatedAt = new Date(Date.now() - 30 * 3.6e6).toISOString(); });
  assert.equal(validate(d, ['--max-age-hours', '26']).status, 1);
  edit(d, 'digest.json', (o) => { o.generatedAt = new Date(Date.now() - 2 * 3.6e6).toISOString(); });
  assert.equal(validate(d, ['--max-age-hours', '26']).status, 0);
  rmSync(d, { recursive: true });
});

function fakeSource(handler) {
  return new Promise((resolve) => {
    const s = createServer(handler).listen(0, '127.0.0.1', () => resolve(s));
  });
}
async function runFetch(dir, base) {
  return new Promise((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const p = spawn('node', [join(root, 'scripts/fetch-scripture.mjs'), '--digest', join(dir, 'data/digest.json'), '--out', join(dir, 'out/scripture.json')],
        { env: { ...process.env, SCRIPTURE_API_BASE: base } });
      let err = ''; p.stderr.on('data', (c) => (err += c)); p.stdout.on('data', () => {});
      p.on('close', (code) => resolve({ code, err }));
    });
  });
}

test('fetch-scripture accepts "Psalms" for "Psalm"', async () => {
  const d = sandbox();
  const s = await fakeSource((req, res) => {
    res.end(JSON.stringify({ reference: 'Psalms 46:1', text: 'God is our refuge.', translation_id: 'kjv' }));
  });
  const r = await runFetch(d, `http://127.0.0.1:${s.address().port}`);
  s.close();
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(readFileSync(join(d, 'out/scripture.json'), 'utf8')).reference, 'Psalm 46:1');
  rmSync(d, { recursive: true });
});

test('fetch-scripture writes KJV text from the source', async () => {
  const d = sandbox();
  const s = await fakeSource((req, res) => {
    assert.match(req.url, /^\/Psalm%2046%3A1\?translation=kjv$/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ reference: 'Psalm 46:1', text: 'God is our refuge\nand strength,  a very present help in trouble.\n', translation_id: 'kjv' }));
  });
  const r = await runFetch(d, `http://127.0.0.1:${s.address().port}`);
  s.close();
  assert.equal(r.code, 0);
  const out = JSON.parse(readFileSync(join(d, 'out/scripture.json'), 'utf8'));
  assert.equal(out.translation, 'KJV');
  assert.equal(out.reference, 'Psalm 46:1');
  assert.equal(out.text, 'God is our refuge and strength, a very present help in trouble.');
  // and the written file passes validation against the digest
  cpSync(join(d, 'out/scripture.json'), join(d, 'data/scripture.json'));
  assert.equal(validate(d).status, 0);
  rmSync(d, { recursive: true });
});

for (const [name, handler, expectMsg] of [
  ['server error', (req, res) => { res.statusCode = 503; res.end('x'); }, /answered 503/],
  ['not JSON', (req, res) => { res.end('<html>'); }, /did not return JSON/],
  ['empty text', (req, res) => { res.end(JSON.stringify({ text: '', translation_id: 'kjv' })); }, /no text/],
  ['wrong translation', (req, res) => { res.end(JSON.stringify({ text: 'x', translation_id: 'web' })); }, /expected kjv/],
  ['wrong reference', (req, res) => { res.end(JSON.stringify({ reference: 'John 3:16', text: 'x', translation_id: 'kjv' })); }, /expected "Psalm 46:1"/],
]) {
  test(`fetch-scripture skips cleanly on: ${name}`, async () => {
    const d = sandbox();
    const s = await fakeSource(handler);
    const r = await runFetch(d, `http://127.0.0.1:${s.address().port}`);
    s.close();
    assert.equal(r.code, 0, 'must not fail the deploy');
    assert.equal(existsSync(join(d, 'out/scripture.json')), false, 'must not write a file');
    assert.match(r.err, expectMsg);
    rmSync(d, { recursive: true });
  });
}

test('fetch-scripture skips cleanly when the source is unreachable', async () => {
  const d = sandbox();
  const r = await runFetch(d, 'http://127.0.0.1:9');
  assert.equal(r.code, 0);
  assert.equal(existsSync(join(d, 'out/scripture.json')), false);
  rmSync(d, { recursive: true });
});

// ---------- fetch-history ----------

async function runHistory(base, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'btg-h-'));
  const out = join(dir, 'h.json');
  const { spawn } = await import('node:child_process');
  const r = await new Promise((resolve) => {
    const p = spawn('node', [join(root, 'scripts/fetch-history.mjs'), '--out', out, '--date', '2026-11-24', '--filter', join(root, 'config/history-filter.json'), ...extra],
      { env: { ...process.env, HISTORY_API_BASE: base } });
    let err = ''; p.stderr.on('data', (c) => (err += c)); p.stdout.on('data', () => {});
    p.on('close', (code) => resolve({ code, err }));
  });
  return { ...r, out, dir };
}
const page = (t) => ({ content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(t) } } });

test('fetch-history picks a fun, linked entry over grim and unlinked ones', async () => {
  let seen;
  const s = await fakeSource((req, res) => {
    seen = req.url;
    res.end(JSON.stringify({ selected: [
      { year: 1900, text: 'A terrorist bomb destroys a market.', pages: [page('Bomb')] },
      { year: 1901, text: 'Scholars publish a long study of grain prices.', pages: [page('Grain')] },
      { year: 1859, text: 'Charles Darwin publishes On the Origin of Species, the first of its kind.', pages: [page('Darwin')] },
      { year: 1950, text: 'The first transatlantic flight of its type lands without a page.', pages: [] },
    ] }));
  });
  const r = await runHistory(`http://127.0.0.1:${s.address().port}`);
  s.close();
  assert.equal(r.code, 0, r.err);
  assert.equal(seen, '/api/rest_v1/feed/onthisday/selected/11/24');
  const out = JSON.parse(readFileSync(r.out, 'utf8'));
  assert.equal(out.year, 1859); assert.equal(out.date, '2026-11-24'); assert.match(out.url, /^https:\/\/en\.wikipedia\.org\//);
  // output passes the validator
  const d = sandbox(); cpSync(r.out, join(d, 'data/history.json'));
  assert.equal(validate(d, ['--only', 'history']).status, 0);
  rmSync(d, { recursive: true }); rmSync(r.dir, { recursive: true });
});

test('fetch-history: word-start matching ("studies" is not "dies")', async () => {
  const s = await fakeSource((req, res) => res.end(JSON.stringify({ selected: [
    { year: 1800, text: 'A university studies the stars with a new telescope.', pages: [page('Uni')] } ] })));
  const r = await runHistory(`http://127.0.0.1:${s.address().port}`);
  s.close();
  assert.equal(JSON.parse(readFileSync(r.out, 'utf8')).year, 1800);
  rmSync(r.dir, { recursive: true });
});

for (const [name, handler, expectMsg] of [
  ['feed error', (req, res) => { res.statusCode = 500; res.end('x'); }, /answered 500/],
  ['not JSON', (req, res) => { res.end('<html>'); }, /did not return JSON/],
  ['no selected list', (req, res) => { res.end('{}'); }, /no "selected" list/],
  ['only grim entries', (req, res) => { res.end(JSON.stringify({ selected: [{ year: 1, text: 'A massacre took place.', pages: [page('x')] }] })); }, /no suitable entry/],
  ['only overlong entries', (req, res) => { res.end(JSON.stringify({ selected: [{ year: 1, text: 'word '.repeat(100), pages: [page('x')] }] })); }, /no suitable entry/],
  ['unsafe link', (req, res) => { res.end(JSON.stringify({ selected: [{ year: 1, text: 'A fine first.', pages: [{ content_urls: { desktop: { page: 'javascript:alert(1)' } } }] }] })); }, /no suitable entry/],
]) {
  test(`fetch-history skips cleanly on: ${name}`, async () => {
    const s = await fakeSource(handler);
    const r = await runHistory(`http://127.0.0.1:${s.address().port}`);
    s.close();
    assert.equal(r.code, 0);
    assert.equal(existsSync(r.out), false);
    assert.match(r.err, expectMsg);
    rmSync(r.dir, { recursive: true });
  });
}

test('fetch-history skips cleanly when the feed is unreachable', async () => {
  const r = await runHistory('http://127.0.0.1:9');
  assert.equal(r.code, 0); assert.equal(existsSync(r.out), false);
  rmSync(r.dir, { recursive: true });
});

// ---------- fetch-market ----------

// Closes are keyed by symbol: [prev, last]. Timestamps are 21:00 UTC (4pm ET) on the given dates.
function chart(dates, closes) {
  return { chart: { result: [{ timestamp: dates.map((d) => Date.parse(d + 'T21:00:00Z') / 1000), indicators: { quote: [{ close: closes }] } }] } };
}
const CLOSES = { '^GSPC': [5000, 5050], '^DJI': [40000, 39800], '^IXIC': [16000, 16000], '^TNX': [4.2, 4.25], 'CL=F': [60, 61.5], 'GC=F': [2000, 1990], 'DX-Y.NYB': [100, 100.1] };

async function runMarket(handler, now = '2026-11-24T21:30:00Z') {
  const s = await fakeSource(handler);
  const dir = mkdtempSync(join(tmpdir(), 'btg-m-'));
  const out = join(dir, 'market.json');
  const { spawn } = await import('node:child_process');
  const r = await new Promise((resolve) => {
    const p = spawn('node', [join(root, 'scripts/fetch-market.mjs'), '--out', out, '--now', now],
      { env: { ...process.env, MARKET_API_BASE: `http://127.0.0.1:${s.address().port}` } });
    let err = ''; p.stderr.on('data', (c) => (err += c)); p.stdout.on('data', () => {});
    p.on('close', (code) => resolve({ code, err }));
  });
  s.close();
  return { ...r, out, dir };
}
const goodHandler = (dates = ['2026-11-21', '2026-11-24']) => (req, res) => {
  const sym = decodeURIComponent(req.url.split('/chart/')[1].split('?')[0]);
  res.end(JSON.stringify(chart(dates, CLOSES[sym])));
};

test('fetch-market writes computed numbers that pass the validator', async () => {
  const r = await runMarket(goodHandler());
  assert.equal(r.code, 0, r.err);
  const m = JSON.parse(readFileSync(r.out, 'utf8'));
  assert.equal(m.asOf, '2026-11-24'); assert.equal(m.marketStatus, 'closed'); assert.equal(m.items.length, 7);
  const sp = m.items.find((i) => i.id === 'sp500'), dow = m.items.find((i) => i.id === 'dow'), ty = m.items.find((i) => i.id === 'us10y');
  assert.deepEqual([sp.value, sp.change, sp.changePct], [5050, 50, 1]);
  assert.deepEqual([dow.change, dow.changePct], [-200, -0.5]);
  assert.deepEqual([ty.value, ty.change, ty.unit], [4.25, 0.05, 'percent']);
  const d = sandbox(); cpSync(r.out, join(d, 'data/market.json'));
  assert.equal(validate(d, ['--only', 'market']).status, 0);
  rmSync(d, { recursive: true }); rmSync(r.dir, { recursive: true });
});

test('fetch-market: weekend and holiday status', async () => {
  let r = await runMarket(goodHandler(['2026-11-20', '2026-11-23']), '2026-11-28T15:00:00Z'); // Saturday
  assert.equal(JSON.parse(readFileSync(r.out, 'utf8')).marketStatus, 'weekend'); rmSync(r.dir, { recursive: true });
  r = await runMarket(goodHandler(['2026-11-24', '2026-11-25']), '2026-11-26T21:30:00Z'); // Thanksgiving, no bar for the 26th
  const m = JSON.parse(readFileSync(r.out, 'utf8'));
  assert.equal(m.marketStatus, 'holiday'); assert.match(m.note, /closed/); rmSync(r.dir, { recursive: true });
});

// Bars at 21:00Z are 4pm ET. Helper to read the written file.
const readOut = (r) => JSON.parse(readFileSync(r.out, 'utf8'));

test('fetch-market: a lagging source on a weekday evening is called a holiday only after 16:30 ET', async () => {
  // Tue 2026-11-24 21:30Z = 16:30 ET, latest bar is Mon: claim holiday.
  let r = await runMarket(goodHandler(['2026-11-20', '2026-11-23']), '2026-11-24T21:30:00Z');
  assert.equal(readOut(r).marketStatus, 'holiday'); assert.match(readOut(r).note, /closed today/); rmSync(r.dir, { recursive: true });
  // Tue 2026-11-24 20:00Z = 15:00 ET: too early to say anything. No note.
  r = await runMarket(goodHandler(['2026-11-20', '2026-11-23']), '2026-11-24T20:00:00Z');
  let m = readOut(r); assert.equal(m.marketStatus, 'open'); assert.equal(m.note, undefined); assert.equal(m.asOf, '2026-11-23'); rmSync(r.dir, { recursive: true });
  // Tue 16:29 ET (21:29Z): still no claim.
  r = await runMarket(goodHandler(['2026-11-20', '2026-11-23']), '2026-11-24T21:29:00Z');
  m = readOut(r); assert.equal(m.note, undefined); rmSync(r.dir, { recursive: true });
});

test('fetch-market: weekend after a fresh Friday close carries the weekend note and Friday asOf', async () => {
  const r = await runMarket(goodHandler(['2026-11-19', '2026-11-20']), '2026-11-22T15:00:00Z'); // Sunday
  const m = readOut(r); assert.equal(m.asOf, '2026-11-20'); assert.equal(m.marketStatus, 'weekend'); assert.match(m.note, /last close/);
  rmSync(r.dir, { recursive: true });
});

test('fetch-market drops a latest bar that is today and not yet closed', async () => {
  // Run at 14:00 ET on Tue the 24th; the source already shows a live 24th bar.
  const r = await runMarket(goodHandler(['2026-11-23', '2026-11-24']), '2026-11-24T19:00:00Z');
  assert.equal(r.code, 1, 'only one complete bar remains'); assert.equal(existsSync(r.out), false); rmSync(r.dir, { recursive: true });
  const r2 = await runMarket((q, s) => {
    const sym = decodeURIComponent(q.url.split('/chart/')[1].split('?')[0]); const c = CLOSES[sym];
    s.end(JSON.stringify(chart(['2026-11-20', '2026-11-23', '2026-11-24'], [c[0], c[1], c[1] + 99])));
  }, '2026-11-24T19:00:00Z');
  const m = readOut(r2); assert.equal(m.asOf, '2026-11-23'); assert.equal(m.items.find((i) => i.id === 'sp500').value, 5050);
  assert.equal(m.marketStatus, 'open'); rmSync(r2.dir, { recursive: true });
});

test('fetch-market drops a latest bar with a null close', async () => {
  const r = await runMarket((q, s) => {
    const sym = decodeURIComponent(q.url.split('/chart/')[1].split('?')[0]); const c = CLOSES[sym];
    s.end(JSON.stringify(chart(['2026-11-20', '2026-11-21', '2026-11-24'], [c[0], c[1], null])));
  }, '2026-11-24T21:30:00Z');
  const m = readOut(r); assert.equal(m.asOf, '2026-11-21'); assert.equal(m.items[0].value, 5050); rmSync(r.dir, { recursive: true });
});

test('fetch-market: a symbol more than 3 days behind the S&P 500 aborts, 3 days is allowed', async () => {
  const mk = (gap) => (q, s) => {
    const sym = decodeURIComponent(q.url.split('/chart/')[1].split('?')[0]);
    s.end(JSON.stringify(chart(sym === 'GC=F' ? gap : ['2026-11-20', '2026-11-24'], CLOSES[sym])));
  };
  let r = await runMarket(mk(['2026-11-17', '2026-11-20']));
  assert.equal(r.code, 1); assert.match(r.err, /far from/); assert.equal(existsSync(r.out), false); rmSync(r.dir, { recursive: true });
  r = await runMarket(mk(['2026-11-18', '2026-11-21']));
  assert.equal(r.code, 0, r.err); rmSync(r.dir, { recursive: true });
});

for (const [name, handler] of [
  ['an HTTP error', (q, s) => { s.statusCode = 429; s.end('{}'); }],
  ['bad JSON', (q, s) => s.end('nope')],
  ['only one close', (q, s) => s.end(JSON.stringify(chart(['2026-11-24'], [5000])))],
  ['a zero close', (q, s) => s.end(JSON.stringify(chart(['2026-11-21', '2026-11-24'], [5000, 0])))],
  ['one symbol missing', (q, s) => { if (q.url.includes('CL%3DF')) { s.statusCode = 404; s.end('{}'); } else goodHandler()(q, s); }],
]) {
  test(`fetch-market writes nothing and exits 1 on: ${name}`, async () => {
    const r = await runMarket(handler);
    assert.equal(r.code, 1); assert.equal(existsSync(r.out), false); rmSync(r.dir, { recursive: true });
  });
}

// ---------- market narrative vs market.json ----------

const NOW_OK = '2026-11-23T12:00:00Z'; // two days after the fixture asOf
const check = (d, now = NOW_OK) => validate(d, ['--only', 'digest', '--check-market', '--now', now]);
function liveMarketSandbox(bodyText) {
  const d = sandbox();
  const r = (cpSync(join(root, 'data/market.json'), join(d, 'data/market.json')), 0);
  edit(d, 'market.json', (m) => { delete m.mock; m.source = 'test'; });
  edit(d, 'digest.json', (g) => { g.sections.market = { asOf: '2026-11-21', body: [bodyText], updatedAt: g.generatedAt }; });
  return d;
}
test('market narrative: numbers that match market.json pass', () => {
  const d = liveMarketSandbox('The S&P 500 rose 1.00% to 1,000.00 on Friday. Oil gained 0.84% to $60.00 and the dollar index held at 100.');
  const r = check(d);
  assert.equal(r.status, 0, r.stderr); rmSync(d, { recursive: true });
});
test('market narrative: a number not in market.json fails', () => {
  const d = liveMarketSandbox('The S&P 500 rose 1.7% to 1,000.00 on Friday.');
  const r = check(d);
  assert.equal(r.status, 1); assert.match(r.stderr, /1\.7/); rmSync(d, { recursive: true });
});
test('market narrative: asOf mismatch fails', () => {
  const d = liveMarketSandbox('Stocks were mixed.');
  edit(d, 'digest.json', (g) => { g.sections.market.asOf = '2026-11-20'; });
  const r = check(d);
  assert.equal(r.status, 1); assert.match(r.stderr, /asOf/); rmSync(d, { recursive: true });
});

test('market narrative cross-check is off unless --check-market is passed (deploys never fail on it)', () => {
  const d = liveMarketSandbox('The S&P 500 rose 9.9% on Friday.');
  assert.equal(validate(d, ['--only', 'digest']).status, 0);
  rmSync(d, { recursive: true });
});


// Fixture: sp500 1000 (+10, +1.00%), dow 2000 (-20, -1.00%), nasdaq 3000 (0, 0%), us10y 4.00 (+0.01, +0.25%),
// wti 60 (+0.5, +0.84%), gold 2000 (-5, -0.25%), dxy 100 (+0.1, +0.1%).
const recap = (t) => { const d = liveMarketSandbox(t); const r = check(d); rmSync(d, { recursive: true }); return r; };
const goodRecaps = [
  'The S&P 500 rose 1% on Friday, closing at 1,000.00.',
  'The Dow fell 1.00% to 2,000, down 20 points.',
  'The Dow slipped 20.00 points while the S&P 500 climbed 10 points.',
  'The Dow lost 1% on Nov. 21 (Friday), and the Nasdaq was flat at 3,000.00.',
  'Gold dropped 0.25% to $2,000.00, down $5. Crude oil rose 0.84% to $60.',
  'The 10-year Treasury yield rose to 4.00%, up 1 basis point.',
  'The 10-year yield edged up 0.01 percentage points. It closed at 4%.',
  'Oil gained 0.8% to $60.0 in 2026 trading, the dollar index up 0.1%.',
  'The Dow fell. It lost 1.0% on the day.',                 // second sentence inherits the Dow
  'Stocks were mixed on Friday, Nov. 21, 2026, with 3 of 4 gauges moving.',
  'The Dow is down -1.00% and the S&P 500 is up +1.00%.',
  'The Nasdaq was flat on Friday.',
  'The Dow declined 2,000 points?',                         // matches value; strict number rules are not about prose
];
for (const t of goodRecaps.slice(0, -1)) test(`market narrative passes: ${t.slice(0, 50)}`, () => { const r = recap(t); assert.equal(r.status, 0, r.stderr); });

const badRecaps = [
  ['small whole percent is checked', 'The S&P 500 rose 2% on Friday.', /2%.*S&P 500/],
  ['dollar amount is checked', 'Oil gained 0.84% to $61 a barrel.', /\$61/],
  ['number tied to the wrong item', 'The Dow rose 10 points.', /10/],
  ['number with no item named', 'Stocks fell 1.00% on Friday.', /names no market item/],
  ['carried item still checked', 'The Dow fell. It lost 7% on the day.', /7%/],
  ['rose but fell', 'The Dow rose 1.00% on Friday.', /Dow.*"rose".*down/],
  ['fell but rose', 'Oil fell 0.84% to $60.00.', /Oil.*"fell".*up/],
  ['flat item said to rise', 'The Nasdaq rose on Friday.', /Nasdaq.*"rose".*unchanged/],
  ['direction per item in a mixed sentence', 'The S&P 500 fell while the Dow rose.', /"fell"|"rose"/],
  ['flat said of a mover', 'The Dow was flat on Friday.', /Dow.*"flat"/],
  ['rounding must match', 'The S&P 500 rose 1.5% on Friday.', /1\.5%/],
  ['yield value wrong', 'The 10-year yield rose to 4.25%.', /4\.25%/],
  ['basis points wrong', 'The 10-year yield rose 5 basis points.', /5 basis points/],
  ['bare large number wrong', 'The Dow closed at 2,500.', /2,500/],
  ['dxy value wrong', 'The dollar index rose 0.5%.', /0\.5%/],
];
for (const [name, t, re] of badRecaps) test(`market narrative fails: ${name}`, () => {
  const r = recap(t); assert.equal(r.status, 1, 'expected a failure for: ' + t); assert.match(r.stderr, re);
});

test('market narrative: failures are one line each', () => {
  const r = recap('The S&P 500 rose 2%. Gold fell 9%.');
  assert.equal(r.status, 1);
  assert.equal(r.stderr.split('\n').filter((l) => l.startsWith('  - ')).length, 2);
});

test('market narrative: cross-check skipped (exit 0, notice) for mock, missing or stale market.json when the recap quotes no numbers', () => {
  const body = "Stocks ended mixed at Friday's close on Nov. 21, 2026.";
  let d = liveMarketSandbox(body); edit(d, 'market.json', (m) => { m.mock = true; });
  const r = check(d); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /skipped/); rmSync(d, { recursive: true });
  d = liveMarketSandbox(body); rmSync(join(d, 'data/market.json'));
  assert.equal(check(d).status, 0); rmSync(d, { recursive: true });
  d = liveMarketSandbox(body); edit(d, 'digest.json', (g) => { g.sections.market.asOf = '2026-11-10'; });
  assert.equal(check(d, '2026-11-26T12:00:00Z').status, 0, 'asOf 5 days before today'); rmSync(d, { recursive: true });
});
test('market narrative: staleness is asOf vs the Central date (4 days fresh, 5 stale), not fetchedAt', () => {
  let d = liveMarketSandbox('The S&P 500 rose 9.9% on Friday.'); edit(d, 'market.json', (m) => { m.fetchedAt = '2020-01-01T00:00:00Z'; });
  assert.equal(check(d, '2026-11-25T23:00:00Z').status, 1, 'Central 11-25 is 4 days after 11-21: still checked'); rmSync(d, { recursive: true });
  d = liveMarketSandbox('The S&P 500 rose 9.9% on Friday.');
  const r5 = check(d, '2026-11-26T07:00:00Z'); assert.equal(r5.status, 1, '01:00 Central on 11-26 is 5 days: skipped, and a quoted number then fails'); assert.match(r5.stderr, /cannot be checked/); rmSync(d, { recursive: true });
  d = liveMarketSandbox('Stocks were mixed.');
  assert.equal(check(d, '2026-11-26T07:00:00Z').status, 0, 'skipped, no numbers quoted'); assert.equal(check(d, '2026-11-26T03:00:00Z').status, 0, 'checked, nothing to contradict'); rmSync(d, { recursive: true });
});
test('market narrative: when the check is skipped, a recap that quotes numbers fails', () => {
  for (const mut of [(d) => edit(d, 'market.json', (m) => { m.mock = true; }), (d) => rmSync(join(d, 'data/market.json'))]) {
    const d = liveMarketSandbox('The S&P 500 rose 1% to 1,000.00 on Nov. 21, 2026.'); mut(d);
    const r = check(d); assert.equal(r.status, 1); assert.match(r.stderr, /quotes 1,000\.00/); assert.match(r.stderr, /quotes 1,/);
    rmSync(d, { recursive: true });
  }
  const d = liveMarketSandbox('Stocks fell 2 percent.'); edit(d, 'market.json', (m) => { m.mock = true; });
  assert.equal(check(d).status, 1); rmSync(d, { recursive: true });
});
test('market narrative: a recap left unchanged this run (updatedAt != generatedAt) is exempt, even with stale market.json', () => {
  const body = 'The S&P 500 rose 9.9% to 5,000.00 on Nov. 10.';
  for (const mut of [() => {}, (d) => edit(d, 'market.json', (m) => { m.mock = true; }), (d) => rmSync(join(d, 'data/market.json'))]) {
    const d = liveMarketSandbox(body); mut(d);
    edit(d, 'digest.json', (g) => { g.sections.market.updatedAt = '2026-11-10T22:00:00Z'; g.sections.market.asOf = '2026-11-10'; });
    const r = check(d); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /not written this run/); rmSync(d, { recursive: true });
  }
  const d = liveMarketSandbox(body); edit(d, 'market.json', (m) => { m.mock = true; });
  assert.equal(check(d).status, 1, 'written this run (updatedAt == generatedAt) in skip mode: digits banned'); rmSync(d, { recursive: true });
});
test('market narrative: skip mode lets item labels through (S&P 500, 10-year) but still bans real numbers', () => {
  const ok = 'Stocks were mixed at the close. The S&P 500 and the 10-year yield barely moved on Nov. 21, 2026.';
  let d = liveMarketSandbox(ok); edit(d, 'market.json', (m) => { m.mock = true; });
  let r = check(d); assert.equal(r.status, 0, r.stderr); rmSync(d, { recursive: true });
  d = liveMarketSandbox('The S&P 500 and the 10-year yield rose 2%.'); edit(d, 'market.json', (m) => { m.mock = true; });
  r = check(d); assert.equal(r.status, 1); assert.match(r.stderr, /quotes 2\b/); assert.doesNotMatch(r.stderr, /quotes (500|10)\b/); rmSync(d, { recursive: true });
});
test('market narrative: direction adjectives without a tied number are not checked; verbs on the item and numbers still are', () => {
  for (const t of ['Oil prices were lower on Friday as stocks rallied.', 'Gold was higher, the Dow lower, in a quiet session.', 'Stocks rose on Friday; the dollar was down on the week.']) {
    const r = recap(t); assert.equal(r.status, 0, t + ' ' + r.stderr);
  }
  for (const [t, re] of [['The S&P 500 rose 0.4% on Friday.', /S&P 500/], ['The Dow rose on Friday.', /Dow.*"rose"/], ['Oil prices fell on Friday.', /"fell"/], ['Oil was lower at $60.00 on Friday.', /Oil.*"lower"/]]) {
    const r = recap(t); assert.equal(r.status, 1, t); assert.match(r.stderr, re);
  }
});
test('market narrative: fresh market.json with a different asOf still fails', () => {
  const d = liveMarketSandbox('Stocks were mixed.'); edit(d, 'digest.json', (g) => { g.sections.market.asOf = '2026-11-20'; });
  assert.equal(check(d).status, 1); rmSync(d, { recursive: true });
});

// ---------- market.json shape: item count and duplicates ----------
test('market.json with fewer than 7 items or a duplicate id is rejected', () => {
  let d = sandbox(); edit(d, 'market.json', (m) => { m.items.pop(); });
  let r = validate(d, ['--only', 'market']); assert.equal(r.status, 1); assert.match(r.stderr, /expected all 7/); rmSync(d, { recursive: true });
  d = sandbox(); edit(d, 'market.json', (m) => { m.items[1].id = 'sp500'; });
  r = validate(d, ['--only', 'market']); assert.equal(r.status, 1); assert.match(r.stderr, /duplicate item id "sp500"/); rmSync(d, { recursive: true });
});

// ---------- scripture bank ----------

test('repo bank is well formed and contains the mock verse', () => {
  const b = JSON.parse(readFileSync(join(root, 'data/scripture-bank.json'), 'utf8'));
  assert.ok(b.verses.length >= 150);
  const refs = b.verses.map((v) => v.reference);
  assert.equal(new Set(refs).size, refs.length, 'duplicate references');
  for (const v of b.verses) { assert.ok(b.themes.includes(v.theme), v.reference); assert.match(v.reference, /^([1-3] )?[A-Z][a-z]+( [A-Za-z]+)* \d+:\d+(-\d+)?$/, v.reference); }
});
test('digest scripture must be a bank reference with its own theme', () => {
  let d = sandbox(); edit(d, 'digest.json', (g) => { g.scripture.reference = 'Psalm 119:176'; });
  let r = validate(d, ['--only', 'digest']); assert.equal(r.status, 1); assert.match(r.stderr, /not in scripture-bank/); rmSync(d, { recursive: true });
  d = sandbox(); edit(d, 'digest.json', (g) => { g.scripture.theme = 'justice'; });
  r = validate(d, ['--only', 'digest']); assert.equal(r.status, 1); assert.match(r.stderr, /does not match the bank/); rmSync(d, { recursive: true });
});

// ---------- repo audit (rules from CLAUDE.md) ----------

import { readdirSync, statSync } from 'node:fs';
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === '.git' || n === 'node_modules' || n === '_site') continue;
    const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
test('audit: no secrets or keys in the repo', () => {
  const pat = /(sk-ant-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{16,})/i;
  for (const f of walk(root)) {
    if (/\.(png|jpg|ico|woff2?)$/.test(f)) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), pat, f);
  }
});
test('audit: site files use relative paths only', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)="\/(?!\/)/);
  const js = readFileSync(join(root, 'assets/app.js'), 'utf8');
  assert.doesNotMatch(js, /fetch\(\s*['"`]\//);
  assert.doesNotMatch(js, /['"`]\/(data|assets)\//);
  assert.doesNotMatch(readFileSync(join(root, 'assets/style.css'), 'utf8'), /url\(\s*['"]?\//);
});
test('audit: no trackers, frameworks or third-party scripts on the page', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  assert.doesNotMatch(html, /google-analytics|googletagmanager|plausible|segment\.com|hotjar/i);
  assert.equal(existsSync(join(root, 'package.json')) && /"(react|vue|svelte|webpack|vite)"/.test(readFileSync(join(root, 'package.json'), 'utf8')), false);
});
test('audit: page markup has no images, tables or canvases (words only)', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<(img|table|canvas|svg|picture|video)\b/i);
});
test('audit: KJV note and "not investment advice" stay in the footer', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /King James Version \(KJV\)[^<]*public domain/i);
  assert.match(html, /not investment advice/i);
});
test('audit: task prompt references only files and commands that exist', () => {
  const p = readFileSync(join(root, 'task/daily-digest-prompt.md'), 'utf8');
  for (const m of p.match(/`((?:config|data|docs|scripts)\/[A-Za-z0-9._-]+)`/g) || []) {
    const f = m.replace(/`/g, '');
    assert.ok(existsSync(join(root, f)), `${f} is mentioned in the prompt but missing`);
  }
});

// ---------- tone lint ----------

function lint(bodyText, headline = 'Congress passes a funding bill') {
  const d = sandbox();
  edit(d, 'digest.json', (g) => { g.sections.federal.headline = headline; g.sections.federal.body = [bodyText]; });
  const r = spawnSync('node', [join(root, 'scripts/lint-tone.mjs'), '--file', join(d, 'data/digest.json')], { encoding: 'utf8' });
  rmSync(d, { recursive: true }); return r;
}
test('tone lint: neutral wording passes', () => {
  const r = lint('The Senate voted 62 to 38 on Tuesday to pass a funding bill, according to the AP. Supporters said it avoids a shutdown; opponents said it spends too much.');
  assert.equal(r.status, 0, r.stderr);
});
test('tone lint: loaded wording, first person and predictions are flagged', () => {
  const r = lint('The senator slammed the bill. We think it will likely fail! The vote was shocking.');
  assert.equal(r.status, 1);
  for (const w of ['slammed', 'We', 'will likely', '!', 'shocking']) assert.ok(r.stderr.includes(w), w);
});
