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
| 2026-11-23 | Words only, minimalist page: summaries of each section, no images, charts, graphs or tables. Market block is the written recap only | Connor's call. `market.json` stays as the source of truth for numbers quoted in the recap |

## Open

- Pick the KJV text source (no-key, public-domain; `bible-api.com` is a candidate) and check its terms and rate limits. Resolve in P6. With the KJV, daily verses in git history are not a copyright concern.
- Market data source (Stooq + FRED preferred). Resolve in P5.
