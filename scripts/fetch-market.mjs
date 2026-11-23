#!/usr/bin/env node
// Fetches closing numbers for the market recap and writes data/market.json.
// Numbers always come from the source below, never from a model.
//
// Usage: node scripts/fetch-market.mjs [--out data/market.json] [--now 2026-11-24T21:30:00Z]
// Env:   MARKET_API_BASE overrides the source URL (used by tests).
//
// All seven items must come back clean, or nothing is written and the script exits 1
// (the workflow then commits nothing and the last good file stays in place).
//
// Provisional source: Yahoo Finance's public chart endpoint (no key, unofficial).
// Stooq now needs a key and FRED needs one too, so this is the only no-key option found.
// If it breaks, the swap is confined to ITEMS and parse() below.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = opt('--out', 'data/market.json');
const NOW = new Date(opt('--now', new Date().toISOString()));
const BASE = process.env.MARKET_API_BASE || 'https://query1.finance.yahoo.com';

const ITEMS = [
  { id: 'sp500',  label: 'S&P 500',         symbol: '^GSPC',    unit: 'points' },
  { id: 'dow',    label: 'Dow',             symbol: '^DJI',     unit: 'points' },
  { id: 'nasdaq', label: 'Nasdaq',          symbol: '^IXIC',    unit: 'points' },
  { id: 'us10y',  label: '10-yr Treasury',  symbol: '^TNX',     unit: 'percent' },
  { id: 'wti',    label: 'Oil (WTI)',       symbol: 'CL=F',     unit: 'usd' },
  { id: 'gold',   label: 'Gold',            symbol: 'GC=F',     unit: 'usd' },
  { id: 'dxy',    label: 'US Dollar Index', symbol: 'DX-Y.NYB', unit: 'index' },
];

function die(msg) { console.error('market: ' + msg + ' (nothing written)'); process.exit(1); }
const r2 = (n) => Math.round(n * 100) / 100;
const etParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
}).formatToParts(d).map((p) => [p.type, p.value]));
const etDate = (d) => { const p = etParts(d); return `${p.year}-${p.month}-${p.day}`; };

// Returns { date: 'YYYY-MM-DD' (ET), last, prev } from the last two daily closes.
function parse(j) {
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  const ts = r && r.timestamp;
  const closes = r && r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close;
  if (!Array.isArray(ts) || !Array.isArray(closes) || ts.length !== closes.length) return null;
  const rows = ts.map((t, i) => ({ t, c: closes[i] })).filter((x) => typeof x.c === 'number' && Number.isFinite(x.c) && x.c > 0);
  if (rows.length < 2) return null;
  const a = rows[rows.length - 2], b = rows[rows.length - 1];
  return { date: etDate(new Date(b.t * 1000)), last: b.c, prev: a.c };
}

async function get(item) {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(item.symbol)}?range=10d&interval=1d`;
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (block-to-globe market recap)' } }); }
  catch (e) { die(`${item.id}: fetch failed: ${e.message}`); }
  if (!res.ok) die(`${item.id}: source answered ${res.status}`);
  let j; try { j = await res.json(); } catch { die(`${item.id}: source did not return JSON`); }
  const p = parse(j);
  if (!p) die(`${item.id}: could not read two daily closes`);
  return p;
}

const got = [];
for (const it of ITEMS) got.push({ it, p: await get(it) });

const asOf = got[0].p.date; // S&P 500 sets the trading day
for (const { it, p } of got) {
  const gapDays = Math.abs(Date.parse(asOf) - Date.parse(p.date)) / 864e5;
  if (gapDays > 4) die(`${it.id}: latest close ${p.date} is far from ${asOf}`);
}

const today = etDate(NOW), ep = etParts(NOW);
const weekend = ep.weekday === 'Sat' || ep.weekday === 'Sun';
let marketStatus, note;
if (weekend) { marketStatus = 'weekend'; note = 'Markets are closed for the weekend; showing the last close.'; }
else if (asOf !== today) { marketStatus = 'holiday'; note = 'Markets were closed today; showing the last close.'; }
else if (Number(ep.hour) >= 16) marketStatus = 'closed';
else marketStatus = 'open';

const items = got.map(({ it, p }) => {
  const change = r2(p.last - p.prev);
  return { id: it.id, label: it.label, value: r2(p.last), change, changePct: r2((p.last - p.prev) / p.prev * 100), unit: it.unit };
});
const out = { schemaVersion: 1, fetchedAt: NOW.toISOString(), asOf, marketStatus, ...(note ? { note } : {}), items, source: 'Yahoo Finance daily closes' };

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`market: wrote ${OUT} (asOf ${asOf}, ${marketStatus})`);
