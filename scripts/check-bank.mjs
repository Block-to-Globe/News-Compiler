#!/usr/bin/env node
// Checks every reference in data/scripture-bank.json against the KJV text source.
// Reports references the source cannot return, that come back as a different reference
// or translation, or that return unusually long text. Also refuses duplicate references
// and themes not in the bank's theme list (no network needed for those).
// Slow on purpose (the free source rate-limits): about 2.2 seconds per verse.
// Usage: node scripts/check-bank.mjs [--bank data/scripture-bank.json] [--max-chars 450] [--delay-ms 2200]
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const bank = JSON.parse(readFileSync(opt('--bank', 'data/scripture-bank.json'), 'utf8'));
const MAX = Number(opt('--max-chars', 450));
const DELAY = Number(opt('--delay-ms', 2200));
const BASE = process.env.SCRIPTURE_API_BASE || 'https://bible-api.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Same loose comparison as fetch-scripture.mjs, so a reference that passes here also passes at deploy.
const norm = (r) => r.replace(/\s+/g, '').toLowerCase().replace(/^psalms/, 'psalm');

const shape = [];
const seen = new Set();
for (const v of bank.verses) {
  if (seen.has(v.reference)) shape.push(`${v.reference}: duplicate reference`);
  seen.add(v.reference);
  if (!Array.isArray(bank.themes) || !bank.themes.includes(v.theme)) shape.push(`${v.reference}: theme "${v.theme}" is not in the themes list`);
}
if (shape.length) { console.log('Problems:'); for (const s of shape) console.log('  - ' + s); process.exit(1); }

const bad = []; let ok = 0;
for (const v of bank.verses) {
  let note = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(v.reference)}?translation=kjv`, { signal: AbortSignal.timeout(15000) });
      if (res.status === 429) { await sleep(15000); note = 'rate limited'; continue; }
      if (!res.ok) { note = 'HTTP ' + res.status; break; }
      const j = await res.json();
      const t = String(j.text || '').replace(/\s+/g, ' ').trim();
      if (!t) note = 'no text';
      else if (String(j.translation_id || '').toLowerCase() !== 'kjv') note = 'translation ' + (j.translation_id || '(none)');
      else if (typeof j.reference === 'string' && norm(j.reference) !== norm(v.reference)) note = `source returned reference "${j.reference}"`;
      else if (t.length > MAX) note = `long (${t.length} chars)`;
      else note = null;
      break;
    } catch (e) { note = 'fetch failed: ' + e.message; }
  }
  if (note) bad.push(`${v.reference}: ${note}`); else ok++;
  await sleep(DELAY);
}
console.log(`${ok} of ${bank.verses.length} references fine`);
if (bad.length) { console.log('Problems:'); for (const b of bad) console.log('  - ' + b); process.exit(1); }
