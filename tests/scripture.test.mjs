// Scripture fetch and bank checks. Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const root = new URL('..', import.meta.url).pathname;
const bank = JSON.parse(readFileSync(join(root, 'data/scripture-bank.json'), 'utf8'));

function fakeSource(handler) {
  return new Promise((resolve) => { const s = createServer(handler).listen(0, '127.0.0.1', () => resolve(s)); });
}
function run(script, args, base) {
  return new Promise((resolve) => {
    const p = spawn('node', [join(root, script), ...args], { env: { ...process.env, SCRIPTURE_API_BASE: base } });
    let out = '', err = '';
    p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
function digestDir(reference = 'Psalm 46:1') {
  const d = mkdtempSync(join(tmpdir(), 'btg-scr-'));
  mkdirSync(join(d, 'data'));
  writeFileSync(join(d, 'data/digest.json'), JSON.stringify({ scripture: { reference, theme: 'comfort' } }));
  return d;
}
const fetchArgs = (d) => ['--digest', join(d, 'data/digest.json'), '--out', join(d, 'out/scripture.json')];

// ---------- fetch-scripture: translation_id is required ----------

for (const [name, body, expectMsg] of [
  ['missing translation_id', { reference: 'Psalm 46:1', text: 'God is our refuge.' }, /translation \(none\), expected kjv/],
  ['empty translation_id', { reference: 'Psalm 46:1', text: 'God is our refuge.', translation_id: '' }, /translation \(none\), expected kjv/],
  ['non-string translation_id', { reference: 'Psalm 46:1', text: 'God is our refuge.', translation_id: null }, /expected kjv/],
]) {
  test(`fetch-scripture refuses a response with ${name}`, async () => {
    const d = digestDir();
    const s = await fakeSource((req, res) => res.end(JSON.stringify(body)));
    const r = await run('scripts/fetch-scripture.mjs', fetchArgs(d), `http://127.0.0.1:${s.address().port}`);
    s.close();
    assert.equal(r.code, 0, 'must not fail the deploy');
    assert.equal(existsSync(join(d, 'out/scripture.json')), false, 'must not write a file');
    assert.match(r.err, expectMsg);
    rmSync(d, { recursive: true });
  });
}

test('fetch-scripture accepts translation_id "KJV" in any case', async () => {
  const d = digestDir();
  const s = await fakeSource((req, res) => res.end(JSON.stringify({ reference: 'Psalm 46:1', text: 'God is our refuge.', translation_id: 'KJV' })));
  const r = await run('scripts/fetch-scripture.mjs', fetchArgs(d), `http://127.0.0.1:${s.address().port}`);
  s.close();
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(readFileSync(join(d, 'out/scripture.json'), 'utf8')).translation, 'KJV');
  rmSync(d, { recursive: true });
});

// ---------- bank content ----------

const PROMPT_THEMES = ['comfort', 'peace', 'strength', 'hope', 'trust', 'justice', 'wisdom', 'guidance', 'mercy', 'courage', 'provision', 'love-neighbor', 'gratitude', 'prayer', 'sovereignty'];

test('bank themes cover every theme the task prompt uses, each with at least 10 verses', () => {
  for (const t of PROMPT_THEMES) {
    assert.ok(bank.themes.includes(t), `theme ${t} missing from themes list`);
    const n = bank.verses.filter((v) => v.theme === t).length;
    assert.ok(n >= 10,`theme ${t} has only ${n} verses`);
  }
  assert.ok(bank.verses.length >= 150);
});

test('bank entries have only known fields', () => {
  for (const v of bank.verses) {
    for (const k of Object.keys(v)) assert.ok(['reference', 'theme'].includes(k), `${v.reference}: unexpected field ${k}`);
  }
});

test('bank has no overlapping passages (same chapter, shared verse)', () => {
  const span = (r) => { const m = r.match(/^(.*) (\d+):(\d+)(?:-(\d+))?$/); return { book: m[1], ch: m[2], a: +m[3], b: +(m[4] || m[3]) }; };
  const all = bank.verses.map((v) => ({ ref: v.reference, ...span(v.reference) }));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const x = all[i], y = all[j];
    if (x.book === y.book && x.ch === y.ch) assert.ok(x.b < y.a || y.b < x.a, `${x.ref} overlaps ${y.ref}`);
  }
});

// References QA flagged as readable as judgment, vengeance or taking a political side.
// They must not come back into the bank without a fresh pastoral review.
const RETIRED = [
  'Psalm 33:10-11', 'Isaiah 40:22-23', 'Proverbs 21:1', 'Romans 13:1', 'Psalm 9:7-8', 'Romans 12:19',
  'Daniel 2:21', 'Daniel 4:35', 'Psalm 135:6', 'Psalm 47:7-8', 'Acts 17:26', 'Romans 8:31', 'Psalm 118:6',
  'Psalm 37:28', 'Psalm 37:25', 'Psalm 34:10', 'Deuteronomy 31:6', 'Exodus 15:2', 'Isaiah 43:2', 'Isaiah 66:13',
  'Psalm 125:1', 'Jeremiah 29:11', 'Mark 11:24',
  // Final QA, 2026-11-23: war/nations wording, approval of outcomes, or promised
  // deliverance/answers that read badly after a death.
  'Psalm 46:10', 'Romans 8:28', 'Psalm 50:15', '1 Timothy 2:1-2', 'Matthew 7:7', '1 John 5:14',
  'Psalm 55:22', 'Jeremiah 33:3', 'James 5:16', 'Psalm 115:3',
];
test('retired references stay out of the bank', () => {
  const refs = new Set(bank.verses.map((v) => v.reference));
  for (const r of RETIRED) assert.ok(!refs.has(r), `${r} is back in the bank`);
});

// ---------- check-bank ----------

function bankFile(verses) {
  const d = mkdtempSync(join(tmpdir(), 'btg-bank-'));
  writeFileSync(join(d, 'bank.json'), JSON.stringify({ themes: ['comfort'], verses }));
  return d;
}

test('check-bank passes good references and flags wrong translation, reference and length', async () => {
  const d = bankFile([
    { reference: 'Psalm 46:1', theme: 'comfort' },
    { reference: 'Psalm 23:4', theme: 'comfort' },
    { reference: 'John 14:27', theme: 'comfort' },
    { reference: 'Matthew 5:4', theme: 'comfort' },
  ]);
  const s = await fakeSource((req, res) => {
    const ref = decodeURIComponent(req.url.slice(1).split('?')[0]);
    if (ref === 'Psalm 46:1') return res.end(JSON.stringify({ reference: 'Psalms 46:1', text: 'God is our refuge.', translation_id: 'kjv' }));
    if (ref === 'Psalm 23:4') return res.end(JSON.stringify({ reference: 'Psalms 23:4', text: 'x' }));
    if (ref === 'John 14:27') return res.end(JSON.stringify({ reference: 'John 14:28', text: 'x', translation_id: 'kjv' }));
    return res.end(JSON.stringify({ reference: ref, text: 'y'.repeat(500), translation_id: 'kjv' }));
  });
  const r = await run('scripts/check-bank.mjs', ['--bank', join(d, 'bank.json'), '--delay-ms', '0'], `http://127.0.0.1:${s.address().port}`);
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /1 of 4 references fine/);
  assert.match(r.out, /Psalm 23:4: translation \(none\)/);
  assert.match(r.out, /John 14:27: source returned reference "John 14:28"/);
  assert.match(r.out, /Matthew 5:4: long \(500 chars\)/);
  assert.doesNotMatch(r.out, /Psalm 46:1:/);
  rmSync(d, { recursive: true });
});

test('check-bank refuses duplicates and unknown themes before fetching', async () => {
  const d = bankFile([
    { reference: 'Psalm 46:1', theme: 'comfort' },
    { reference: 'Psalm 46:1', theme: 'comfort' },
    { reference: 'Psalm 23:4', theme: 'vengeance' },
  ]);
  let hits = 0;
  const s = await fakeSource((req, res) => { hits++; res.end('{}'); });
  const r = await run('scripts/check-bank.mjs', ['--bank', join(d, 'bank.json'), '--delay-ms', '0'], `http://127.0.0.1:${s.address().port}`);
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /Psalm 46:1: duplicate reference/);
  assert.match(r.out, /Psalm 23:4: theme "vengeance"/);
  assert.equal(hits, 0);
  rmSync(d, { recursive: true });
});
