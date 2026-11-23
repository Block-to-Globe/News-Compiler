#!/usr/bin/env node
// Tone lint for the news sections: flags loaded wording, first person, predictions and
// exclamation marks so the scheduled task can rewrite before it pushes. Advisory only
// (exit 1 when anything is flagged; the deploy never runs this).
// Usage: node scripts/lint-tone.mjs [--file data/digest.json]
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : 'data/digest.json';
const d = JSON.parse(readFileSync(file, 'utf8'));

const RULES = [
  [/\b(slams?|slammed|blasts?|blasted|rips?|ripped|destroys?|destroyed|eviscerates?|lashes out|fires back|bombshell|shocking|stunning|outrageous|disastrous|catastrophic|radical|extremist|so-called|regime|crony|cronies|scandal-plagued|embattled|controversial)\b/i, 'loaded or dramatic wording'],
  [/\b(I|We|we|Our|our|My|my)\b(?![.-])| us\b/, 'first person'],
  [/\b(will (likely|surely|definitely|certainly)|is sure to|is bound to|expected to win|set to (win|lose)|will undoubtedly)\b/i, 'prediction stated as fact'],
  [/!/, 'exclamation mark'],
  [/\b(clearly|obviously|of course|undeniably|everyone knows|it is no secret)\b/i, 'asserts what the sources did not'],
  [/\b(should|must) (be|do|stop|resign|act)\b/i, 'opinion or advice'],
];
const flags = [];
for (const [k, s] of Object.entries(d.sections || {})) {
  if (!s || s.mock === true) continue;
  const parts = [['headline', s.headline], ...(s.body || []).map((b, i) => ['body[' + i + ']', b])];
  for (const [where, t] of parts) {
    if (typeof t !== 'string') continue;
    for (const [re, why] of RULES) for (const m of t.matchAll(new RegExp(re.source, re.flags + 'g'))) flags.push(`${k}.${where}: "${m[0]}" (${why})`);
  }
}
if (flags.length) { console.error('Tone lint flagged:'); for (const f of flags) console.error('  - ' + f); process.exit(1); }
console.log('tone: ok');
