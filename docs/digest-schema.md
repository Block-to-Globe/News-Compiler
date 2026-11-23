# Data schema (v1)

All files are UTF-8 JSON. All timestamps are ISO 8601 with offset (for example `2026-11-23T06:05:00-06:00`). All URLs are `https://`. No HTML in any text field. Text is plain; paragraphs are separate array items.

Mock versions of the Action-written files live in `data/` with `"mock": true`. The mock `scripture.json` and `history.json` are never deployed (the publish workflow generates real ones at deploy time); the mock `market.json` is replaced by the first successful `market.yml` commit. In `digest.json`, a section that is not live yet is just `{ "mock": true }`. The page shows "Coming soon." for it. The scheduled task replaces a section with a full object (no `mock` field) when that section goes live.

## `data/digest.json` (writer: scheduled Claude task)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-23T06:05:00-06:00",
  "sections": {
    "local":         { "...section..." },
    "state":         { "...section..." },
    "federal":       { "...section..." },
    "international": { "...section..." },
    "market":        { "...market narrative..." }
  },
  "scripture": { "reference": "Psalm 46:1-3", "theme": "comfort", "why": "optional one line" },
  "notes": ["optional internal flags, never shown to readers"]
}
```

### Section (`local`, `state`, `federal`, `international`)

| Field | Type | Rules |
|---|---|---|
| `headline` | string | required, max 90 chars. One line on the biggest story |
| `body` | string[] | required, 1 to 2 items, each max 700 chars |
| `sources` | object[] | required, 1 to 5 items: `{ "title": string, "outlet": string, "url": https URL }` |
| `quiet` | boolean | optional. `true` on a thin news day (body then says so briefly) |
| `updatedAt` | timestamp | required |
| `mock` | boolean | only as `{ "mock": true }` on its own, for a section that is not live yet. A live section never has it |

### Market narrative (`sections.market`)

| Field | Type | Rules |
|---|---|---|
| `asOf` | date `YYYY-MM-DD` | required. Must match `market.json.asOf` at write time |
| `body` | string[] | required, 1 to 2 items, each max 700 chars. Any number quoted must come from `market.json` (see `--check-market`). Without a fresh `market.json`, it quotes no numbers at all |
| `sources` | object[] | optional, same shape as above |
| `updatedAt` | timestamp | required |

**`--check-market`.** The scheduled task runs `node scripts/validate.mjs --only digest --check-market` before it pushes. The deploy does not run it, because `market.json` can move on after the recap was written; the page shows the recap with its own `asOf` date. A recap that is `{ "mock": true }` is not checked. **Written-this-run rule:** the task sets `updatedAt` of every section it writes to the same value as the digest's `generatedAt`. A market recap whose `updatedAt` differs from `generatedAt` was left unchanged this run (an older, already-live recap) and is exempt entirely: no `asOf` match, no number ban, no number checks. Only a recap with `updatedAt == generatedAt` is checked. Otherwise the check has two modes.

*Cross-check mode* (a fresh, non-mock `market.json` with an `items` array):

- `asOf` equals `market.json.asOf`.
- Each paragraph is split into sentences (common abbreviations such as "U.S.", "Nov." and "a.m." do not end a sentence). Item names are found by label or a known alias: "S&P"/"S&P 500", "Dow"/"Dow Jones", "Nasdaq", "10-year"/"Treasury"/"yield", "WTI"/"crude"/"oil", "gold", "dollar"/"dollar index"/"DXY". The digits inside a name (the "500" in "S&P 500", the "10" in "10-year") are not read as quotes.
- Every checked number must match an item named in the **same sentence**. A sentence that names no item **inherits the previous sentence's items** (within the same paragraph, chaining back through sentences that also name none). A checked number in a sentence with no named or inherited item fails.
- A number matches when it equals the item's `value`, `change` or `changePct` after rounding the `market.json` figure to the number of decimals quoted ("6,032" matches 6032.38; "0.4%" matches 0.41). Magnitudes are compared without the sign; commas and a leading `+`/`-` are allowed. By suffix:
  - `%` or "percent": `changePct`, or for the 10-year yield (`unit: "percent"`) also its `value` or `change`.
  - "basis points"/"bps": the 10-year yield only; the number must equal `round(|change| * 100)` (a `change` of -0.04 is "4 basis points").
  - `$`, "points", "percentage points" or no suffix: `value` or `change`.
- **Which numbers are checked.** Any number with a decimal point or a thousands comma, any whole number of 1,000 or more, and any whole number of any size that is followed by `%`, "percent", "points", "percentage points" or "basis points"/"bps", or preceded by `$`. Not checked: years (a bare four-digit number within one year of `market.json.asOf`'s year), dates after a month name ("Nov. 21"), ordinals ("21st"), parts of `YYYY-MM-DD` or `11/21` dates, and clock times ("4:00").
- **Known gap:** bare whole numbers under 1,000 with no unit ("the dollar index at 105", "3 of 7 sectors") are not checked, because they cannot be told apart from counts. The summarizer must still take every such figure from `market.json`; the validator just cannot prove it.
- **Direction words** are checked only when tied to the item: a move verb right after the item name ("oil rose", "the Dow fell"), or any direction word in a sentence that also quotes a number matching that item. "higher", "lower", "up" and "down" with no number tied to the item are not checked. The words (rose, gained, climbed, up, higher / fell, slipped, declined, down, lower, and so on) are checked against the **sign of `change` only** (never `changePct`) of the nearest item named in that same sentence. A word that contradicts the sign fails; "flat", "unchanged" or "little changed" needs `change` of exactly 0. Direction words are checked only in sentences that name an item themselves, not in sentences that inherit one.

*Skip mode* (no cross-check, for a recap written this run): when `market.json` is missing, unparseable, has `"mock": true`, has no `items` array, or its `asOf` is more than 4 days before today's America/Chicago date. Age is measured on `asOf`, never `fetchedAt`, because `market.yml` does not commit a fetch that only changed `fetchedAt`. Item labels ("S&P 500", "10-year") are blanked first and are not digit tokens. The validator prints a notice, then **fails on any digit token** in `body` that is not a year (four digits from 1900 to 2100, not preceded by `$` or followed by `%`/"percent"), a date after a month name, an ordinal, a part of a `YYYY-MM-DD` or `11/21` date, or a clock time. So a recap written without fresh data can quote no prices, changes or percentages. `asOf` equality is not checked in this mode.

*Testing.* `--now <ISO timestamp>` overrides the clock used to work out today's Central date for the 4-day freshness rule (for tests only; the scheduled task never passes it). Example: `node scripts/validate.mjs --only digest --check-market --now 2026-11-23T14:00:00Z`.

**Opening line.** The morning recap always reports a past close. When the recap's `asOf` is earlier than today's date in America/Chicago, the first sentence names the day of that close ("At Monday's close..." on a Tuesday morning). When a weekend or holiday sits between that close and today, it also says markets were closed ("Markets were closed Thursday for Thanksgiving; here's Wednesday's close..."). It never implies the numbers are from today.

### `scripture`

| Field | Type | Rules |
|---|---|---|
| `reference` | string | required, from `data/scripture-bank.json`, format like `Psalm 46:1-3` or `Romans 8:28` |
| `theme` | string | required, one of the bank's themes |
| `why` | string | optional, max 160 chars, humble and short |

The task never writes verse text.

## `data/scripture-bank.json` entries (writer: PR, owned by scripture-curator)

Read by the task and by `scripts/check-bank.mjs`; nothing writes it at run time.

| Field | Type | Rules |
|---|---|---|
| `reference` | string | required, same format as `scripture.reference` |
| `theme` | string | required, one of the bank's `themes` |
| `avoidOnPoliticalDays` | boolean | optional, default `false`. When `true`, the task does not pick this verse on a day whose lead stories are elections, partisan fights or a named politician, so the verse cannot read as commentary |
| `avoidOnCrimeDays` | boolean | optional, default `false`. When `true`, the task does not pick this verse on a day whose lead stories include a violent crime or a criminal case |

Both flags are optional additions; an entry without them is valid and `schemaVersion` does not change.

## `data/market.json` (writer: `market.yml` Action)

```json
{
  "schemaVersion": 1,
  "fetchedAt": "2026-11-21T15:35:00-06:00",
  "asOf": "2026-11-21",
  "marketStatus": "closed",
  "note": "optional, e.g. 'Markets closed for the holiday; showing last close.'",
  "items": [
    { "id": "sp500", "label": "S&P 500", "value": 0.00, "change": 0.00, "changePct": 0.00, "unit": "points" }
  ],
  "source": "name of data source"
}
```

- `marketStatus`: `open`, `closed`, `weekend`, `holiday`.
- `items`: required, **exactly 7 items with unique `id`s**, one each of `sp500`, `dow`, `nasdaq` (unit `points`), `us10y` (unit `percent`), `wti` (unit `usd`), `gold` (unit `usd`), `dxy` (unit `index`). A missing, extra or duplicated id fails validation. The fetcher is all-or-nothing, so a partial file is never written.
- All numbers come from the data source, never from a model.
- `market.yml` commits the file only when something other than `fetchedAt` changed (so a re-fetch of the same close makes no commit, and the committed `fetchedAt` can be older than the last run). When the fetch fails, nothing is committed, the last good file stays, and the workflow opens an issue.

## `data/scripture.json` (writer: `publish.yml` Action)

```json
{
  "schemaVersion": 1,
  "fetchedAt": "2026-11-23T06:20:00-06:00",
  "reference": "Psalm 46:1-3",
  "translation": "KJV",
  "text": "verse text from a public-domain KJV source"
}
```

`reference` must equal `digest.json.scripture.reference`. If they differ, or the file is missing, the page shows the reference with a link instead of text.

## `data/history.json` (writer: `publish.yml` Action, via `scripts/fetch-history.mjs`)

```json
{
  "schemaVersion": 1,
  "date": "2026-11-23",
  "year": 1000,
  "text": "One or two sentences.",
  "url": "https://en.wikipedia.org/wiki/...",
  "fetchedAt": "2026-11-23T05:30:00-06:00"
}
```

The page ignores this file if `date` is not today's local date and falls back to a client-side Wikipedia fetch.

## Staleness

- `digest.json`: stale if `generatedAt` is older than 26 hours (page-wide banner).
- Each live section (including `market`): when its `updatedAt` is more than about 30 hours old, the page shows a small muted "Last updated <day/time>" hint under that section only. The section still renders.
- `market.json`: the page always shows its `asOf` date.
- `scripture.json`, `history.json`: wrong-day means fallback.

## Changing the schema

Only through the architect agent. Bump `schemaVersion`, update the mock files, validator and page together.
