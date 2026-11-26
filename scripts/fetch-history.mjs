#!/usr/bin/env node
// Picks today's "this day in history" line from Wikipedia's On This Day feed and
// writes history.json. Everything comes from the fetched feed, never from memory.
//
// Usage: node scripts/fetch-history.mjs [--out _site/data/history.json] [--date YYYY-MM-DD]
//                                       [--filter config/history-filter.json]
// Env:   HISTORY_API_BASE overrides the feed host (used by tests).
//
// On any problem this exits 0 without writing the file, so the deploy still runs and the
// page falls back to its own client-side fetch and then a built-in line.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = opt('--out', '_site/data/history.json');
const FILTER = opt('--filter', 'config/history-filter.json');
const BASE = process.env.HISTORY_API_BASE || 'https://en.wikipedia.org';
const MAX_TEXT = 400;

function bail(msg) { console.warn('history: ' + msg + ' (page will use its fallback)'); process.exit(0); }

// "Today" is the Central-time date, matching when the digest is published.
const date = opt('--date', new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }));
const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
if (!m) bail('bad date ' + date);

let filter;
try { filter = JSON.parse(readFileSync(FILTER, 'utf8')); } catch { bail('could not read ' + FILTER); }

const url = `${BASE}/api/rest_v1/feed/onthisday/selected/${m[2]}/${m[3]}`;
let res;
try {
  res = await fetch(url, {
    headers: { 'user-agent': 'BlockToGlobe/1.0 (https://github.com/Block-to-Globe/News-Compiler)', accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
} catch (e) { bail('fetch failed: ' + e.message); }
if (!res.ok) bail('feed answered ' + res.status);

let feed;
try { feed = await res.json(); } catch { bail('feed did not return JSON'); }
if (!feed || !Array.isArray(feed.selected)) bail('feed has no "selected" list');

const clean = (t) => String(t).replace(/\s+/g, ' ').trim();
// Match at the start of a word, so "dies" does not match "studies".
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Each word's pattern is built once, not once per entry.
const wordRes = (list) => (list || []).map((w) => new RegExp('\\b' + esc(String(w).toLowerCase())));
const avoid = wordRes(filter.avoid);
const prefer = wordRes(filter.prefer);
const hits = (text, res) => res.filter((re) => re.test(text)).length;

const candidates = [];
feed.selected.forEach((e, idx) => {
  if (!e || typeof e.text !== 'string' || !Number.isInteger(e.year)) return;
  const text = clean(e.text);
  if (!text || text.length > MAX_TEXT) return;
  const page = e.pages && e.pages[0] && e.pages[0].content_urls && e.pages[0].content_urls.desktop && e.pages[0].content_urls.desktop.page;
  if (typeof page !== 'string' || !/^https:\/\/[^\s<>"']+$/.test(page)) return; // prefer well-documented entries with a linked article
  if (/[<>]/.test(text)) return;
  const low = text.toLowerCase();
  if (avoid.some((re) => re.test(low))) return; // skip graphic or grim entries entirely
  candidates.push({ idx, year: e.year, text, url: page, score: hits(low, prefer) });
});

if (!candidates.length) bail('no suitable entry for ' + date);
candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
const pick = candidates[0];

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  date,
  year: pick.year,
  text: pick.text,
  url: pick.url,
  fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}, null, 2) + '\n');
console.log(`history: wrote ${OUT} for ${date} (${pick.year}, score ${pick.score}, ${candidates.length} candidates)`);
