// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(root, f), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));

function pngSize(file) {
  const b = readFileSync(join(root, file));
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

test('manifest has the required fields', () => {
  assert.equal(manifest.name, 'Block to Globe');
  assert.equal(manifest.short_name, 'Block to Globe');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
});

test('manifest icons exist, match their sizes, and include 192, 512 and maskable', () => {
  const sizes = new Set();
  for (const i of manifest.icons) {
    assert.ok(existsSync(join(root, i.src)), `${i.src} missing`);
    assert.equal(pngSize(i.src), i.sizes, `${i.src} size`);
    sizes.add(i.sizes);
  }
  assert.ok(sizes.has('192x192') && sizes.has('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
  assert.equal(pngSize('assets/icons/apple-touch-icon.png'), '180x180');
});

test('manifest paths are relative', () => {
  for (const v of [manifest.start_url, manifest.scope, ...manifest.icons.map((i) => i.src)]) {
    assert.doesNotMatch(v, /^(\/|https?:)/, v);
  }
});

test('index.html links the manifest, icon, theme color and registers the worker safely', () => {
  const s = read('index.html');
  assert.match(s, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(s, /<link rel="apple-touch-icon" href="assets\/icons\/[^"]+\.png">/);
  assert.match(s, /<meta name="theme-color"/);
  assert.match(s, /'serviceWorker' in navigator/);
  assert.match(s, /register\('sw\.js'/);
  assert.match(s, /try \{/);
  assert.doesNotMatch(s, /<(img|svg)\b/i);
  assert.doesNotMatch(s, /(?:href|src)="\//);
});

test('sw.js: network-first for data/, versioned cache, cleanup, no cross-origin, no absolute paths', () => {
  const s = read('sw.js');
  assert.match(s, /const CACHE = 'btg-v\d+'/);
  assert.match(s, /startsWith\('data\/'\)/);
  assert.match(s, /networkFirst/);
  assert.match(s, /caches\.delete/);
  assert.match(s, /skipWaiting/);
  assert.match(s, /clients\.claim/);
  assert.match(s, /url\.origin !== self\.location\.origin\) return/);
  assert.doesNotMatch(s, /(['"`])\/(?!\/)[\w.-]/, 'absolute path in sw.js');
  assert.doesNotMatch(s, /https?:\/\//);
  // precache list names only the allowed shell files
  const list = s.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  assert.doesNotMatch(list, /data\//);
});

test('publish.yml stages manifest and service worker', () => {
  const s = read('.github/workflows/publish.yml');
  assert.match(s, /cp index\.html manifest\.webmanifest sw\.js _site\//);
});
