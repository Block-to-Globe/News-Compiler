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
  const r = validate(d);
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

function liveMarketSandbox(bodyText) {
  const d = sandbox();
  const r = (cpSync(join(root, 'data/market.json'), join(d, 'data/market.json')), 0);
  edit(d, 'market.json', (m) => { delete m.mock; m.source = 'test'; });
  edit(d, 'digest.json', (g) => { g.sections.market = { asOf: '2026-11-21', body: [bodyText], updatedAt: g.generatedAt }; });
  return d;
}
test('market narrative: numbers that match market.json pass', () => {
  const d = liveMarketSandbox('The S&P 500 rose 1.00% to 1,000.00 on Friday. Oil gained 0.84% to $60.00 and the dollar index held at 100.');
  const r = validate(d, ['--only', 'digest', '--check-market']);
  assert.equal(r.status, 0, r.stderr); rmSync(d, { recursive: true });
});
test('market narrative: a number not in market.json fails', () => {
  const d = liveMarketSandbox('The S&P 500 rose 1.7% to 1,000.00 on Friday.');
  const r = validate(d, ['--only', 'digest', '--check-market']);
  assert.equal(r.status, 1); assert.match(r.stderr, /1\.7/); rmSync(d, { recursive: true });
});
test('market narrative: asOf mismatch fails', () => {
  const d = liveMarketSandbox('Stocks were mixed.');
  edit(d, 'digest.json', (g) => { g.sections.market.asOf = '2026-11-20'; });
  const r = validate(d, ['--only', 'digest', '--check-market']);
  assert.equal(r.status, 1); assert.match(r.stderr, /asOf/); rmSync(d, { recursive: true });
});
test('market narrative: live section with mock market.json fails', () => {
  const d = liveMarketSandbox('Stocks were mixed.');
  edit(d, 'market.json', (m) => { m.mock = true; });
  assert.equal(validate(d, ['--only', 'digest', '--check-market']).status, 1); rmSync(d, { recursive: true });
});

test('market narrative cross-check is off unless --check-market is passed (deploys never fail on it)', () => {
  const d = liveMarketSandbox('The S&P 500 rose 9.9% on Friday.');
  assert.equal(validate(d, ['--only', 'digest']).status, 0);
  rmSync(d, { recursive: true });
});
