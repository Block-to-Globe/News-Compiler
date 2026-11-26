// Run with: node --test tests/
// Parser checks for scripts/fetch-sources.mjs. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseLinks, leadText, isFresh, clean, mapLimit, DESC_MAX, EXCERPT_MAX } from '../scripts/fetch-sources.mjs';

const rss = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Council &amp; mayor meet]]></title><link>https://example.com/a/1</link>
<pubDate>Mon, 23 Nov 2026 14:00:00 GMT</pubDate><description><![CDATA[<p>Short <b>summary</b> here.</p>]]></description></item>
<item><title>No link item</title></item>
</channel></rss>`;

const atom = `<feed><entry><title>Atom story</title><link href="https://example.com/b/2"/>
<updated>2026-11-23T10:00:00Z</updated><summary>Atom summary</summary></entry></feed>`;

test('parseFeed: RSS item, CDATA, entities, tags stripped, item without link dropped', () => {
  const items = parseFeed(rss);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Council & mayor meet');
  assert.equal(items[0].url, 'https://example.com/a/1');
  assert.equal(items[0].description, 'Short summary here.');
  assert.equal(items[0].published, '2026-11-23T14:00:00.000Z');
});

test('parseFeed: Atom entry with href link', () => {
  const [it] = parseFeed(atom);
  assert.equal(it.url, 'https://example.com/b/2');
  assert.equal(it.description, 'Atom summary');
});

test('descriptions are capped', () => {
  const long = `<rss><item><title>T</title><link>https://example.com/x</link><description>${'word '.repeat(300)}</description></item></rss>`;
  assert.ok(parseFeed(long)[0].description.length <= DESC_MAX);
  assert.ok(clean('a '.repeat(500), 50).length <= 50);
});

test('parseLinks: keeps same-site headline links, skips short text, section fronts, other hosts, duplicates', () => {
  const html = `
    <a href="/news/">Local news section front page link text here</a>
    <a href="/news/2026/city-council-approves-new-budget">City council approves new budget after long debate</a>
    <a href="/news/2026/city-council-approves-new-budget">City council approves new budget after long debate</a>
    <a href="/news/2026/x">Short</a>
    <a href="https://other.com/a/b">Another site headline that is long enough to count here</a>`;
  const items = parseLinks(html, 'https://www.example.com/news/');
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://www.example.com/news/2026/city-council-approves-new-budget');
});

test('leadText: takes real paragraphs, skips scripts and short lines, caps length', () => {
  const para = 'This is a full sentence paragraph with plenty of words in it for the test case. '.repeat(3);
  const html = `<script><p>ignore this script paragraph with many many words in it right here ok</p></script>
    <p>Share</p><p>${para}</p><p>${para}</p><p>${para}</p><p>${para}</p>`;
  const { text, paywalled } = leadText(html);
  assert.ok(text.length >= 200 && text.length <= EXCERPT_MAX);
  assert.ok(!text.includes('ignore this script'));
  assert.equal(paywalled, false);
  assert.equal(leadText('<p>Subscribe to continue reading this story today please</p>').paywalled, true);
});

test('isFresh: drops old items, keeps undated ones', () => {
  const now = Date.parse('2026-11-24T10:00:00Z');
  assert.equal(isFresh({ published: '2026-11-23T10:00:00Z' }, now), true);
  assert.equal(isFresh({ published: '2026-11-10T10:00:00Z' }, now), false);
  assert.equal(isFresh({ published: null }, now), true);
});

test('mapLimit: keeps input order and never runs more than the limit at once', async () => {
  let active = 0, peak = 0;
  const out = await mapLimit([30, 5, 20, 1, 10], 2, async (ms, i) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, ms));
    active--; return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapLimit([], 3, async () => 1), []);
});
