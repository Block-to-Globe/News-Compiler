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
| 2026-11-23 | Freshness check flags a digest older than 20 hours at the 12:30 UTC run; page stale banner stays at 26 hours | A missed morning run is about 24.5 hours old at check time |
| 2026-11-23 | `history.json` is generated at deploy time like the verse: `scripts/fetch-history.mjs` plus `config/history-filter.json`. Not committed | Same reasoning as the verse. Skips grim entries entirely; prefers linked, well-documented firsts. Done early (P6 item) because it needs no news task |
| 2026-11-23 | Words only, minimalist page: summaries of each section, no images, charts, graphs or tables. Market block is the written recap only | Connor's call. `market.json` stays as the source of truth for numbers quoted in the recap |

## Open

- Pick the KJV text source (no-key, public-domain; `bible-api.com` is a candidate) and check its terms and rate limits. Resolve in P6. With the KJV, daily verses in git history are not a copyright concern.
- Market data source (Stooq + FRED preferred). Resolve in P5.

## D-market: provisional no-key source for market numbers
Stooq now needs a CAPTCHA-derived key and FRED needs a free key, so the market fetcher uses Yahoo Finance's public chart endpoint (no key, unofficial) for the seven items. It is all-or-nothing: if any item fails, nothing is written and the last good file stays. The swap point is `ITEMS` and `parse()` in `scripts/fetch-market.mjs`. If it proves flaky, the fallback is a free FRED key stored as an Actions secret (Connor's call).

## D-market-recap: one morning run writes the recap
The morning task reads the previous close from `market.json` and writes the recap, so there is no second (evening) task run. Quoted numbers are enforced by `validate.mjs --check-market`, run only by the task, so a new `market.json` landing after the recap never blocks a deploy. Weekends and holidays reuse the last close with an explicit "markets closed" opening line.
