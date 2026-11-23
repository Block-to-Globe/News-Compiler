# Data schema (v1)

All files are UTF-8 JSON. All timestamps are ISO 8601 with offset (for example `2026-11-23T06:05:00-06:00`). All URLs are `https://`. No HTML in any text field. Text is plain; paragraphs are separate array items.

Mock versions of the Action-written files live in `data/` with `"mock": true` (they are never deployed; the publish workflow generates real ones). In `digest.json`, a section that is not live yet is just `{ "mock": true }`. The page shows "Coming soon." for it. The scheduled task replaces a section with a full object (no `mock` field) when that section goes live.

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
| `body` | string[] | required, 1 to 2 items, each max 700 chars. Any number quoted must match `market.json` exactly |
| `sources` | object[] | optional, same shape as above |
| `updatedAt` | timestamp | required |

### `scripture`

| Field | Type | Rules |
|---|---|---|
| `reference` | string | required, from `data/scripture-bank.json`, format like `Psalm 46:1-3` or `Romans 8:28` |
| `theme` | string | required, one of the bank's themes |
| `why` | string | optional, max 160 chars, humble and short |

The task never writes verse text.

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
- `items` ids: `sp500`, `dow`, `nasdaq`, `us10y` (unit `percent`), `wti` (unit `usd`), `gold` (unit `usd`), `dxy` (unit `index`).
- All numbers come from the data source, never from a model.

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

## `data/history.json` (writer: `history.yml` Action)

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

- `digest.json`: stale if `generatedAt` is older than 26 hours.
- `market.json`: the page always shows its `asOf` date.
- `scripture.json`, `history.json`: wrong-day means fallback.

## Changing the schema

Only through the architect agent. Bump `schemaVersion`, update the mock files, validator and page together.
