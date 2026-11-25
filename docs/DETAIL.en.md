# Gugu Stock v1.24.4 · Personal ledger (dsh-gugu-stock)

A DeepSeek Harness plugin that keeps one local CSV of "money balances" and draws
the balance line chart and the spend bar chart from it, in Python, on demand.

## Versioning

- The version lives in `package.json` (`version`), `client.js` (`titleSuffix`),
  `locale/zh.json` + `locale/en.json` (`title` and `titleSuffix`), this file, and
  `README.md`.
- Whenever the source changes, bump `x` of `1.x` by one (`1.17 → 1.18`). The minor
  part stays `1` unless the user explicitly asks for `2.0`.

## Data

- Path: `%USERPROFILE%\.dsh\data\gugu-stock\balances-v2.csv`
  (override the directory with `GUGU_STOCK_DIR`).
- Encoding: UTF-8 with BOM, CRLF line endings, so Excel / WPS can open it for
  reading and writing.
- Header: `时间,来源,余额` — time `YYYY-MM-DD HH:mm:ss` (seconds included), source
  `ds` (DeepSeek balance, CNY) / `wb` (WorkBuddy credits) / `al` (Aliyun coupon
  balance, CNY) / `ut` (cumulative tokens consumed, integer, since v1.19 — a
  spend, not a balance), then the value with up to 6 decimals.
- Older two-column files (`时间,ds/wb,余额` or `时间,余额`) are read too.
- Manual rows are welcome, including tab-separated pastes
  (`2026/11/11 14:22<Tab>al<Tab>300`); `/` and `-` both work in dates.
- **One CSV, append only.** Every sample appends one row at the *end* of the file
  (oldest first, newest at the bottom). Nothing is rewritten, sorted away, or
  deleted; a row whose `(time, source)` already exists is skipped, so no
  duplicates are produced.
- **Automatic ordering.** If a row lands out of order (for example because Excel
  saved the sheet with its own row order and moved a block to the top), the plugin
  re-sorts the file by time *before each chart and after each sample*. Sorting only
  reorders: no row is removed, the encoding is untouched, and every line keeps its
  original bytes. There is no "tidy" button. `state.lastTidyAt`,
  `state.lastTidyMoved`, `state.lastTidyReason` report what happened.
- **No sidecar file.** An earlier `balances-v2.csv.sticky` shadow table existed to
  fight external rewrites; it has been removed. Everything lives in
  `balances-v2.csv` alone.
- If several DSH instances run at the same time, they all append to the same CSV;
  the plugin itself never deletes anything, but keeping a single DSH instance open
  is the only way to rule out interference from outside tools.

## Sampling

- At boot the plugin samples once after about 5 seconds, then once every 15 minutes.
- DeepSeek balance: `DEEPSEEK_API_KEY` against
  `https://api.deepseek.com/user/balance` (`total_balance`), falling back to the
  DeepSeek account already signed in to DSH.
- WorkBuddy credits: the `dsh-connect-workbuddy` loopback route
  `GET /plugins/dsh-connect-workbuddy/account-credits`. **When that route lists
  several accounts, they are summed** (since v1.18.4 — earlier builds used only
  the account whose `selected` is `true`, which under-counted multi-account
  setups). Accounts whose `credits` is `null` or missing are skipped rather than
  counted as 0; `/state` also exposes `wbAccounts` and `wbAccountCount`.
- Aliyun coupon balance is opt-in and off by default (needs a cookie configured in
  the settings page).
- A failing source only sets `lastWbError` / `lastAliyunError`; the other sources
  still write their rows.

## Sidebar entry

The left rail gets a Gugu Stock button (`sidebar.panellist`, id `gugu-stock`,
order 40) that opens the same Gugu Stock tab as the settings section. Both views
talk to the same host plugin and the same CSV.

## Settings page

- Header: `谷谷股` / `Gugu Stock` plus the version suffix.
- Four primary actions: reset to the last 60 days, sample now, line chart, spend
  chart.
- Chart options: colour source (`增减` = green down / red up / light grey flat, or
  `数据源` = one colour per series), theme (light / dark / auto), and whether WB and
  Aliyun appear in the line chart.
- The chart is rendered by `scripts/gugu_chart.py` with matplotlib and comes back
  as a PNG data URL, so no external service is involved.

## Line chart specification

- One node per CSV row; segments are coloured per direction (down = green,
  up = red, flat = light grey).
- Only each day's final node shows the marker and its value.
- X axis: equal spacing per date, labelled `MM-DD`.
- Y axis: bounds snapped outward to a multiple of **10**, a gridline every **10**
  (v1.17 changed this from 25), and a flat series padded to at least a two-step
  window (100 → 90..110).
- Up to the last 60 days of daily closing balances.

## Spend bar chart

- Per day, one bar per series, all bars the same width, distinguished by colour
  and by hatch pattern (`ds` solid, `wb` `///`, `aliyun` `...`).
- Bar totals take the series colour (`labelColor`), never the neutral text colour.
- A 22% headroom above the tallest bar keeps the in-axes legend from covering it.

## HTTP API (prefix `/gugu-stock/api`)

- `GET /state` — rows, `latestTime`, `latestBalance`, `intervalMs`, `outOfOrder`,
  `lastTidy*`, `chartMeta`.
- `POST /sample` — sample now.
- `POST /chart` — render; body `{ kind: 'line' | 'spend', theme, colorMode, days }`.
- `POST /open-csv` — open the CSV with the OS default application.
- `POST /normalize` — force one ordering pass (kept for troubleshooting).
- Every route requires the GUI session token; requests without it answer 403.

## Skill channel (v1.18.2)

The `~/.dsh/skills/gugu-stock-charts` helper exists so any conversation can get both charts in one command. It renders with the very same script the panel uses, and every parameter comes from the panel's settings:

- `theme` / `colorMode` / `sources` / `scales` (including `wbPercent`) are read from `settings.json` and clamped exactly the way `index.js` clamps them. A saved `auto` theme is resolved to light, because the skill cannot see the page theme.
- The window always equals the panel default: today minus 59 days through today.
- The generated arguments match `generateChart()` one for one, except that the host's `--json` becomes `--meta` so the metadata lands in a file.
- The PNG is therefore byte-identical to the one the panel buttons produce; `acceptance/tests/skill-parity.test.mjs` pins this with sha256 for both the line and the spend chart.
- Visual overrides are refused: `--days` / `--from` / `--to` / `--theme` / `--wb-percent` / `--sources` / `--color-mode` / `--scale-*` exit with `GUGU_FIXED_SETTINGS` (exit 64). Only `--out`, `--only` and `--no-sample` are accepted, and none of them changes the picture.
- A missing or broken `settings.json` falls back to the plugin defaults (light / change / ds+wb / 100·3.25·12.5) and prints `GUGU_SETTINGS_NOTE` instead of guessing silently.

### One command, two steps

`bash ~/.dsh/skills/gugu-stock-charts/scripts/gugu-charts.sh` is the only entry point. The calling agent runs it once and hands the two paths printed on the `SEND` line to `present` (or `dsh_im_return_file` on IM):

- Settings, time window and CSV freshness are computed in a single python process.
- Both charts render in parallel.
- Sampling is skipped when the last CSV row is younger than 120 seconds (`GUGU_SAMPLE_SKIP fresh`).
- Renders are cached by `CSV size+mtime | settings.json contents | gugu_chart.py size+mtime | --only`; a hit reuses the previous PNGs (`GUGU_CACHE_HIT`).
- matplotlib is checked only after a render actually fails on the import, then installed once and retried.
- Output ends with `SUMMARY`, `CHART_FILES`, `WINDOWS_PATHS`, `SEND` and `ELAPSED_MS`.

Measured: cold start **5.5s → 1.4s**, **0.64s** when nothing changed.

## Token spend source (v1.19)

The fourth series, shaped by the user's own rules (m09984 / m09998 / m10385 / m11760):

1. **Data**: the sum of tokens consumed by *every* DSH session, **archived sessions included**. It is sampled every 15 minutes into a `ut` row of the same CSV; the value is the **cumulative integer total**, with no unit conversion and nothing for the caller to type.
2. **Line chart**: `ut` draws **no line and no markers** (v1.20.4) — only the **area between the curve and zero** is filled translucent purple (`#7c3aed` light / `#a78bfa` dark, alpha 0.30). It measures spend, so up-red / down-green would be meaningless, hence purple in both colour modes. Only each day's last sample carries a number. **Where the number goes** (v1.20.6): ut numbers are never drawn inside the plot — they sit **under the x-axis, above the date labels**, one purple value per date, staggered across two rows because a label like `2亿1千万` is wider than a day slot. Implemented by `ut_axis_items()` + `draw_ut_axis_labels()`, with the tick pad raised to 23, the canvas grown to 6.15in and `tight_layout(rect=(0, 0.10, 1, 1))` reserving the band.
3. **Midnight is always 0**: a day's spend is the cumulative value at a sample minus the *previous day's last* sample. The chart pins each day's first point to `00:00:00 / 0`, draws the running total for later samples, and starts over at 0 the next day. The very first day has no baseline, so it starts at 0 rather than counting the whole history as one day.
4. **Days without data still draw** (from v1.19): the ut line and bars cover the *whole* window — a day with no `ut` sample (or any date before v1.19) is drawn as `0`: the line runs along zero, the bar has zero height, and the bar label reads `0`. Implemented by `ut_day_info()`, which returns `{"value": 0.0, "points": [("00:00:00", 0.0)]}` for a missing day, with `tokens_days` / `ut_days` taken straight from the window.
5. **Only ut (purple) uses coarse Chinese units** (v1.20.7, m12655): the largest unit not exceeding the value, coefficient floored — `732万` prints as `7百万`, `4876万` as `4千万`, `1亿1578万` as `1亿1千万`, `1376` as `1千`, `167` as `1百`, `67` as `67`. Implemented by `token_label()` → `coarse_label()`. **DS / WB / Aliyun stay plain Arabic integers** (`label_text()`: round to nearest integer, `1008.40 → 1008`), and panel numbers have their own rule (`fmtCoarse` in `client.js`) — three independent formatters.
6. **Bar chart**: one **translucent purple** bar per day (alpha 0.30) that spans the **whole day slot** and sits **behind** the DS/WB/Aliyun bars (`zorder 1.4`); height = spend / scale, label in the same coarse units (`0` on days without data).
7. **Scaling**: tokens are a spend, so percentages are useless here. `ut` scales by a **divisor — how many tokens one y-axis unit is worth** — default **5,000,000**, range `[1000, 1e9]`, step 100,000. Host `clampScale('ut', …)`, `/state`'s `scaleSteps.ut` / `scaleRanges.ut` / `utDivisor`, the client's `UT_RANGE_DEFAULT` and `gugu_chart.py`'s `sanitize_scale_for('ut', …)` all agree.
8. Panel: a fourth source switch ("Read token spend", on by default), a fourth scale row, a `Token spend` stat card (`utCount` counts rows).
9. Agents without a shell (m10349): the `gugu_stock` tool takes `action=chart, kind=both` and returns `charts[].chartPath` for both images in one call — no bash needed.

9. **Each ut row is a delta (v1.21.4, user m13230)**: a `ut` row no longer stores the running total of tokens — it stores how many tokens were spent since the previous check. On every sample `delta = max(0, current total − previous total)`, with the previous total kept in `settings.json` as `utBaseline` (advanced only when the row really lands; a same-minute duplicate is skipped and the delta is carried to the next sample). Everything downstream simply adds: a day’s spend is the sum of that day’s `ut` rows, the grand total is the sum of all of them. Rows stay small and non-negative, no shift value is needed, and deleting or adding session logs can no longer make the series go backwards. Historical rows were converted to deltas (same grand total) when upgrading to v1.22.0.

10. **Vanished sessions keep counting (v1.21.4, user m13145)**: the token total is the sum over every session log. If a session is deleted (or its log becomes unreadable) its consumption must not silently disappear — otherwise the ut series would appear to drop. `.token-cache.json` remembers each session's last cumulative total keyed by `<workspace>/<session>`; on every sample, sessions that are no longer on disk keep contributing their remembered value. Only deleting the cache file forgets them. If a log is truncated or rewritten, `max(parsed, remembered)` is used. State exposes `utRemembered` (how many gone sessions) and `utRememberedTokens` (what they contribute).

## Summing several accounts (v1.18.4)

The `account-credits` route returns an `accounts` array. Older builds picked a
single entry (`selected === true`, else the first one), so a DSH profile with two
WorkBuddy accounts only ever recorded one of them in the CSV.

Now every readable account is added up:

- `credits` may be a number or a `{ total }` object; both count.
- An account whose `credits` is `null` or absent is skipped — `numeric(null)` is
  `0`, which would otherwise be added silently to the total and the breakdown.
- At least one readable account is required; only then is the sample a success.
- `/state` exposes `wbAccounts` (`[{name, value, selected}]`) and
  `wbAccountCount`; the panel prints "2 accounts summed · <time>" under the WB
  card when there is more than one.

The CSV shape does not change: still one `time,wb,total` row per sample.

## One source of truth for visual settings (v1.18.3)

`scripts/gugu_chart.py` now reads the panel settings itself: **any visual argument not given on the command line is taken from the `settings.json` sitting next to the CSV** (which is where the plugin writes them).

- Theme, colour mode, the three series switches and the three scales are filled in only when missing; explicit arguments still win (that keeps fixtures and unit tests deterministic).
- An agent calling `python gugu_chart.py --csv ... --out ...` bare now gets the same picture as the panel — the two invocations are byte-identical in practice.
- Fixture folders have no `settings.json`, so the expected values for `acceptance/fixtures/*.csv` (light, change mode, no Aliyun) are unchanged.
- Self-check: run the command above with `--meta x.json`; `settingsApplied` should be `true` and `settingsPath` should point at the panel file. `--no-settings` forces the built-in defaults.

## Known limits

- Python with matplotlib is required for charts; a missing interpreter reports
  `python_missing` with an actionable message.
- Excel holding the file open makes a write fail; the error explains that no data
  was lost and asks to close the file.

## One file holds everything (v1.22.0)

- The CSV now starts with a `#gugu {"version":1,...}` line above the header, carrying every panel setting: `theme`, `colorMode`, `sources`, `scales` (including `wbPercent`).
- Sampling only appends data rows and never touches that line; changing a setting calls `writeMetaLine()`, which replaces just that line and keeps the header and every data row intact.
- On boot the settings are read from the table first (ahead of `settings.json`); if the line is missing the current settings are written into it, so an upgraded install gets it immediately.
- `scripts/gugu_chart.py` also prefers the in-table settings, falling back to `settings.json` and then to the built-in defaults.
- Two things stay out of the table: `utBaseline` (this machine's token counter — meaningless after a move) and `.token-cache.json` (a derived cache of session logs).
- Section ① now has an "Import CSV" button next to "Open CSV": pick a table, all rows are replaced, the settings it carries are applied, and the token baseline starts over. The previous table is backed up as `balances-v2.csv.bak-before-import-<ts>` first.
