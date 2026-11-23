#!/usr/bin/env node
// Validates the data files against docs/digest-schema.md. No dependencies.
//
// Usage: node scripts/validate.mjs [--dir data] [--only digest,market,scripture,history] [--check-market]
//                                  [--max-age-hours 26]
// Exit code 0 = all good, 1 = at least one error (errors printed one per line).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
function opt(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const DIR = opt('--dir', 'data');
const ONLY = opt('--only', 'digest,market,scripture,history').split(',');
const MAX_AGE_H = opt('--max-age-hours', null);
// Clock override for the market freshness test (tests only).
const NOW_MS = opt('--now', null) ? Date.parse(opt('--now', null)) : Date.now();
// Cross-check the market recap against market.json. Only the scheduled task passes this:
// the deploy must not fail just because market.json moved on after the recap was written.
const CHECK_MARKET = args.includes('--check-market');

const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HTMLISH = /[<>]/;

function load(name) {
  const p = join(DIR, `${name}.json`);
  if (!existsSync(p)) { err(name + '.json', 'file is missing'); return null; }
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { err(name + '.json', 'not valid JSON (' + e.message + ')'); return null; }
}

function text(file, path, v, max) {
  if (!isStr(v)) { err(file, `${path} must be a non-empty string`); return; }
  if (HTMLISH.test(v)) err(file, `${path} must not contain "<" or ">" (no HTML)`);
  if (max && v.length > max) err(file, `${path} is ${v.length} chars, max ${max}`);
}

function url(file, path, v) {
  if (!isStr(v) || !/^https:\/\/[^\s<>"']+$/.test(v)) err(file, `${path} must be an https URL`);
}

function ts(file, path, v) {
  if (!isStr(v) || !ISO_TS.test(v) || Number.isNaN(Date.parse(v))) err(file, `${path} must be an ISO 8601 timestamp with offset`);
}

function body(file, path, b) {
  if (!Array.isArray(b) || b.length < 1 || b.length > 2) { err(file, `${path} must be an array of 1 to 2 paragraphs`); return; }
  b.forEach((t, i) => text(file, `${path}[${i}]`, t, 700));
}

function sources(file, path, s, { required }) {
  if (s === undefined && !required) return;
  if (!Array.isArray(s) || (required && (s.length < 1)) || s.length > 5) {
    err(file, `${path} must be an array of ${required ? '1' : '0'} to 5 sources`); return;
  }
  s.forEach((x, i) => {
    if (!isObj(x)) { err(file, `${path}[${i}] must be an object`); return; }
    text(file, `${path}[${i}].title`, x.title);
    text(file, `${path}[${i}].outlet`, x.outlet);
    url(file, `${path}[${i}].url`, x.url);
  });
}

function section(file, key, s) {
  const p = `sections.${key}`;
  if (!isObj(s)) { err(file, `${p} is missing`); return; }
  if (s.mock === true) return; // placeholder for a section that is not live yet
  text(file, `${p}.headline`, s.headline, 90);
  body(file, `${p}.body`, s.body);
  sources(file, `${p}.sources`, s.sources, { required: true });
  if (s.quiet !== undefined && typeof s.quiet !== 'boolean') err(file, `${p}.quiet must be a boolean`);
  ts(file, `${p}.updatedAt`, s.updatedAt);
}

function digest(d) {
  const f = 'digest.json';
  if (!isObj(d)) { err(f, 'must be a JSON object'); return; }
  if (d.schemaVersion !== 1) err(f, 'schemaVersion must be 1');
  ts(f, 'generatedAt', d.generatedAt);
  if (MAX_AGE_H && ISO_TS.test(d.generatedAt || '')) {
    const ageH = (Date.now() - Date.parse(d.generatedAt)) / 3.6e6;
    if (ageH > Number(MAX_AGE_H)) err(f, `generatedAt is ${ageH.toFixed(1)} hours old (max ${MAX_AGE_H})`);
    if (ageH < -1) err(f, 'generatedAt is in the future');
  }
  if (!isObj(d.sections)) { err(f, 'sections is missing'); return; }
  for (const k of ['local', 'state', 'federal', 'international']) section(f, k, d.sections[k]);

  const m = d.sections.market;
  if (!isObj(m)) err(f, 'sections.market is missing');
  else if (m.mock !== true) {
    if (!isStr(m.asOf) || !YMD.test(m.asOf)) err(f, 'sections.market.asOf must be YYYY-MM-DD');
    body(f, 'sections.market.body', m.body);
    sources(f, 'sections.market.sources', m.sources, { required: false });
    ts(f, 'sections.market.updatedAt', m.updatedAt);
  }

  const s = d.scripture;
  if (!isObj(s)) err(f, 'scripture is missing');
  else {
    if (!isStr(s.reference) || !/^([1-3] )?[A-Z][A-Za-z]+( [A-Za-z]+)* \d+(:\d+(-\d+)?)?$/.test(s.reference)) err(f, 'scripture.reference must look like "Psalm 46:1-3"');
    text(f, 'scripture.theme', s.theme);
    checkBank(f, s);
    if (s.why !== undefined) text(f, 'scripture.why', s.why, 160);
  }
  if (d.notes !== undefined && !(Array.isArray(d.notes) && d.notes.every(isStr))) err(f, 'notes must be an array of strings');
  return d;
}

// The verse must come from the reference bank (data/scripture-bank.json) with its own theme.
function checkBank(f, s) {
  const p = join(DIR, 'scripture-bank.json');
  if (!existsSync(p)) return; // the bank is optional until P6 is finished
  let bank;
  try { bank = JSON.parse(readFileSync(p, 'utf8')); } catch { err('scripture-bank.json', 'not valid JSON'); return; }
  if (!bank || !Array.isArray(bank.verses)) { err('scripture-bank.json', 'verses must be an array'); return; }
  const hit = bank.verses.find((v) => v.reference === s.reference);
  if (!hit) err(f, `scripture.reference "${s.reference}" is not in scripture-bank.json`);
  else if (hit.theme !== s.theme) err(f, `scripture.theme "${s.theme}" does not match the bank ("${hit.theme}") for ${s.reference}`);
}

function market(m) {
  const f = 'market.json';
  if (!isObj(m)) { err(f, 'must be a JSON object'); return; }
  if (m.schemaVersion !== 1) err(f, 'schemaVersion must be 1');
  ts(f, 'fetchedAt', m.fetchedAt);
  if (!isStr(m.asOf) || !YMD.test(m.asOf)) err(f, 'asOf must be YYYY-MM-DD');
  if (!['open', 'closed', 'weekend', 'holiday'].includes(m.marketStatus)) err(f, 'marketStatus must be open, closed, weekend or holiday');
  if (m.note !== undefined) text(f, 'note', m.note);
  text(f, 'source', m.source);
  if (!Array.isArray(m.items) || m.items.length === 0) { err(f, 'items must be a non-empty array'); return; }
  const ids = ['sp500', 'dow', 'nasdaq', 'us10y', 'wti', 'gold', 'dxy'];
  if (m.items.length < ids.length) err(f, `items has ${m.items.length} entries, expected all ${ids.length}`);
  const seen = new Set();
  for (const it of m.items) if (isObj(it)) { if (seen.has(it.id)) err(f, `duplicate item id "${it.id}"`); seen.add(it.id); }
  m.items.forEach((it, i) => {
    if (!isObj(it)) { err(f, `items[${i}] must be an object`); return; }
    if (!ids.includes(it.id)) err(f, `items[${i}].id "${it.id}" is not a known id`);
    text(f, `items[${i}].label`, it.label);
    for (const k of ['value', 'change', 'changePct']) if (!isNum(it[k])) err(f, `items[${i}].${k} must be a number`);
    if (isNum(it.value) && it.value <= 0) err(f, `items[${i}].value must be above zero`);
    if (!['points', 'percent', 'usd', 'index'].includes(it.unit)) err(f, `items[${i}].unit is not recognised`);
  });
}

function scripture(s, d) {
  const f = 'scripture.json';
  if (!isObj(s)) { err(f, 'must be a JSON object'); return; }
  if (s.schemaVersion !== 1) err(f, 'schemaVersion must be 1');
  ts(f, 'fetchedAt', s.fetchedAt);
  text(f, 'reference', s.reference);
  if (s.translation !== 'KJV') err(f, 'translation must be "KJV"');
  text(f, 'text', s.text, 1200);
  if (isObj(d) && isObj(d.scripture) && s.reference !== d.scripture.reference)
    err(f, `reference "${s.reference}" does not match digest.json scripture.reference "${d.scripture.reference}"`);
}

function history(h) {
  const f = 'history.json';
  if (!isObj(h)) { err(f, 'must be a JSON object'); return; }
  if (h.schemaVersion !== 1) err(f, 'schemaVersion must be 1');
  if (!isStr(h.date) || !YMD.test(h.date)) err(f, 'date must be YYYY-MM-DD');
  if (!Number.isInteger(h.year)) err(f, 'year must be an integer');
  text(f, 'text', h.text, 400);
  url(f, 'url', h.url);
  ts(f, 'fetchedAt', h.fetchedAt);
}

// ---- market recap vs market.json (run only with --check-market) ----
// Deterministic rules: every number the recap quotes must belong to a market item named in the same
// sentence (or, if the sentence names none, the one before it), and direction words must match the sign.
const SYN = {
  sp500: /s&p(?:\s*500)?/gi,
  dow: /\bdow(?:\s+jones)?(?:\s+industrial\s+average)?\b/gi,
  nasdaq: /\bnasdaq(?:\s+composite)?\b/gi,
  us10y: /\b10[-\s]?(?:yr|year)(?:\s+treasury)?(?:\s+yields?)?|\btreasury(?:\s+yields?)?|\byields?\b/gi,
  wti: /\b(?:wti|crude|oil|west texas intermediate)\b/gi,
  gold: /\bgold\b/gi,
  dxy: /\bdollar(?:\s+index)?\b|\bdxy\b/gi,
};
const UP = /\b(rose|rises|rise|rising|gained|gains|gain|climbed|climbs|advanced|rallied|jumped|surged|added|higher|up)\b/gi;
const DOWN = /\b(fell|falls|fall|falling|dropped|drops|declined|declines|slipped|slid|lost|lower|down|retreated|sank|tumbled|dipped)\b/gi;
const FLAT = /\b(flat|unchanged|little changed)\b/gi;
const MONTH = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*$/i;
const ABBR = /\b(U\.S|Nov|Dec|Jan|Feb|Mar|Apr|Aug|Sept?|Oct|No|St|Inc|Corp|Co|Mr|Ms|Dr|a\.m|p\.m)\./g;

function splitSentences(para) {
  const masked = para.replace(ABBR, (m) => m.replace(/\./g, '\u0001'));
  return masked.split(/(?<=[.!?])\s+(?=[A-Z$"“(])/).map((x) => x.replace(/\u0001/g, '.'));
}
const decimalsOf = (frac) => (frac ? frac.length - 1 : 0);
const roundTo = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const sgn = (it) => Math.sign(it.change);

function mentions(sentence) {
  const out = [];
  for (const [id, re] of Object.entries(SYN)) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(sentence));) out.push({ id, start: m.index, end: m.index + m[0].length });
  }
  return out.sort((x, y) => x.start - y.start);
}

// Does the quoted number match this item in the way its unit suffix says?
function fits(it, q) {
  const { n, d, pct, usd, bp, signed, neg } = q;
  const test = (v) => near(roundTo(Math.abs(v), d), n);
  const signOk = () => true; // magnitudes are compared without the sign (docs/digest-schema.md); direction words carry the sign
  if (bp) return it.unit === 'percent' && near(Math.round(Math.abs(it.change) * 100), n) && signOk(it.change);
  if (pct) {
    if (test(it.changePct) && signOk(it.changePct)) return true;
    return it.unit === 'percent' && (test(it.value) || (test(it.change) && signOk(it.change)));
  }
  if (usd) return test(it.value) || (test(it.change) && signOk(it.change));
  return test(it.value) || (test(it.change) && signOk(it.change));
}

function checkSentence(f, where, sentence, items, inherited, year) {
  const own = mentions(sentence);
  // Blank out label text so the "500" in "S&P 500" or "10" in "10-year" are not read as quotes.
  let scan = sentence;
  for (const m of own) scan = scan.slice(0, m.start) + ' '.repeat(m.end - m.start) + scan.slice(m.end);
  const ids = own.length ? [...new Set(own.map((m) => m.id))] : inherited;
  const short = sentence.length > 70 ? sentence.slice(0, 67) + '...' : sentence;
  const label = (id) => (items.find((i) => i.id === id) || {}).label || id;

  const re = /(?<![\w.,])([+\-−])?(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:(\s?(?:%|percent\b))|(\s(?:percentage points?|basis points?|bps)\b)|(\s(?:points?)\b))?/gi;
  for (let m; (m = re.exec(scan));) {
    const tok = m[0].trim();
    const before = scan.slice(0, m.index), after = scan.slice(m.index + m[0].length);
    const n = Number(m[3].replace(/,/g, '') + (m[4] || ''));
    const d = decimalsOf(m[4]);
    const pct = !!m[5], usd = !!m[2], bp = !!(m[6] && /basis|bps/i.test(m[6])), pts = !!m[7] || (!!m[6] && !bp);
    const sign = m[1] && /^[\-−]$/.test(m[1]) ? 'neg' : m[1] === '+' ? 'pos' : null;
    // Dates, ordinals, ISO dates, clock times: not market quotes.
    if (MONTH.test(before) || /^(st|nd|rd|th)\b/i.test(after) || /\d[-\/]$/.test(before) || /^[-\/]\d/.test(after) || /[:]$/.test(before) || /^:\d/.test(after)) continue;
    const whole = !m[4] && !/,/.test(m[3]);
    const marked = pct || usd || bp || pts;
    if (!marked && whole && n < 1000) continue;                       // "two", "3 of 7", times: not checked
    if (!marked && whole && Math.abs(n - year) <= 1 && n >= 1900) continue; // years
    if (!ids.length) { err(f, `${where} quotes ${tok} but names no market item in "${short}"`); continue; }
    const q = { n, d, pct, usd, bp, signed: !!sign, neg: sign === 'neg' };
    const hit = ids.map((id) => items.find((i) => i.id === id)).filter(Boolean).some((it) => fits(it, q));
    if (!hit) err(f, `${where} quotes ${tok}, which does not match ${ids.map(label).join(' / ')} (value, change or % change) in market.json: "${short}"`);
  }

  // "flat"/"unchanged" needs a change of exactly 0.
  FLAT.lastIndex = 0;
  for (let m; own.length && (m = FLAT.exec(scan));) {
    const at = m.index, dist = (x) => (at < x.start ? x.start - at : at >= x.end ? at - x.end : 0);
    const n1 = own.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    const it = items.find((i) => i.id === n1.id);
    if (it && isNum(it.change) && it.change !== 0) err(f, `${where} says ${label(n1.id)} "${m[0]}" but market.json shows a change of ${it.change}: "${short}"`);
  }
  // Direction words vs the sign of the nearest item named in the sentence.
  for (const [re2, dir] of [[UP, 1], [DOWN, -1]]) {
    re2.lastIndex = 0;
    for (let m; (m = re2.exec(scan));) {
      if (!own.length) break;
      const at = m.index;
      const dist = (x) => (at < x.start ? x.start - at : at >= x.end ? at - x.end : 0);
      const near1 = own.reduce((a, b) => (dist(b) < dist(a) ? b : a));
      const it = items.find((i) => i.id === near1.id);
      if (!it || !isNum(it.change) || !isNum(it.changePct)) continue;
      const s2 = sgn(it);
      if (s2 !== dir) err(f, `${where} says ${label(near1.id)} "${m[0]}" but market.json shows it ${s2 === 0 ? 'unchanged' : s2 > 0 ? 'up' : 'down'} (change ${it.change}): "${short}"`);
    }
  }
  return ids;
}

// Digit tokens that are not a year, date, ordinal or clock time.
function strayNumbers(para) {
  const out = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  for (let m; (m = re.exec(para));) {
    const before = para.slice(0, m.index), after = para.slice(m.index + m[0].length);
    if (/^\d{4}$/.test(m[0]) && Number(m[0]) >= 1900 && Number(m[0]) <= 2100 && !/\$\s?$/.test(before) && !/^\s?(%|percent)/.test(after)) continue;
    if (MONTH.test(before) || /^(st|nd|rd|th)\b/i.test(after) || /\d[-\/]$/.test(before) || /^[-\/]\d/.test(after) || /:$/.test(before) || /^:\d/.test(after)) continue;
    out.push(m[0]);
  }
  return out;
}

function marketNumbers(d) {
  const m = d.sections && d.sections.market;
  if (!isObj(m) || m.mock === true || !Array.isArray(m.body)) return;
  const f = 'digest.json';
  const p = join(DIR, 'market.json');
  let mk = null;
  try { mk = JSON.parse(readFileSync(p, 'utf8')); } catch { /* treated as missing */ }
  // Fail-safe: when market.json is missing, mock or old, the task leaves the recap alone and
  // there is nothing fresh to check it against. Only a fresh market.json can contradict the recap.
  // Age is asOf vs today's Central date (never fetchedAt, which market.yml does not always commit).
  const central = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW_MS));
  const age = isObj(mk) && isStr(mk.asOf) && YMD.test(mk.asOf) ? (Date.parse(central) - Date.parse(mk.asOf)) / 864e5 : Infinity;
  if (!isObj(mk) || mk.mock === true || !Array.isArray(mk.items) || age > 4) {
    console.log('note: market cross-check skipped (market.json is missing, mock or more than 4 days old)');
    // Nothing to check numbers against, so the recap may quote none (rule 4: numbers are never model-typed).
    m.body.forEach((para, pi) => {
      if (!isStr(para)) return;
      for (const tok of strayNumbers(para)) err(f, `sections.market.body[${pi}] quotes ${tok}, but market.json is missing, mock or stale so numbers cannot be checked; a recap written without fresh data must quote no numbers`);
    });
    return;
  }
  if (m.asOf !== mk.asOf) err(f, `sections.market.asOf ${m.asOf} does not match market.json asOf ${mk.asOf}`);
  const year = Number(String(mk.asOf).slice(0, 4));
  m.body.forEach((para, pi) => {
    if (!isStr(para)) return;
    let inherited = [];
    for (const sen of splitSentences(para)) {
      const ids = checkSentence(f, `sections.market.body[${pi}]`, sen, mk.items, inherited, year);
      inherited = ids;
    }
  });
}

let digestData = null;
if (ONLY.includes('digest')) { digestData = load('digest'); if (digestData) { digest(digestData); if (CHECK_MARKET) marketNumbers(digestData); } }
else if (ONLY.includes('scripture')) digestData = load('digest');
if (ONLY.includes('market')) { const m = load('market'); if (m) market(m); }
if (ONLY.includes('scripture')) { const s = load('scripture'); if (s) scripture(s, digestData); }
if (ONLY.includes('history')) { const h = load('history'); if (h) history(h); }

if (errors.length) {
  console.error(`Validation failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`ok: ${ONLY.join(', ')}`);
