#!/usr/bin/env node
// Tone lint for the digest: flags loaded wording, first person, predictions, opinion,
// exclamation marks and long direct quotes so the scheduled task can rewrite before it pushes.
// Checks every live section's headline, body and source titles, plus the scripture `why` line.
// Text inside double quotes (straight "..." or curly “...”) is skipped, so a short attributed
// quote can carry a speaker's own word; quotes of 8 or more words are flagged instead.
// Advisory only (exit 1 when anything is flagged; the deploy never runs this).
// Usage: node scripts/lint-tone.mjs [--file data/digest.json]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LOADED = /\b(slams?|slammed|blasts?|blasted|rips?|ripped|destroys?|destroyed|eviscerates?|lashes out|fires back|bombshell|shocking|stunning|outrageous|disastrous|catastrophic|radical|extremist|so-called|regime|crony|cronies|scandal-plagued|embattled|controversial)\b/i;
// Capitalized words that commonly come right before a first-person "I" at the start of a clause.
// After any other capitalized word, "I" is read as a Roman numeral (World War I, Henry I, Phase I, Title I).
const BEFORE_FIRST_PERSON_I = new Set(['and', 'but', 'so', 'then', 'now', 'today', 'yesterday', 'tomorrow', 'here', 'there', 'when', 'if', 'as', 'still', 'also', 'yes', 'no', 'well', 'sometimes', 'often']);

const RULES = [
  [LOADED, 'loaded or dramatic wording'],
  [/\bI\b(?![.-])|\b(We|we|Our|our|My|my|Me|me|us)\b/, 'first person'],
  [/\b(will (likely|surely|definitely|certainly)|is sure to|is bound to|expected to win|set to (win|lose)|will undoubtedly)\b/i, 'prediction stated as fact'],
  [/!/, 'exclamation mark'],
  [/\b(clearly|obviously|of course|undeniably|everyone knows|it is no secret)\b/i, 'asserts what the sources did not'],
  [/\b(should|must) (be|do|stop|resign|act)\b/i, 'opinion or advice'],
  // Spin rules. Each targets a pattern that adds judgment the facts do not carry.
  [/\b(insist(s|ed)?|tout(s|ed)?|boast(s|ed)?|bragg?(s|ed)?|lament(s|ed)?|decr(y|ies|ied)|vow(s|ed)?|warn(s|ed)?)\b|\b(claim(s|ed|ing)?|admit(s|ted)?|concede(s|d)?) that\b|\b(falsely|wrongly|baselessly) (claim|said|say)/i, 'loaded attribution verb; use "said"'],
  [/\b(massive|huge|sweeping|unprecedented|dramatic(ally)?|devastating|staggering|alarming|troubling|crackdown|firestorm|backlash|chaos|chaotic|brutal|draconian|hard-?line|far-(right|left)|beleaguered|blockbuster|surprising(ly)?|unexpected(ly)?|landmark (ruling|decision|law|bill|deal|case|agreement)|historic(?! (district|site|home|house|building|church|marker|preservation|commission)))\b/i, 'characterization; state the fact or number instead'],
  [/\b(in an? (bid|effort|attempt) to|aimed at|designed to|apparently|seemingly)\b/i, 'motive or intent; attribute it to whoever stated it, or drop it'],
  [/\b(in a (blow|win|victory|setback) (to|for)|a (win|victory|setback|blow) for|dealt a (blow|setback)|raising (questions|concerns|eyebrows)|sparking (outrage|fury|backlash|concern)|amid (growing|mounting|rising) (concerns?|criticism|pressure|questions|fears|anger|outrage))\b/i, 'framing; report what happened, not what it means'],
  [/\b(critics|opponents|supporters|observers|experts|analysts|some|many) (say|said|argue[sd]?|believe[sd]?|fear(s|ed)?|worr(y|ied)|warn(s|ed)?)\b/i, 'unnamed group; name who said it or drop it'],
  [/\b(poised to|(?<!(less|more|as|most|least) )likely to|is widely expected|on track to|could (soon|eventually)|may (soon|eventually))\b/i, 'speculation; report only what has happened or is scheduled'],
];
// Global copies, built once (matchAll needs the g flag; a fresh RegExp per call was wasted work).
const RULES_G = RULES.map(([re, why]) => [new RegExp(re.source, re.flags + 'g'), why]);

const QUOTED = /"[^"]*"|“[^”]*”/g;

// Replace quoted spans with spaces (same length) so match positions still line up.
function maskQuotes(t) {
  return t.replace(QUOTED, (q) => ' '.repeat(q.length));
}

function isRomanNumeralI(text, index) {
  const before = text.slice(0, index);
  const m = before.match(/([A-Z][A-Za-z'’]*)\s+$/);
  if (!m) return false;
  return !BEFORE_FIRST_PERSON_I.has(m[1].toLowerCase());
}

export function lintText(t) {
  const out = [];
  if (typeof t !== 'string') return out;
  const masked = maskQuotes(t);
  for (const [re, why] of RULES_G) {
    for (const m of masked.matchAll(re)) {
      if (m[0] === 'I' && isRomanNumeralI(masked, m.index)) continue;
      out.push([m[0], why]);
    }
  }
  for (const q of t.match(QUOTED) || []) {
    const words = q.slice(1, -1).trim().split(/\s+/).filter(Boolean);
    if (words.length >= 8) out.push([q, 'direct quote of 8 or more words; paraphrase it']);
  }
  return out;
}

export function lintDigest(d) {
  const flags = [];
  const add = (where, t) => { for (const [hit, why] of lintText(t)) flags.push(`${where}: "${hit}" (${why})`); };
  for (const [k, s] of Object.entries(d.sections || {})) {
    if (!s || s.mock === true) continue;
    add(`${k}.headline`, s.headline);
    (Array.isArray(s.body) ? s.body : []).forEach((b, i) => add(`${k}.body[${i}]`, b));
    (Array.isArray(s.sources) ? s.sources : []).forEach((src, i) => add(`${k}.sources[${i}].title`, src && src.title));
  }
  if (d.scripture && typeof d.scripture === 'object') add('scripture.why', d.scripture.why);
  return flags;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : 'data/digest.json';
  const flags = lintDigest(JSON.parse(readFileSync(file, 'utf8')));
  if (flags.length) { console.error('Tone lint flagged:'); for (const f of flags) console.error('  - ' + f); process.exit(1); }
  console.log('tone: ok');
}
