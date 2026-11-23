# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-23 | Org **Block to Globe**, repo **News Compiler**, site at `block-to-globe.github.io/news-compiler/` | Connor's naming |
| 2026-11-23 | No Anthropic API key. A scheduled Claude task writes the digest and pushes it | Avoid a separate API bill; uses Claude plan usage |
| 2026-11-23 | Fixed location: Shelby County, TN (local) and Tennessee (state). No Worker, no location prompt | Simplicity; a picker is a later feature |
| 2026-11-23 | ESV translation, references only in repo, text fetched from the ESV API, notice in footer | Crossway terms; Scripture never model-typed |
| 2026-11-23 | One writer per file; four separate data files | Prevent merge conflicts, isolate failures |
| 2026-11-23 | Validate, fetch ESV, and deploy inside one workflow | Built-in-token commits don't trigger other workflows |
| 2026-11-23 | MIT license for code | Simple default; ESV text excluded |

## Open

- Does a daily verse accumulating in git history fit Crossway's terms? Resolve in P6 (read terms, ask Crossway, or keep `scripture.json` out of git).
- Market data source (Stooq + FRED preferred). Resolve in P5.
