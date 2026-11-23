#!/usr/bin/env node
// Fetches the KJV text for the reference in digest.json and writes scripture.json.
// Text always comes from the source below, never from a model.
//
// Usage: node scripts/fetch-scripture.mjs [--digest data/digest.json] [--out _site/data/scripture.json]
// Env:   SCRIPTURE_API_BASE overrides the source URL (used by tests).
//
// On any failure this exits 0 without writing the file, so the deploy still runs and
// the page shows the reference with a link instead of text.
//
// Provisional source: bible-api.com (free, no key). The final choice is a P6 task.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DIGEST = opt('--digest', 'data/digest.json');
const OUT = opt('--out', '_site/data/scripture.json');
const BASE = process.env.SCRIPTURE_API_BASE || 'https://bible-api.com';

function bail(msg) { console.warn('scripture: ' + msg + ' (page will show the reference with a link)'); process.exit(0); }

let ref;
try { ref = JSON.parse(readFileSync(DIGEST, 'utf8')).scripture.reference; } catch { bail('could not read reference from ' + DIGEST); }
if (typeof ref !== 'string' || !ref) bail('no reference in digest');

const url = `${BASE}/${encodeURIComponent(ref)}?translation=kjv`;
let res;
try { res = await fetch(url, { signal: AbortSignal.timeout(10000) }); } catch (e) { bail('fetch failed: ' + e.message); }
if (!res.ok) bail('source answered ' + res.status);

let j;
try { j = await res.json(); } catch { bail('source did not return JSON'); }

const verseText = typeof j.text === 'string' ? j.text.replace(/\s+/g, ' ').trim() : '';
const translation = String(j.translation_id || '').toLowerCase();
if (!verseText) bail('source returned no text');
// The source must say it is the KJV. A missing translation_id is refused too.
if (translation !== 'kjv') bail('source returned translation ' + (translation || '(none)') + ', expected kjv');
// Compare references loosely: ignore case and spaces, and treat "Psalms" as "Psalm".
const norm = (r) => r.replace(/\s+/g, '').toLowerCase().replace(/^psalms/, 'psalm');
if (typeof j.reference === 'string' && norm(j.reference) !== norm(ref))
  bail(`source returned reference "${j.reference}", expected "${ref}"`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  reference: ref,
  translation: 'KJV',
  text: verseText
}, null, 2) + '\n');
console.log('scripture: wrote ' + OUT + ' for ' + ref);
