// Tone lint unit and CLI tests. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintText, lintDigest } from '../scripts/lint-tone.mjs';

const root = new URL('..', import.meta.url).pathname;
const fixture = () => JSON.parse(readFileSync(join(root, 'tests/fixtures/digest.full.json'), 'utf8'));
const hits = (t) => lintText(t).map(([h]) => h);

// ---------- Roman numerals and names ----------
for (const t of [
  'Veterans of World War I were honored at a ceremony on Monday.',
  'The memorial recalls Pope John Paul I, according to the Vatican.',
  'Historians said the charter dates to Henry I of England.',
  'The drug entered a Phase I trial, the company said.',
  'Phase I of the project starts in March, officials said.',
  'The district receives Title I funding, the board said.',
  'Traffic on I-40 was slowed by a crash, police said.',
]) {
  test(`tone: Roman numeral or name "I" is not first person: ${t}`, () => {
    assert.deepEqual(hits(t), []);
  });
}
for (const t of ['I think the bill is a mistake.', 'Then I asked the mayor.', 'The vote, I believe, was close.', 'We saw the results.', 'The mayor told us that.', 'It surprised me.']) {
  test(`tone: real first person is still flagged: ${t}`, () => {
    assert.ok(lintText(t).some(([, why]) => why === 'first person'), JSON.stringify(lintText(t)));
  });
}

// ---------- quotes ----------
test('tone: loaded word inside straight double quotes is skipped', () => {
  assert.deepEqual(hits('The minister called the government a "regime," Reuters reported.'), []);
});
test('tone: loaded word inside curly double quotes is skipped', () => {
  assert.deepEqual(hits('The senator described the ruling as “outrageous,” according to the AP.'), []);
});
test('tone: loaded word outside quotes is still flagged', () => {
  assert.deepEqual(hits('The regime announced new limits on Monday.'), ['regime']);
  assert.deepEqual(hits('Officials "met" on what was a shocking day.'), ['shocking']);
});
test('tone: first person inside a quote is skipped', () => {
  assert.deepEqual(hits('The mayor said, "We will fix the roads," at a news conference.'), []);
});
test('tone: unbalanced quote does not hide the rest of the text', () => {
  assert.deepEqual(hits('The 6" pipe burst in a stunning failure, MLGW said.'), ['stunning']);
});
test('tone: quotes of 8 or more words are flagged as too long', () => {
  const r = lintText('The governor said "this plan will help every family in the state today," the AP reported.');
  assert.ok(r.some(([, why]) => /8 or more words/.test(why)));
  assert.deepEqual(lintText('The governor said the plan is "a good first step," the AP reported.'), []);
});

// ---------- scripture why and source titles ----------
test('tone: scripture why and source titles are linted', () => {
  const d = fixture();
  d.scripture.why = 'We need this word after a shocking day.';
  d.sections.federal.sources[0].title = 'Senator slams funding bill';
  const flags = lintDigest(d).join('\n');
  assert.match(flags, /scripture\.why: "We"/);
  assert.match(flags, /scripture\.why: "shocking"/);
  assert.match(flags, /federal\.sources\[0\]\.title: "slams"/);
});
test('tone: neutral why and titles pass; missing why is fine', () => {
  const d = fixture();
  d.scripture.why = 'A reminder of steady comfort on a hard day.';
  assert.deepEqual(lintDigest(d), []);
  delete d.scripture.why;
  assert.deepEqual(lintDigest(d), []);
});
test('tone: mock sections are skipped', () => {
  const d = fixture();
  d.sections.local = { mock: true };
  assert.deepEqual(lintDigest(d), []);
});

// ---------- CLI ----------
test('tone CLI: exits 1 and names the field for a flagged source title', () => {
  const dir = mkdtempSync(join(tmpdir(), 'btg-tone-'));
  const d = fixture();
  d.sections.state.sources[0].title = 'Lawmakers blast new rule';
  writeFileSync(join(dir, 'digest.json'), JSON.stringify(d));
  const r = spawnSync('node', [join(root, 'scripts/lint-tone.mjs'), '--file', join(dir, 'digest.json')], { encoding: 'utf8' });
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /state\.sources\[0\]\.title: "blast"/);
});
test('tone CLI: clean fixture prints tone: ok', () => {
  const r = spawnSync('node', [join(root, 'scripts/lint-tone.mjs'), '--file', join(root, 'tests/fixtures/digest.full.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /tone: ok/);
});

// ---------- prompt guards (items QA asked for stay in the prompt) ----------
test('prompt: keeps the market date, fail-safe, scripture and originality rules', () => {
  const p = readFileSync(join(root, 'task/daily-digest-prompt.md'), 'utf8');
  assert.match(p, /TZ=America\/Chicago date/);
  assert.match(p, /Markets were closed <today's weekday>; these are <asOf weekday>'s closes/);
  assert.match(p, /Do not rely on `marketStatus` or `note` alone/);
  assert.match(p, /one item per number/);
  assert.match(p, /skips the market cross-check/);
  assert.match(p, /only `comfort`, `peace` or `prayer`/);
  assert.match(p, /Never `sovereignty`, `justice` or `gratitude`/);
  assert.match(p, /never to any outcome or person/);
  assert.match(p, /Never imply punishment or vengeance/);
  assert.match(p, /Do not use the word "judgment" in a `why`/);
  assert.match(p, /Israel, Zion or Jerusalem/);
  assert.match(p, /Never connect the verse to a candidate, party, ruling or vote result/);
  assert.match(p, /last 30 days/);
  assert.match(p, /git fetch --unshallow/);
  assert.match(p, /different theme/);
  assert.match(p, /under 8 words/);
  assert.match(p, /Rewrite headlines in your own words/);
  assert.match(p, /exactly the same string\*\* as `generatedAt`/);
  assert.match(p, /keeps its old `updatedAt`/);
  assert.match(p, /no digits and no direction words/);
});

test('prompt: keeps the Federal/International sourcing and paywall rules', () => {
  const p = readFileSync(join(root, 'task/daily-digest-prompt.md'), 'utf8');
  assert.match(p, /Two sources before fact/);
  assert.match(p, /at least two independent working outlets/);
  assert.match(p, /one official primary source/);
  assert.match(p, /attributed to that outlet by name/);
  assert.match(p, /not just one feed/);
  assert.match(p, /Report official statements as statements \("the White House said"\), never as established fact/);
  assert.match(p, /record it in `notes`/);
  assert.match(p, /nothing beyond the headline and the public listing text/);
});
