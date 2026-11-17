# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/meditar54/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/meditar54/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of every protocol, ranks the
pre-token ones by what their launch would be worth, and shows each one with the steps to farm it.

<sub>Entered on [make.fun](https://make.fun/?ref=07pa6jxr&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

## Run

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22 or later, standard library only, no build step, no network. The program finishes in
under a second on one CPU.

It writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data),
`out/dashboard/` (the page), `out/screenshots/` (three views of the page) and
`out/dossier.json` (the summary the judge reads, built with the vendored make.fun library).

## The model (radar-2)

Implied value follows only from the snapshot's own figures, never from a hardcoded list of
names:

```
implied = round( $2.5B x size^1.5 x growth x maturity x category x chains )
size     = clamp((log10(TVL) - log10($1M)) / (log10($8B) - log10($1M)), 0.05, 1)
growth   = 1 + clamp(7d change, -50%, +150%) / 100 x 0.6
maturity = 0.65 + 0.35 x log10(1 + age days) / log10(1 + 1460)
category = 1 + 0.22 x clamp(log10(TVL / category median TVL), -1, 1)
chains   = 1 + 0.015 x min(chains, 5)
```

Size is logarithmic, so a protocol ten times larger does not score ten times higher: the
starter's linear TVL let the biggest protocol win by size alone. The category factor is the
protocol's strength against its own kind, the median TVL of every protocol in its category.
Age is the time since the protocol was first listed, the best record of how long it has run
with no token.

The board ranks every rankable protocol: pre-token, not an exchange, not a versioned pool,
and not a wrapped, staked or bridged product of a token that already trades (the
competition's own watchlist rule, applied to every row alike). Live-token protocols are set
aside and shown at their market cap. Farm plans are derived from each protocol's own record
(category, chains, TVL, age), with the gas cost of its first chain and a capital tier from
its TVL.

## Verify

```sh
node verify.mjs out <kit>/input/snapshot.json
```

Checks every gate rule: board size and shape, watchlist coverage, ranks 1..N, implied value
order, farm steps, dashboard files and the no-network rule, screenshot sizes and dimensions,
and that `dossier.json` is byte for byte what `buildDossier` writes.

## Files

- `main.ts` — the entry point: read the snapshot, score, write the outputs.
- `lib/model.ts` — the radar-2 model, the farm plans, the board and the live set.
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library, copied verbatim.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js` (sortable, filterable, detail
  view with the model breakdown, model sandbox that re-ranks live).
- `screenshots/` — the board, a protocol detail view and a filtered view, taken at 1440x900
  from this dashboard with a headless browser.
- `verify.mjs` — the gate checker.
