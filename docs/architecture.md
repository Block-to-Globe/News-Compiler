# Architecture

Static site on GitHub Pages. No server, no build step, no framework, no API key.

```
Scheduled Claude task  -->  data/digest.json     (narrative: 4 news sections, market narrative, scripture reference)
GitHub Action          -->  data/market.json     (exact market numbers)
GitHub Action          -->  data/scripture.json  (exact KJV text for the chosen reference)
GitHub Action          -->  data/history.json    (this day in history, generated at deploy time)
                              |
                         index.html merges the four files in the browser
```

## One writer per file

| File | Writer |
|---|---|
| `data/digest.json` | Scheduled Claude task |
| `data/market.json` | `market.yml` Action |
| `data/scripture.json` | `publish.yml` Action (generated at deploy time, not committed) |
| `data/history.json` | `publish.yml` Action via `scripts/fetch-history.mjs` (generated at deploy time, not committed) |
| `data/scripture-bank.json` | Agents via PR (scripture-curator owns) |
| `config/sources.json` | Agents via PR (news-ingest-engineer owns) |
| `task/daily-digest-prompt.md` | Agents via PR (summarizer owns) |

## Hosting and paths

Served at `https://block-to-globe.github.io/News-Compiler/`. Always use relative paths (`data/digest.json`, never `/data/digest.json`).

## Publish workflow (P3)

One workflow does everything, because commits made with an Action's built-in token do not trigger other workflows:

1. Validate all data files against `docs/digest-schema.md`.
2. Fetch KJV text for the reference in `digest.json` and write `scripture.json`; fetch the history line and write `history.json`.
3. Deploy to Pages.
4. If **validation** fails: do not deploy, revert the bad data commit (only when it touched nothing but `data/digest.json`), open an issue. The last good version stays live. A failure anywhere else (staging, Pages setup, upload, deploy) opens no revert, because the data was fine.

A backup cron at **13:30 UTC** (7:30 AM CST, 8:30 AM CDT) re-runs it in case a push did not trigger a deploy, and runs the freshness check.

## Schedule

- Morning ~5:32 AM Central daily (about 11:32 UTC winter, 10:32 UTC summer): one task run writes Local, State, Federal, International, the Market recap (from the previous close in `market.json`) and picks the Scripture reference. There is no evening task run.
- 13:30 UTC daily: `publish.yml` backup deploy and freshness check (history line and verse are regenerated on every deploy).
- Weekdays 21:30 UTC: `market.yml` fetches the close, commits `market.json` only when something other than `fetchedAt` changed, then dispatches `publish.yml`. If the fetch fails it commits nothing and opens an issue.

Details and the missed-run rules are in `docs/pipeline.md`.

## Failure behavior

Each block of the page loads its own file and handles missing, empty, malformed or stale data on its own. `digest.json` older than ~26 hours triggers a stale banner; a section whose `updatedAt` is more than about 30 hours old gets its own "Last updated" hint.
