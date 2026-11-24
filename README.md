# Block to Globe

A simple daily news digest, from your block to the globe. Five short sections, a "this day in history" line on top, and a KJV Bible verse at the bottom.

**Live site:** https://block-to-globe.github.io/News-Compiler/

## Sections

1. **Local:** Shelby County, TN
2. **State:** Tennessee
3. **Federal:** U.S. national news
4. **International**
5. **Market recap:** latest completed trading day

## How it works

- A scheduled Claude task researches the day's news and writes `data/digest.json`.
- GitHub Actions fetch the exact market numbers (`data/market.json`), the day's KJV verse text (`data/scripture.json`) and the history line (`data/history.json`).
- The page is plain HTML/CSS/JS on GitHub Pages. It loads the four data files and merges them. If one is missing or stale, only that block degrades.

See `docs/architecture.md` for details and `docs/digest-schema.md` for the data contract.

## Status

Milestones P1 to P6 are built (pipeline, market recap, Local and State, verse bank, history line, tone lint). P7 (QA and a week of real daily runs) is in progress. Sections the task has not written yet show "Coming soon."

## Scripture

Scripture quotations are from the King James Version (KJV) of the Holy Bible, which is in the public domain in the United States.

## License

Code is MIT licensed (see `LICENSE`). Scripture text is the KJV, which is in the public domain in the United States.
