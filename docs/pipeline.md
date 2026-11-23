# Pipeline

How a day's content gets from the news to the page, and what happens when something goes wrong.

## Moving parts

| Piece | What it does |
|---|---|
| Scheduled Claude task | Reads `task/daily-digest-prompt.md` at the head of `main`, researches, writes `data/digest.json`, validates it, and pushes a commit that touches only that file |
| `scripts/validate.mjs` | Checks the data files against `docs/digest-schema.md` (required fields, lengths, https-only links, no HTML, timestamps, optional age limit) |
| `scripts/fetch-scripture.mjs` | Fetches the KJV text for the reference in `digest.json` at deploy time. Never model-typed |
| `scripts/fetch-history.mjs` | Picks today's "this day in history" line from Wikipedia's On This Day feed at deploy time, using the tone filter in `config/history-filter.json` |
| `.github/workflows/publish.yml` | Validate, build, deploy. Reverts a bad digest commit on validation failure. Opens a "Deploy failed" issue on build or deploy failure. Daily backup run and freshness check |
| `.github/workflows/market.yml` | Fetches market numbers on weekdays, commits `data/market.json` only when the numbers change, then dispatches `publish.yml` |

## Run order (America/Chicago)

1. About 6:00 AM: the task writes `digest.json` and pushes. The task starts about 11:00 UTC (summer) or 12:00 UTC (winter).
2. The push triggers `publish.yml`. The backup run at 13:30 UTC (about 7:30 AM CST, 8:30 AM CDT) does the same in case a push did not trigger a deploy, and also runs the freshness check.
3. `market.yml` (weekdays 21:30 UTC) runs `scripts/fetch-market.mjs` and validates the result. It commits `data/market.json` only if content other than `fetchedAt` changed, then dispatches `publish.yml`. If the source fails or the file is invalid, nothing is committed.

## What `publish.yml` does

1. **validate**: runs `scripts/validate.mjs --only digest,market`. A failure stops the run before any build or deploy.
2. **build** (needs validate): stage `index.html`, `assets/` and `data/` into `_site/`. Drop the repo's mock `scripture.json` and `history.json`, fetch the KJV verse and the history line, validate each, and keep it only if it passes. Upload the artifact.
3. **deploy** (needs build): publish the artifact to GitHub Pages.
4. **revert-bad-data** (runs only when validate failed): on a push, if the commit changed only `data/digest.json`, revert it and push. Either way, open a "Publish failed" issue with the run link. Nothing was deployed, so the last good site stays live. A revert made with the built-in token does not trigger another run.
5. **report-deploy-failure** (runs only when validate passed and build or deploy failed): nothing is reverted. Open a "Deploy failed" issue with the run link. The data is probably fine.
6. **freshness** (scheduled runs only): `validate.mjs --only digest --max-age-hours 20`. If `digest.json` is more than 20 hours old, open a "Digest is stale" issue (one open at a time). The page shows its own stale note after 26 hours.

`scripture.json` and `history.json` are generated at deploy time and not committed. If the verse source is down or returns something unexpected, the file is left out and the page shows the reference with a link to read it. If the history feed is down or has no suitable entry, the file is left out and the page tries its own Wikipedia fetch, then a built-in line.

## Market failures

If `fetch-market.mjs` or the check fails, `market.yml` opens a "Market numbers failed" issue, or adds a comment to the open one. The last good `data/market.json` stays live. Often this is a Yahoo Finance outage; re-run the workflow once the source is back.

## Bot push requirements

`market.yml` pushes as `github-actions[bot]` with the built-in token, so these must hold:

- Repo Settings > Actions > General > Workflow permissions is "Read and write permissions".
- No branch protection on `main` blocks `github-actions[bot]` from pushing (or it has an exception for it).

## Failure modes

| Failure | What happens |
|---|---|
| Task misses a run | Page keeps the last good digest; stale note after 26 hours; "Digest is stale" issue at the next backup run |
| Task pushes bad JSON or breaks the schema | Validation fails, nothing deploys, the commit is reverted, an issue opens |
| Task pushes a valid file with weak content | Not caught by validation. Prompt rules, the eval set and spot checks cover this |
| Build or deploy fails on valid data | Nothing is reverted; a "Deploy failed" issue opens |
| Verse source down or odd | No `scripture.json` deployed; page shows reference with a link |
| History feed down, or only grim entries | No `history.json` deployed; page falls back to its own fetch, then a built-in line |
| Market source down or file invalid | Nothing committed; "Market numbers failed" issue opens or gets a comment |
| A news source blocks fetching | The task falls back to search snippets and headlines and says less (see `config/sources.json`) |
| A push does not trigger a deploy | The daily backup run deploys the latest `main` |
| Two pushes close together | `pages` concurrency group queues them; no two deploys race |

## Commit hygiene

Digest commits come from the task, touch only `data/digest.json`, and carry the run date in the message (for example `digest: 2026-11-24 morning`). The revert rule depends on that.

## Tests

`node --test` runs `tests/pipeline.test.mjs`: the validator against good and bad data, and the verse and history fetchers against a local fake source (success and every skip path).
