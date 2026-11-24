// Run with: node --test tests/
// Sanity checks for the GitHub workflows. Uses string checks plus a YAML parse with python3 (PyYAML).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, '.github', 'workflows');
const read = (f) => readFileSync(join(dir, f), 'utf8');
const files = ['publish.yml', 'market.yml', 'prefetch.yml'];

test('workflows parse as YAML', () => {
  for (const f of files) {
    // -I isolates python from the working directory.
    execFileSync('python3', ['-I', '-c',
      'import sys,yaml; yaml.safe_load(open(sys.argv[1]))', join(dir, f)]);
  }
});

test('publish: validation is its own job and build waits for it', () => {
  const s = read('publish.yml');
  assert.match(s, /\n {2}validate:\n/);
  assert.match(s, /\n {2}build:\n {4}needs: validate\n/);
  assert.match(s, /node scripts\/validate\.mjs --only digest,market/);
});

test('publish: revert and validation issue run only when validate failed', () => {
  const s = read('publish.yml');
  const revert = s.slice(s.indexOf('  revert-bad-data:'), s.indexOf('  report-deploy-failure:'));
  assert.match(revert, /needs\.validate\.result == 'failure'/);
  assert.doesNotMatch(revert, /needs\.build/);
  assert.match(revert, /if: \$\{\{ github\.event_name == 'push' \}\}/);
});

test('publish: build or deploy failure opens an issue and never reverts', () => {
  const s = read('publish.yml');
  const rep = s.slice(s.indexOf('  report-deploy-failure:'), s.indexOf('  freshness:'));
  assert.match(rep, /needs\.build\.result == 'failure' \|\| needs\.deploy\.result == 'failure'/);
  assert.doesNotMatch(rep, /git revert|git push/);
});

test('publish: backup cron is 13:30 UTC and freshness allows 20 hours', () => {
  const s = read('publish.yml');
  assert.match(s, /cron: '30 13 \* \* \*'/);
  assert.match(s, /--max-age-hours 20/);
});

test('market: compares without fetchedAt and keeps issue permission', () => {
  const s = read('market.yml');
  assert.match(s, /del\(\.fetchedAt\)/);
  assert.match(s, /issues: write/);
  assert.match(s, /Market numbers failed/);
});

test('market: failure issue fires on any failed step and names each outcome', () => {
  const s = read('market.yml');
  const rep = s.slice(s.indexOf('- name: Report failure'));
  assert.match(rep, /if: \$\{\{ failure\(\) \}\}/);
  assert.doesNotMatch(rep, /always\(\)/);
  for (const step of ['fetch', 'check', 'commit', 'deploy']) {
    assert.match(rep, new RegExp(`steps\\.${step}\\.outcome`));
  }
});

test('workflows use no leading-slash paths and no secrets', () => {
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /(secrets\.(?!GITHUB_TOKEN))/, `${f} references a secret`);
    assert.doesNotMatch(s, /(href|src|path):\s*\/(?!\/)/, `${f} has an absolute path`);
  }
});

test('prefetch: runs before the digest task and writes only the raw-feed branch', () => {
  const s = read('prefetch.yml');
  assert.match(s, /cron: '45 9 \* \* \*'/);
  assert.match(s, /node scripts\/fetch-sources\.mjs/);
  assert.match(s, /git push --force origin raw-feed/);
  assert.doesNotMatch(s, /origin (HEAD:)?main/);
  assert.match(s, /Prefetch failed/);
});

test('task prompt: no website fetching, reads the prefetched feed', () => {
  const s = readFileSync(join(root, 'task', 'daily-digest-prompt.md'), 'utf8');
  assert.match(s, /No website fetching/);
  assert.match(s, /git fetch --depth=1 origin raw-feed/);
  assert.match(s, /more than 18 hours old/);
  assert.doesNotMatch(s, /page fetches per section/);
});
