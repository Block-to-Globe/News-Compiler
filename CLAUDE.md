# Block to Globe (repo: News Compiler)

A simple daily news digest site: Local (Shelby County, TN), State (Tennessee), Federal, International, Market recap, a "this day in history" line on top, and a KJV Bible verse at the bottom. Live at https://block-to-globe.github.io/News-Compiler/ (the repo name uses capitals, and Pages paths are case-sensitive)

Owner: Connor. Style for anything written on his behalf: informal and lighthearted, but fact-based and straight to the point.

Full plan: see `docs/architecture.md` and the roadmap in the News Compiler Claude Project. Agents are in `.claude/agents/`.

## Rules (read before changing anything)

1. **One writer per file.** `data/digest.json` is written only by the scheduled Claude task. `data/market.json`, `data/scripture.json`, `data/history.json` are written only by GitHub Actions. `config/sources.json` and `task/daily-digest-prompt.md` change through PRs. If you need a change in a file you don't own, ask the owner.
2. **Relative paths only.** The site is served from `/News-Compiler/`, so never use a leading `/` in links, scripts, styles or `fetch()` URLs.
3. **No secrets in the repo or client code.** There is no Anthropic API key and no Scripture API key (the KJV source needs none).
4. **Numbers and Scripture are never model-typed.** Market numbers come from `market.json`; verse text comes from a public-domain KJV source.
5. **Neutral, original, short.** News summaries are 1-2 paragraphs in original wording with source links. No article text copied. No editorializing.
6. **Graceful degradation.** A missing, stale or malformed data file must only affect its own block on the page.
7. **No build step, no framework, no analytics, no trackers.** Vanilla HTML/CSS/JS.
8. **KJV only.** Show the verse with its reference and "KJV", and keep the public-domain note in the footer.
9. **Schema first.** `docs/digest-schema.md` is the contract. Change it only through the architect agent, then update the mock files in `data/`.

## Working agreement

- One milestone at a time (P1 to P7), in order. Each ends with `qa-release-guard` checking the "Done when" line.
- Commits touching `data/` from the scheduled task contain only `data/digest.json`.
- Keep workflows small and readable.
