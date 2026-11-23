# Pipeline

How a day's content gets from the news to the page, and what happens when something goes wrong.

## Moving parts

| Piece | What it does |
|---|---|
| Scheduled Claude task | Reads `task/daily-digest-prompt.md` at the head of `main`, researches, writes `data/digest.json`, validates it, and pushes a commit that touches only that file |
| `scripts/validate.mjs` | Checks the data files against `docs/digest-schema.md` (required fields, lengths, https-only links, no HTML, timestamps, optional age limit) |
| `scripts/fetch-scripture.mjs` | Fetches the KJV text for the reference in `digest.json` at deploy time. Never model-typed |
| `scripts/fetch-history.mjs` | Picks today's "this day in history" line from Wikipedia's On This Day feed at deploy time, using the tone filter in `config/history-filter.json` |
| `.github/workflows/publish.yml` | Validate, stage, fetch the verse, deploy. Reverts a bad digest commit and opens an issue. Daily backup run and freshness check |

## Run order (America/Chicago)

1. About 6:00 AM: the task writes `digest.json` and pushes.
2. The push triggers `publish.yml`. The backup run at 12:30 UTC (about 6:30 AM CST, 7:30 AM CDT) does the same in case a push did not trigger a deploy, and also checks the digest's age.
3. The market file arrives with P5.

## What `publish.yml` does

1. **build**: validate `digest.json`, `market.json`, `history.json` (a failure stops here). Stage `index.html`, `assets/` and `data/` into `_site/`. Drop the repo's mock `scripture.json` and `history.json`, fetch the KJV verse and the history line, validate each, and keep it only if it passes. Upload the artifact.
2. **deploy**: publish the artifact to GitHub Pages.
3. **revert-bad-data** (push events only, when build failed): if the failing commit changed only `data/digest.json`, revert it and push. Either way, open an issue with the run link. Nothing was deployed, so the last good site stays live. A revert made with the built-in token does not trigger another run.
4. **freshness** (scheduled runs only): if `digest.json` is more than 20 hours old, open a "Digest is stale" issue (one at a time). The page shows its own stale note after 26 hours.

`scripture.json` and `history.json` are generated at deploy time and not committed. If the verse source is down or returns something unexpected, the file is left out and the page shows the reference with a link to read it. If the history feed is down or has no suitable entry, the file is left out and the page tries its own Wikipedia fetch, then a built-in line. The daily backup run (about 6:30 AM Central) refreshes the history line; before it runs, the page's own date check falls back the same way.

## Failure modes

| Failure | What happens |
|---|---|
| Task misses a run | Page keeps the last good digest; stale note after 26 hours; "Digest is stale" issue at the next backup run |
| Task pushes bad JSON or breaks the schema | Build fails, nothing deploys, the commit is reverted, an issue opens |
| Task pushes a valid file with weak content | Not caught by validation. Prompt rules, the eval set and spot checks cover this |
| Verse source down or odd | No `scripture.json` deployed; page shows reference with a link |
| History feed down, or only grim entries | No `history.json` deployed; page falls back to its own fetch, then a built-in line |
| A news source blocks fetching | The task falls back to search snippets and headlines and says less (see `config/sources.json`) |
| A push does not trigger a deploy | The daily backup run deploys the latest `main` |
| Two pushes close together | `pages` concurrency group queues them; no two deploys race |

## Commit hygiene

Digest commits come from the task, touch only `data/digest.json`, and carry the run date in the message (for example `digest: 2026-11-24 morning`). The revert rule depends on that.

## Tests

`node --test` runs `tests/pipeline.test.mjs`: the validator against good and bad data, and the verse and history fetchers against a local fake source (success and every skip path).
