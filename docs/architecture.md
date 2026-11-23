# Architecture

Static site on GitHub Pages. No server, no build step, no framework, no API key.

```
Scheduled Claude task  -->  data/digest.json     (narrative: 4 news sections, market narrative, scripture reference)
GitHub Action          -->  data/market.json     (exact market numbers)
GitHub Action          -->  data/scripture.json  (exact KJV text for the chosen reference)
GitHub Action          -->  data/history.json    (this day in history)
                              |
                         index.html merges the four files in the browser
```

## One writer per file

| File | Writer |
|---|---|
| `data/digest.json` | Scheduled Claude task |
| `data/market.json` | `market.yml` Action |
| `data/scripture.json` | `publish.yml` Action |
| `data/history.json` | `history.yml` Action |
| `config/sources.json` | Agents via PR (news-ingest-engineer owns) |
| `task/daily-digest-prompt.md` | Agents via PR (summarizer owns) |

## Hosting and paths

Served at `https://block-to-globe.github.io/news-compiler/`. Always use relative paths (`data/digest.json`, never `/data/digest.json`).

## Publish workflow (P3)

One workflow does everything, because commits made with an Action's built-in token do not trigger other workflows:

1. Validate all data files against `docs/digest-schema.md`.
2. Fetch KJV text for the reference in `digest.json` and write `scripture.json`.
3. Deploy to Pages.
4. If validation fails: do not deploy, revert the bad data commit, open an issue. The last good version stays live.

A backup cron re-runs it about 30 minutes after the scheduled task.

## Schedule (America/Chicago, draft)

- Morning ~6:00 AM daily: task writes Local, State, Federal, International and picks the Scripture reference. `history.yml` runs about 5:30 AM.
- Weekdays: `market.yml` after the close (~21:30 UTC), then the task refreshes only the Market narrative around 5:00 PM.

## Failure behavior

Each block of the page loads its own file and handles missing, empty, malformed or stale data on its own. `digest.json` older than ~26 hours triggers a stale banner.
