#!/usr/bin/env node
// Checks every reference in data/scripture-bank.json against the KJV text source.
// Reports references the source cannot return, or that return unusually long text.
// Slow on purpose (the free source rate-limits): about 2.2 seconds per verse.
// Usage: node scripts/check-bank.mjs [--bank data/scripture-bank.json] [--max-chars 450]
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const bank = JSON.parse(readFileSync(opt('--bank', 'data/scripture-bank.json'), 'utf8'));
const MAX = Number(opt('--max-chars', 450));
const BASE = process.env.SCRIPTURE_API_BASE || 'https://bible-api.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
      else if (String(j.translation_id || '').toLowerCase() !== 'kjv') note = 'translation ' + j.translation_id;
      else if (t.length > MAX) note = `long (${t.length} chars)`;
      else note = null;
      break;
    } catch (e) { note = 'fetch failed: ' + e.message; }
  }
  if (note) bad.push(`${v.reference}: ${note}`); else ok++;
  await sleep(2200);
}
console.log(`${ok} of ${bank.verses.length} references fine`);
if (bad.length) { console.log('Problems:'); for (const b of bad) console.log('  - ' + b); process.exit(1); }
