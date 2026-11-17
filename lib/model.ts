// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out.
//
// The board covers every rankable protocol in the snapshot: pre-token, not an exchange, not a
// versioned pool, and not a wrapped, staked or bridged product of a token that already trades.
// The watchlist is the floor, never the ceiling: all 40 of its slugs are ranked, and the early
// radar adds every other rankable protocol below the floor. Live-token protocols are kept apart
// and shown at the market's own value, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures. Four factors, each a function of one
// figure, multiplied by a scale:
//
//   size     = clamp((log10(tvl_usd) - log10(size_floor_tvl)) / (log10(size_top_tvl) - log10(size_floor_tvl)), 0.05, 1)
//   sizeF    = size ^ size_exponent
//   growth   = clamp(change_7d, growth_floor, growth_cap)          (null change counts as 0)
//   growthM  = 1 + (growth / 100) * growth_weight
//   maturity = maturity_floor + maturity_range * log10(1 + age) / log10(1 + maturity_days)
//              (age = days since first listing; unknown age counts as unknown_age_days)
//   catRel   = clamp(log10(tvl_usd / category_median_tvl), -1, 1)
//   catM     = 1 + category_weight * catRel
//   chainM   = 1 + chain_weight * min(chains.length, chain_max)
//   implied  = max(1, round(scale_usd * sizeF * growthM * maturity * catM * chainM))
//
// The size factor is logarithmic, so a protocol ten times larger does not score ten times higher:
// the starter's linear TVL let the biggest protocol win by size alone. The category factor is the
// protocol's strength against its own kind: the median TVL of every protocol in its category, read
// from the same snapshot. No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  scale_usd: number;
  size_floor_tvl: number;
  size_top_tvl: number;
  size_exponent: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  category_weight: number;
  chain_weight: number;
  chain_max: number;
}

export const MODEL: ModelConstants = {
  scale_usd: 2_500_000_000,
  size_floor_tvl: 1_000_000,
  size_top_tvl: 8_000_000_000,
  size_exponent: 1.5,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1460,
  unknown_age_days: 365,
  category_weight: 0.22,
  chain_weight: 0.015,
  chain_max: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_score: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_relative: number;
    category_multiplier: number;
    category_median_tvl: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with everything the sandbox needs to re-rank it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  size_score: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_relative: number;
  category_multiplier: number;
  /** The median TVL of the row's category, so the page can recompute the category factor exactly. */
  category_median_tvl: number;
  chain_multiplier: number;
  /** The board's own farm plan for this row, so the page shows exactly what board.json carries. */
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const LOG10 = Math.log10;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `n` into [`lo`, `hi`]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool,
 *  and not a wrapped, staked or bridged product of a token that already trades. This is the
 *  competition's own watchlist rule, applied to every row alike: a wrapped or staked product of a
 *  token that trades is not a token that does not exist yet. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX' || p.category === 'Bridge' || p.category === 'Canonical Bridge' || p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name)) return false;
  return true;
}

/** The category a protocol's median is read against: its own, or 'Other' when it names none. */
function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? 'Other';
}

/** Each category's median TVL across every protocol in the snapshot, read once per run. */
export function categoryMedians(protocols: SnapshotProtocol[]): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of protocols) {
    const key = categoryKey(p);
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [p.tvl_usd]);
    else list.push(p.tvl_usd);
  }
  const medians = new Map<string, number>();
  for (const [key, list] of byCat) {
    const sorted = list.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medians.set(key, sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return medians;
}

/** One protocol's score: every factor and the implied value, under `model`. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  medians: Map<string, number>,
): {
  implied: number;
  sizeScore: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  catRel: number;
  catMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const sizeScore = clamp(
    (LOG10(Math.max(1, p.tvl_usd)) - LOG10(model.size_floor_tvl)) / (LOG10(model.size_top_tvl) - LOG10(model.size_floor_tvl)),
    0.05,
    1,
  );
  const sizeFactor = Math.pow(sizeScore, model.size_exponent);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = clamp(age ?? model.unknown_age_days, 0, model.maturity_days);
  const maturityMult = model.maturity_floor + model.maturity_range * (LOG10(1 + ageForModel) / LOG10(1 + model.maturity_days));
  const median = medians.get(categoryKey(p)) ?? p.tvl_usd;
  const catRel = clamp(LOG10(Math.max(1, p.tvl_usd) / Math.max(1, median)), -1, 1);
  const catMult = 1 + model.category_weight * catRel;
  const chainMult = 1 + model.chain_weight * Math.min(p.chains.length, model.chain_max);
  const implied = Math.max(1, Math.round(model.scale_usd * sizeFactor * growthMult * maturityMult * catMult * chainMult));
  return { implied, sizeScore, growthPct, growthMult, maturityMult, catRel, catMult, chainMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const medians = categoryMedians(snapshot.protocols);
  const rankable = snapshot.protocols.filter(isRankable);
  const scored = rankable.map((p) => {
    const s = scoreProtocol(p, snapshot.as_of, model, medians);
    return { p, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      size_score: round4(s.sizeScore),
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      category_relative: round4(s.catRel),
      category_multiplier: round4(s.catMult),
      category_median_tvl: medians.get(categoryKey(s.p)) ?? s.p.tvl_usd,
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The gas line for one transaction on the protocol's first chain. */
function gasLine(p: SnapshotProtocol): string {
  const c = chainOf(p).toLowerCase();
  if (c === 'ethereum') return 'about $6 of gas on Ethereum';
  if (c === 'bitcoin') return 'about $3 of network fees on Bitcoin';
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'near' || c === 'tron' || c === 'ton' || c === 'stellar' || c === 'algorand' || c === 'hedera') {
    return 'a few cents of gas';
  }
  return 'about $0.50 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('yield aggregator')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and keep the shares.`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge $${capital} of USDC to ${chain} through ${name} and put the bridged funds to work in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in a ${name} market that settles after the next snapshot.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('launchpad')) return `Commit $${capital} of USDC to the next ${name} launch on ${chain} and hold the allocation.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: a different feature of the same protocol, so the plan is not one
 *  move. The cost names the same capital the action names. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string, gasEach: string): FarmStep {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const half = Math.round(capital / 2);
  const third = Math.round(capital / 3);
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return { text: `Borrow $${third} against the deposit and repay it a week later, so the wallet shows both sides of the market.`, cost: `$${third} of capital and ${gasEach}`, time: '10 minutes' };
  if (c.includes('dex') || c.includes('yield aggregator')) return { text: `Swap $25 through ${name} on ${chain} into a second pool token, so the wallet shows trading as well as liquidity.`, cost: `$25 of capital and ${gasEach}`, time: '10 minutes' };
  if (c.includes('yield') || c.includes('leveraged farm')) return { text: `Move $${half} into a second ${name} vault with a different strategy, so the wallet shows two positions.`, cost: `$${half} of capital and ${gasEach}`, time: '10 minutes' };
  if (c.includes('bridge') || c.includes('canonical')) return { text: `Bridge $25 back to the chain you started from through ${name}, so the wallet shows a round trip.`, cost: `$25 of capital and ${gasEach}`, time: '10 minutes' };
  if (c.includes('staking') || c.includes('restak')) return { text: `Claim the staking rewards once and restake them through ${name}, so the wallet shows compounding.`, cost: gasEach, time: '10 minutes' };
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return { text: `Close the hedge and open a fresh one a week later, so the wallet shows repeated trading.`, cost: gasEach, time: '10 minutes' };
  if (c.includes('curator') || c.includes('allocator')) return { text: `Allocate $${half} to a second ${name} vault, so the wallet shows two allocations.`, cost: `$${half} of capital and ${gasEach}`, time: '10 minutes' };
  if (c.includes('rwa')) return { text: `Use the yield asset as collateral once, then unwind it, so the wallet shows the asset in use.`, cost: gasEach, time: '10 minutes' };
  return { text: `Use a second feature of ${name} on ${chain}, such as its vote, rewards or referral page, once a week.`, cost: gasEach, time: '10 minutes' };
}

/** The category's weekly action: the small repeat that keeps the wallet active. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Top up the supply or repay a little of the borrow on ${name} once a week.`;
  if (c.includes('dex') || c.includes('yield aggregator')) return `Make one small swap through ${name} once a week.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Claim and redeposit the vault yield on ${name} once a week.`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge a small amount through ${name} once a week.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards on ${name} once a week.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Open and close one small trade on ${name} once a week.`;
  if (c.includes('prediction')) return `Settle or roll one market position on ${name} once a week.`;
  if (c.includes('curator') || c.includes('allocator')) return `Rebalance between the ${name} vaults once a week.`;
  if (c.includes('rwa')) return `Check the yield asset's accrual on ${name} once a week and record it.`;
  return `Make one qualifying action on ${name} once a week, such as a deposit, a swap or a vote.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gasEach = gasLine(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gasEach,
      time: '5 minutes',
    },
    {
      text: mainAction(p, capital, chain),
      cost: `$${capital} of capital and ${gasEach}`,
      time: '15 minutes to set up',
    },
    secondAction(p, capital, chain, gasEach),
    {
      text: weeklyAction(p),
      cost: `${gasEach} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    size_score: row.model.size_score,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_relative: row.model.category_relative,
    category_multiplier: row.model.category_multiplier,
    category_median_tvl: row.model.category_median_tvl,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
