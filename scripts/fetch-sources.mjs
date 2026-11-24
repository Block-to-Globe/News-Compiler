// Prefetch for the daily digest task (the only writer of the raw feed).
//
// Why: the scheduled Claude task runs unattended and stalls when a website fetch needs approval.
// This script runs on GitHub's runner, which has open network access, and saves what the task
// needs: headlines, links, dates, feed descriptions and a short excerpt of the lead of each top story.
// The task reads the result from the `raw-feed` branch and never fetches a website itself.
//
// Usage: node scripts/fetch-sources.mjs --out <dir>
// Writes <dir>/feed.json. Exits 1 only if no outlet at all could be read.
//
// Limits (rule 5, "no article text copied"): descriptions are capped at 400 characters and article
// excerpts at 800. Outlets in PREMIUM get listing text only, never an article fetch. No paywall workarounds.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESC_MAX = 400;
export const EXCERPT_MAX = 800;
export const ITEMS_PER_OUTLET = 12;
export const ARTICLES_PER_OUTLET = 4;
export const MAX_AGE_HOURS = 60;
const TIMEOUT_MS = 15000;
const UA = 'BlockToGlobeBot/1.0 (+https://github.com/Block-to-Globe/News-Compiler; personal news digest)';

// Outlets whose stories are mostly subscriber-only: listing text only.
export const PREMIUM = ['Daily Memphian'];

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

export function clean(s, max) {
  let t = String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decode(t.replace(/<[^>]*>/g, ' '));
  t = decode(t).replace(/\s+/g, ' ').trim();
  return max && t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

// RSS 2.0 and Atom. Returns [{title, url, published, description}].
export function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const title = clean(tag(b, 'title'), 200);
    let url = clean(tag(b, 'link'));
    if (!url) {
      const h = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      url = h ? decode(h[1]) : '';
    }
    const pub = clean(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const time = Date.parse(pub);
    const description = clean(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded'), DESC_MAX);
    if (title && /^https?:\/\//.test(url)) {
      out.push({ title, url, published: Number.isNaN(time) ? null : new Date(time).toISOString(), description });
    }
  }
  return out;
}

// Plain web page with no feed: collect headline-looking links on the same site.
export function parseLinks(html, base) {
  const host = new URL(base).hostname.replace(/^www\./, '');
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try { url = new URL(decode(m[1]), base); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (url.hostname.replace(/^www\./, '') !== host) continue;
    if (url.pathname.split('/').filter(Boolean).length < 2) continue; // skip section fronts
    const title = clean(m[2], 200);
    if (title.length < 30 || title.split(' ').length < 5) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({ title, url: url.href, published: null, description: '' });
  }
  return out;
}

// First paragraphs of an article page, as plain text, capped.
export function leadText(html) {
  const body = html.replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  const paras = [...body.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((m) => clean(m[1]))
    .filter((p) => p.split(' ').length >= 8);
  const text = paras.join(' ');
  const paywalled = /subscribe to (continue|read)|subscribers only|premium (content|story)|sign in to read/i.test(html);
  return { text: text.length > EXCERPT_MAX ? text.slice(0, EXCERPT_MAX - 1).trimEnd() + '…' : text, paywalled };
}

export function isFresh(item, now, maxAgeHours = MAX_AGE_HOURS) {
  if (!item.published) return true; // unknown date: keep, the task decides
  return now - Date.parse(item.published) <= maxAgeHours * 3600 * 1000;
}

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/rss+xml,application/xml,text/xml,*/*;q=0.8' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function readOutlet(o, now) {
  const rec = { outlet: o.outlet, entry: o.entry, status: 'ok', items: [] };
  try {
    const body = await get(o.entry);
    let items = /<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 2000)) ? parseFeed(body) : parseLinks(body, o.entry);
    items = items.filter((i) => isFresh(i, now)).slice(0, ITEMS_PER_OUTLET);
    if (!items.length) { rec.status = 'empty'; return rec; }
    rec.items = items;
    if (!PREMIUM.includes(o.outlet)) {
      for (const it of items.slice(0, ARTICLES_PER_OUTLET)) {
        try {
          const { text, paywalled } = leadText(await get(it.url));
          if (paywalled) it.paywalled = true;
          else if (text.length >= 200) it.excerpt = text;
        } catch { /* listing text only for this item */ }
      }
    } else {
      rec.listingOnly = true;
    }
  } catch (e) {
    rec.status = 'error';
    rec.error = String(e.message || e).slice(0, 120);
  }
  return rec;
}

export async function main(argv) {
  const i = argv.indexOf('--out');
  if (i < 0 || !argv[i + 1]) throw new Error('usage: fetch-sources.mjs --out <dir>');
  const out = argv[i + 1];
  const root = fileURLToPath(new URL('..', import.meta.url));
  const cfg = JSON.parse(readFileSync(join(root, 'config', 'sources.json'), 'utf8'));
  const now = Date.now();
  const feed = { schemaVersion: 1, fetchedAt: new Date(now).toISOString(), sections: {} };
  let ok = 0;
  const cache = new Map(); // the same outlet entry can serve several sections
  for (const [section, outlets] of Object.entries(cfg.sections)) {
    feed.sections[section] = [];
    for (const o of outlets) {
      if (o.fetch !== 'works' || !o.entry) continue;
      if (!cache.has(o.entry)) cache.set(o.entry, await readOutlet(o, now));
      const rec = cache.get(o.entry);
      if (rec.status === 'ok') ok++;
      feed.sections[section].push(rec);
    }
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'feed.json'), JSON.stringify(feed, null, 1) + '\n');
  const summary = Object.entries(feed.sections)
    .map(([s, r]) => `${s}: ${r.filter((x) => x.status === 'ok').length}/${r.length} ok`)
    .join(', ');
  console.log(`fetch-sources: ${summary}`);
  for (const r of Object.values(feed.sections).flat()) if (r.status !== 'ok') console.log(`  ${r.outlet}: ${r.status} ${r.error || ''}`);
  if (!ok) { console.error('fetch-sources: no outlet could be read'); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
