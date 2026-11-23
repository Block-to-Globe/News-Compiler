# Block to Globe

A simple daily news digest, from your block to the globe. Five short sections, a "this day in history" line on top, and an ESV Bible verse at the bottom.

**Live site:** https://block-to-globe.github.io/news-compiler/

## Sections

1. **Local:** Shelby County, TN
2. **State:** Tennessee
3. **Federal:** U.S. national news
4. **International**
5. **Market recap:** latest completed trading day

## How it works

- A scheduled Claude task researches the day's news and writes `data/digest.json`.
- GitHub Actions fetch the exact market numbers (`data/market.json`), the day's ESV verse text (`data/scripture.json`) and the history line (`data/history.json`).
- The page is plain HTML/CSS/JS on GitHub Pages. It loads the four data files and merges them. If one is missing or stale, only that block degrades.

See `docs/architecture.md` for details and `docs/digest-schema.md` for the data contract.

## Status

Milestone P1 (repo, contracts, first deploy). The page currently shows a placeholder.

## Scripture

Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.

## License

Code is MIT licensed (see `LICENSE`). ESV text is not covered by that license.
