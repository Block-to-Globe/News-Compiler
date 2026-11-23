# Market data

`data/market.json` is written only by the `market.yml` GitHub Action (`scripts/fetch-market.mjs`). The narrative in `digest.json` is written by the scheduled Claude task from those exact numbers. A model never types a price or percentage on its own.

## Source

- Yahoo Finance public chart endpoint: `https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?range=10d&interval=1d`. No key. It is unofficial and undocumented, so it can change shape, rate-limit (HTTP 429) or block cloud IPs without notice. Treat it as fragile.
- Symbols: `^GSPC`, `^DJI`, `^IXIC`, `^TNX` (10-year yield, in percent), `CL=F` (WTI), `GC=F` (gold), `DX-Y.NYB` (dollar index).
- Terms: personal, non-commercial use of free delayed data. Keep it to one fetch per symbol per run (7 requests per weekday).
- Stooq now needs a key and FRED needs a free key, so Yahoo is the provisional no-key choice. Test it for a week of runs before depending on it.

## Fallback plan

If Yahoo breaks, the swap is confined to `ITEMS` and `parse()` in `scripts/fetch-market.mjs`.

- FRED (free key, stored as an Actions secret, never in the repo or client code): `SP500`, `DJIA`, `NASDAQCOM`, `DGS10`, `DCOILWTICO`, `DTWEXBGS` (broad dollar index; not the same as DXY). FRED has no gold series, and lags a day.
- U.S. Treasury daily par yield curve (no key) for the 10-year yield.
- A paid or keyed source needs Connor's OK first.
- Until a swap happens, a failed fetch writes nothing, keeps the last good file, and the workflow opens an issue.

## Rules in the fetcher

- Runs weekdays about 21:30 UTC (after the close in CST and CDT).
- All seven items must come back clean, or nothing is written (exit 1).
- The last two COMPLETE daily closes are used. A latest bar is dropped when its close is null, zero or missing, or when it is dated today (ET) and the run is before 16:30 ET (live value, not a close).
- Every item's date must be within 3 days of the S&P 500 date, otherwise nothing is written.
- `marketStatus`: `weekend` on Sat/Sun (with a note). `holiday` (note "Markets were closed today; showing the last close.") only when it is a weekday AND the time is 16:30 ET or later AND the last bar is before today. Otherwise `closed` (after 16:30 ET with a bar for today) or `open`, with no note, so a lagging source never produces a false "closed today" claim.
- Early closes (day after Thanksgiving, Christmas Eve) are not detected yet; the numbers are still the day's close.

## Validation (`scripts/validate.mjs`)

- `market.json`: exactly 7 items with unique known ids, all numbers finite, values above zero.
- With `--check-market` (scheduled task only) the recap is checked against `market.json`: asOf equal; every number tied to an item named in the same sentence (value, change or changePct, magnitude only; a sentence naming no item may not quote numbers, except it inherits the previous sentence's items); direction words must agree with the sign of `change`; "flat/unchanged" needs a change of 0. Dates, ordinals, years and small bare whole numbers are not treated as quotes, but whole numbers with `%`, `$`, "points" or "basis points" are.
- The cross-check is skipped (exit 0, notice printed) when `market.json` is missing, mock, or its `asOf` is more than 4 days before today's Central date. In that case the recap may quote no numbers at all (only years and dates), so the push fails if the task wrote numbers it could not verify.

## Weekends and holidays

- `market.yml` runs Mon-Fri only. On Saturday, Sunday and Monday mornings (and the morning after a holiday) `market.json` still holds the last close, with its own `asOf`.
- The page always shows the `asOf` date of the market block.
- Rule for the recap (summarizer): compare today's Central date with `market.json` `asOf`; when different, open with a markets-closed/last-close line naming the weekday of that close.
- Not investment advice: a short note sits in the page footer, not in the body.
