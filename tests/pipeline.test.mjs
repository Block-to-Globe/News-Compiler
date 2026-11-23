// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const root = new URL('..', import.meta.url).pathname;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'btg-'));
  cpSync(join(root, 'data'), join(dir, 'data'), { recursive: true });
  return dir;
}
function validate(dir, extra = []) {
  return spawnSync('node', [join(root, 'scripts/validate.mjs'), '--dir', join(dir, 'data'), ...extra], { encoding: 'utf8' });
}
function edit(dir, file, fn) {
  const p = join(dir, 'data', file);
  const o = JSON.parse(readFileSync(p, 'utf8')); fn(o); writeFileSync(p, JSON.stringify(o, null, 2));
}

test('mock data passes validation', () => {
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
