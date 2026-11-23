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
    if (s.why !== undefined) text(f, 'scripture.why', s.why, 160);
  }
  if (d.notes !== undefined && !(Array.isArray(d.notes) && d.notes.every(isStr))) err(f, 'notes must be an array of strings');
  return d;
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

// The market recap may only quote numbers that appear in market.json (rule: numbers are never model-typed).
function marketNumbers(d) {
  const m = d.sections && d.sections.market;
  if (!isObj(m) || m.mock === true || !Array.isArray(m.body)) return;
  const f = 'digest.json';
  const p = join(DIR, 'market.json');
  let mk = null;
  try { mk = JSON.parse(readFileSync(p, 'utf8')); } catch { /* handled below */ }
  if (!isObj(mk) || mk.mock === true || !Array.isArray(mk.items)) { err(f, 'sections.market is live but market.json is missing, mock or unreadable, so its numbers cannot be checked'); return; }
  if (m.asOf !== mk.asOf) err(f, `sections.market.asOf ${m.asOf} does not match market.json asOf ${mk.asOf}`);
  const allowed = [];
  for (const it of mk.items) for (const k of ['value', 'change', 'changePct']) {
    if (!isNum(it[k])) continue;
    const v = Math.abs(it[k]);
    allowed.push(v, Math.round(v * 10) / 10, Math.round(v));
  }
  const year = Number(String(mk.asOf).slice(0, 4));
  for (const para of m.body) {
    if (!isStr(para)) continue;
    for (const tok of para.match(/\d[\d,]*(?:\.\d+)?/g) || []) {
      const hasPunct = /[.,]/.test(tok);
      const n = Number(tok.replace(/,/g, ''));
      if (!Number.isFinite(n)) continue;
      if (!hasPunct && n < 1000) continue;       // small whole numbers (dates, "two") are not checked
      if (n === year) continue;
      if (!allowed.some((a) => Math.abs(a - n) < 0.005)) err(f, `sections.market quotes ${tok}, which is not in market.json`);
    }
  }
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
