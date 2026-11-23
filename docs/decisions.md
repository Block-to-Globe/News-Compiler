# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-23 | Org **Block to Globe**, repo **News Compiler**, site at `block-to-globe.github.io/news-compiler/` | Connor's naming |
| 2026-11-23 | No Anthropic API key. A scheduled Claude task writes the digest and pushes it | Avoid a separate API bill; uses Claude plan usage |
| 2026-11-23 | Fixed location: Shelby County, TN (local) and Tennessee (state). No Worker, no location prompt | Simplicity; a picker is a later feature |
| 2026-11-23 | ESV translation, references only in repo, text fetched from the ESV API, notice in footer. **Superseded 2026-11-23 by the KJV decision below** | Crossway terms; Scripture never model-typed |
| 2026-11-23 | One writer per file; four separate data files | Prevent merge conflicts, isolate failures |
| 2026-11-23 | Validate, fetch Scripture text, and deploy inside one workflow | Built-in-token commits don't trigger other workflows |
| 2026-11-23 | MIT license for code | Simple default; Scripture text is separate (KJV, public domain) |
| 2026-11-23 | **KJV instead of ESV.** Verse shown with reference and "KJV"; footer says it is public domain in the US. No ESV API key, no Crossway permissions to track | Connor's call, to avoid copyright. Text still comes from a source, never model-typed |
| 2026-11-23 | `publish.yml` replaces `pages.yml`: validate, stage, fetch verse, deploy, revert-on-failure, backup cron, freshness check | P3. One workflow because built-in-token commits do not trigger others |
| 2026-11-23 | `scripture.json` is generated at deploy time and not committed. If the fetch fails the file is omitted and the page shows the reference with a link | One writer, no daily commits, no stale or mock verse can go live |
| 2026-11-23 | Provisional verse source: bible-api.com (free, no key). Final choice in P6 | Keep P3 moving; the fetcher validates translation and reference so a bad source cannot publish a wrong verse |
| 2026-11-23 | Freshness check flags a digest older than 20 hours at the 12:30 UTC run; page stale banner stays at 26 hours. **Run time superseded 2026-11-23: now 13:30 UTC (see D-contract-hardening)** | A missed morning run is about 24.5 hours old at check time |
| 2026-11-23 | `history.json` is generated at deploy time like the verse: `scripts/fetch-history.mjs` plus `config/history-filter.json`. Not committed | Same reasoning as the verse. Skips grim entries entirely; prefers linked, well-documented firsts. Done early (P6 item) because it needs no news task |
| 2026-11-23 | Words only, minimalist page: summaries of each section, no images, charts, graphs or tables. Market block is the written recap only | Connor's call. `market.json` stays as the source of truth for numbers quoted in the recap |

## Open

- Pick the KJV text source (no-key, public-domain; `bible-api.com` is a candidate) and check its terms and rate limits. Resolve in P6. With the KJV, daily verses in git history are not a copyright concern.
- Market data source (Stooq + FRED preferred). Resolve in P5.

## D-market: provisional no-key source for market numbers
Stooq now needs a CAPTCHA-derived key and FRED needs a free key, so the market fetcher uses Yahoo Finance's public chart endpoint (no key, unofficial) for the seven items. It is all-or-nothing: if any item fails, nothing is written and the last good file stays. The swap point is `ITEMS` and `parse()` in `scripts/fetch-market.mjs`. If it proves flaky, the fallback is a free FRED key stored as an Actions secret (Connor's call).

## D-market-recap: one morning run writes the recap
The morning task reads the previous close from `market.json` and writes the recap, so there is no second (evening) task run. Quoted numbers are enforced by `validate.mjs --check-market`, run only by the task, so a new `market.json` landing after the recap never blocks a deploy. Weekends and holidays reuse the last close with an explicit "markets closed" opening line.

## D-local-state: Local and State join the morning run (P4)
Same run, same validator. Classification rule: one story, one section; Shelby County stories are Local even when the state is involved, statewide and non-Shelby Tennessee stories are State. Crime and court items report only what officials or records say and do not name uncharged people. Quiet days are written as quiet. Outlet fetch results are reported back after each run so `config/sources.json` can be updated by PR.

## D-contract-hardening (2026-11-23): market checks, staleness hints, bank flags, workflow fixes
Schema stays v1; the only new fields are two optional booleans on scripture-bank entries.

| What | Why | Alternatives considered |
|---|---|---|
| `market.json` must hold exactly the 7 items, unique ids | The recap check and the page assume every item exists once | Allow partial files (rejected: a missing item makes quoted numbers unverifiable) |
| `--check-market` ties each number to the item named in the same sentence and checks direction words against the sign of `change` | "Found anywhere in market.json" let a Dow number sit next to "the S&P" or "fell" sit next to a gain | Structured recap fields instead of prose (rejected: Connor wants words only) |
| `--check-market` is skipped when `market.json` is missing, mock, or its `asOf` is more than 4 days old | Lets the task run before real data exists and across a failed-fetch streak without blocking the whole digest. 4 days covers a long holiday weekend | Fail the run (rejected: one bad feed would take down all five sections) |
| Recap opens by naming the day of the close; says "markets were closed" on weekends and holidays | The morning recap always reports a past session and must not read as today's numbers | Hide the recap on closed days (rejected: a short "markets were closed" line is more useful) |
| Page shows a per-section "Last updated" hint when that section's `updatedAt` is over about 30 hours old | A partial task run can leave one section old while `generatedAt` is fresh; the 26-hour banner would miss it | Hide old sections (rejected: graceful degradation keeps content visible) |
| Optional bank flags `avoidOnPoliticalDays`, `avoidOnCrimeDays` | Keeps a verse from reading as commentary on the day's top story | Separate "safe" bank (rejected: duplicate list to maintain) |
| Backup deploy and freshness check move from 12:30 to 13:30 UTC | More margin after the ~6:00 AM Central task, which can run long or start late. A missed run is about 25.5 hours old (CST) or 26.5 hours (CDT) at check time, so the 20-hour threshold still catches it | Keep 12:30 (rejected: 30 minutes is little margin for a long task run) |
| Revert job fires only when the validate step fails, not on staging, Pages setup, upload or deploy failures | An infrastructure blip must never revert a good digest | Revert on any build failure (the previous behavior) |
| `market.yml` opens an issue when the fetch fails, and commits only when something other than `fetchedAt` changed | A silent failure streak was invisible; a commit that only bumps `fetchedAt` is noise and triggers a pointless deploy | Commit every run (rejected: noise); rely on the recap check (rejected: it is skipped when data is old) |
