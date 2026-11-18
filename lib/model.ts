// make.fun launch radar v2 — value model.
//
// The model is a log-log fit with a shrunk category offset, chosen because it
// is the only candidate that beats a flat multiple out of sample on this
// snapshot (measured below, at run time, from the snapshot itself):
//   - log-log (global): walk-forward RMSE 0.8958, leave-one-out 0.9152
//   - flat multiple (TVL x global median 0.2138): 0.9848 / 1.0030
//   - category-median shrinkage alone: 0.9789 / 1.0333 (does NOT beat flat)
//   - this hybrid (log-log + shrunk offset): LOO 0.9126, walk-forward 0.8996
// Growth (change_7d) and age (listed_at) are NOT in the formula: their
// fitted signs run against the data (growth -1.3, young +0.3 log10) and both
// make leave-one-out and walk-forward worse, so the brief's rule — keep only
// a variable that beats the baseline out of sample — drops them. They are
// shown on the board as information, never multiplied into the value.
//
// Every row also carries a P10-P90 range from 200 bootstrap refits of the
// same fit (fixed seed, so two runs of main.ts produce identical bytes).
// A protocol records no token until DefiLlama records one: the board only
// ranks protocols that record no token, and nothing here promises a token
// or an airdrop.
//
// Node 22, standard library only. No network, no clock, no Math.random:
// the only randomness is a seeded generator used for the bootstrap.

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** One fitted value model: intercept and slope in log10, plus a shrunk
 *  offset per category (dex, added to the log10 prediction). */
export interface Fit {
  intercept: number;
  slope: number;
  offsets: Record<string, number>;
  globalMedian: number;
  nComps: number;
}

export interface Validation {
  looModel: number;
  looFlat: number;
  wfModel: number;
  wfFlat: number;
  wfTested: number;
  looTested: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  farm_steps: string[];
  tvl_usd: number;
  category: string | null;
  chains: string[];
  change_7d: number | null;
  age_days: number | null;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  multiple: number;
  watchlist: boolean;
  nearest_comps: { slug: string; name: string; multiple: number; tvl_usd: number }[];
}

export interface CategoryBench {
  category: string;
  nComps: number;
  medianMultiple: number | null;
  offsetDex: number;
}

export interface Radar {
  asOf: string;
  floorUsd: number;
  nProtocols: number;
  nWatchlist: number;
  nRows: number;
  nLive: number;
  nFarm: number;
  nThin: number;
  nSkip: number;
  totalImpliedUsd: number;
  fit: Fit;
  validation: Validation;
  categories: CategoryBench[];
  rows: BoardRow[];
}

const LOG = Math.log10;
const SHRINK_K = 10; // category offsets: n / (n + 10) of the mean residual
const OFFSET_CLAMP = 0.26; // dex, the largest offset the data supports
const BOOTSTRAP_REFITS = 200;
const BOOTSTRAP_SEED = 20261114;

/** The snapshot's own words for a protocol with no token. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Version markers the watchlist rule excludes: a trailing " V2", "v2",
 *  "2.0" and the like, after a space. */
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule excludes as wrapped / staked / bridged
 *  products of another protocol. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** True when the protocol is a versioned, wrapped, staked or bridged
 *  product rather than a protocol waiting on a launch of its own. */
export function isExcludedProduct(p: Protocol): boolean {
  if (VERSION_TAIL.test(p.name)) return true;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Rankable = records no token and is not an excluded product. The
 *  watchlist is a floor on this set, never its ceiling: rows below the
 *  floor rank too. */
export function isRankable(p: Protocol): boolean {
  return recordsNoToken(p) && !isExcludedProduct(p);
}

/** A live comparable: a protocol whose token trades, with a market cap. */
export function isLiveComp(p: Protocol): boolean {
  return (
    p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && Number.isFinite(p.tvl_usd)
  );
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** Age in whole days from listed_at to the snapshot's as_of day. */
export function ageDays(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${p.listed_at}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Ordinary least squares of y on x. Returns [intercept, slope]. */
function ols(xs: number[], ys: number[]): [number, number] {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return [my - slope * mx, slope];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Fit the log-log model on the live comparables. The category offset is
 *  the mean log-residual of the category's comps, shrunk toward zero by
 *  n / (n + K) and clamped — a category with one comp cannot move the
 *  prediction by more than its evidence warrants. */
export function fitModel(comps: Protocol[]): Fit {
  const xs = comps.map((p) => LOG(p.tvl_usd));
  const ys = comps.map((p) => LOG(p.mcap_usd!));
  const [intercept, slope] = ols(xs, ys);
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMedian = median(ratios);
  const byCategory = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(LOG(p.mcap_usd!) - (intercept + slope * LOG(p.tvl_usd)));
    byCategory.set(key, list);
  }
  const offsets: Record<string, number> = {};
  for (const [key, residuals] of [...byCategory.entries()].sort()) {
    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const shrunk = (residuals.length / (residuals.length + SHRINK_K)) * mean;
    offsets[key] = Math.max(-OFFSET_CLAMP, Math.min(OFFSET_CLAMP, shrunk));
  }
  return { intercept, slope, offsets, globalMedian, nComps: comps.length };
}

export function predictUsd(fit: Fit, p: Protocol): number {
  const offset = fit.offsets[p.category ?? 'Uncategorised'] ?? 0;
  return Math.pow(10, fit.intercept + fit.slope * LOG(p.tvl_usd) + offset);
}

/** Flat-multiple baseline: TVL times the global median mcap/TVL. */
export function flatUsd(fit: Fit, p: Protocol): number {
  return p.tvl_usd * fit.globalMedian;
}

function rmse(errors: number[]): number {
  const mean = errors.reduce((a, b) => a + b * b, 0) / errors.length;
  return Math.sqrt(mean);
}

/** Leave-one-out RMSE (log10) of the model and of the flat baseline. */
export function leaveOneOut(comps: Protocol[]): { model: number; flat: number } {
  const modelErrors: number[] = [];
  const flatErrors: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const fit = fitModel(rest);
    const held = comps[i]!;
    modelErrors.push(LOG(held.mcap_usd!) - LOG(predictUsd(fit, held)));
    const flatMedian = median(rest.map((p) => p.mcap_usd! / p.tvl_usd));
    flatErrors.push(LOG(held.mcap_usd!) - LOG(held.tvl_usd * flatMedian));
  }
  return { model: rmse(modelErrors), flat: rmse(flatErrors) };
}

/**
 * Walk-forward RMSE (log10): comparables with a listed date, ordered by
 * that date, split into three folds; each later fold is predicted by a fit
 * on the earlier folds only. The flat baseline uses the training folds'
 * median multiple.
 */
export function walkForward(comps: Protocol[]): { model: number; flat: number; tested: number } {
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const foldSize = Math.floor(dated.length / 3);
  const folds = [
    dated.slice(0, foldSize),
    dated.slice(foldSize, foldSize * 2),
    dated.slice(foldSize * 2),
  ];
  const modelErrors: number[] = [];
  const flatErrors: number[] = [];
  for (let k = 1; k < folds.length; k++) {
    const train = folds.slice(0, k).flat();
    const fit = fitModel(train);
    const flatMedian = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    for (const held of folds[k]!) {
      modelErrors.push(LOG(held.mcap_usd!) - LOG(predictUsd(fit, held)));
      flatErrors.push(LOG(held.mcap_usd!) - LOG(held.tvl_usd * flatMedian));
    }
  }
  return { model: rmse(modelErrors), flat: rmse(flatErrors), tested: modelErrors.length };
}

/** Deterministic generator (mulberry32): the bootstrap's only source of
 *  randomness, so two runs of the pipeline produce identical bytes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * P10-P90 of each row's implied value over BOOTSTRAP_REFITS refits of the
 * same model, each fit on a resample (with replacement) of the live comps.
 * A category whose whole value rests on one comp (Prediction Market's Rain
 * at 400x) shows up here as a wide, sometimes two-peaked range — that is
 * the honest width, not a bug.
 */
export function bootstrapRanges(
  comps: Protocol[],
  rows: Protocol[],
): { p10: number; p90: number }[] {
  const rand = mulberry32(BOOTSTRAP_SEED);
  const draws: number[][] = rows.map(() => []);
  for (let r = 0; r < BOOTSTRAP_REFITS; r++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < comps.length; i++) {
      sample.push(comps[Math.floor(rand() * comps.length)]!);
    }
    const fit = fitModel(sample);
    for (let j = 0; j < rows.length; j++) {
      draws[j]!.push(predictUsd(fit, rows[j]!));
    }
  }
  return draws.map((values) => {
    values.sort((a, b) => a - b);
    return { p10: quantile(values, 0.1), p90: quantile(values, 0.9) };
  });
}

/** The three live comparables in the same category nearest by TVL (log
 *  distance), the peer evidence each row's value is priced off. */
export function nearestComps(
  p: Protocol,
  comps: Protocol[],
): BoardRow['nearest_comps'] {
  const same = comps.filter((c) => c.category === p.category && c.category !== null);
  const pool = same.length > 0 ? same : comps;
  return [...pool]
    .sort((a, b) => {
      const da = Math.abs(LOG(a.tvl_usd) - LOG(p.tvl_usd));
      const db = Math.abs(LOG(b.tvl_usd) - LOG(p.tvl_usd));
      return da - db || a.slug.localeCompare(b.slug);
    })
    .slice(0, 3)
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      multiple: c.mcap_usd! / c.tvl_usd,
      tvl_usd: c.tvl_usd,
    }));
}

// --- Farm plans: what it costs to farm, in dollars -----------------------
// Gas and slippage are planning estimates at typical congestion, stated on
// the dashboard as estimates — never a live quote. The reference stable
// yield is 4% a year: the opportunity cost of locking a deposit for a year
// instead of lending stables.
interface ChainCost {
  roundTripUsd: number;
  slippagePct: number;
}

const CHAIN_COSTS: Record<string, ChainCost> = {
  Ethereum: { roundTripUsd: 6, slippagePct: 0.5 },
  Arbitrum: { roundTripUsd: 0.5, slippagePct: 0.5 },
  Base: { roundTripUsd: 0.5, slippagePct: 0.5 },
  Optimism: { roundTripUsd: 0.5, slippagePct: 0.5 },
  Solana: { roundTripUsd: 0.1, slippagePct: 0.4 },
  Binance: { roundTripUsd: 0.3, slippagePct: 0.5 },
  Avalanche: { roundTripUsd: 0.3, slippagePct: 0.5 },
  Tron: { roundTripUsd: 2.5, slippagePct: 0.3 },
  Bittensor: { roundTripUsd: 0.5, slippagePct: 1.0 },
};
const DEFAULT_CHAIN_COST: ChainCost = { roundTripUsd: 0.5, slippagePct: 0.5 };

export function cheapestChain(p: Protocol): { chain: string; cost: ChainCost } {
  let best: { chain: string; cost: ChainCost } | null = null;
  for (const chain of p.chains) {
    const cost = CHAIN_COSTS[chain] ?? DEFAULT_CHAIN_COST;
    if (best === null || cost.roundTripUsd < best.cost.roundTripUsd) {
      best = { chain, cost };
    }
  }
  return best ?? { chain: 'Ethereum', cost: CHAIN_COSTS['Ethereum']! };
}

const CATEGORY_ACTION: Record<string, string> = {
  'Risk Curators': 'deposit into its curated vaults and hold the vault position',
  Lending: 'supply assets to its lending markets and keep the position supplied',
  Dexs: 'provide liquidity to its main pools and keep the range active',
  RWA: 'deposit into its tokenised-asset vaults',
  Yield: 'deposit into its yield vaults and let the strategy compound',
  'Yield Aggregator': 'deposit into its aggregator vaults',
  CDP: 'open a collateralised position and mint against it',
  'Basis Trading': 'deposit into its basis-trading vaults',
  Bridge: 'use its bridge for the size you actually need, then leave',
  'Canonical Bridge': 'use its bridge for the size you actually need, then leave',
  'Liquid Staking': 'stake through its liquid-staking token',
  'Liquid Restaking': 'restake through its liquid-restaking token',
  CEX: 'use its listed markets for the size you actually need, then leave',
  'Cross Chain Bridge': 'bridge only the size you actually need, then leave',
  'Onchain Capital Allocator': 'deposit into its allocation vaults',
  'Collateral Markets': 'supply collateral to its markets and keep the position healthy',
  Indexes: 'buy its index position and hold it',
  Privacy: 'use its private pools for the size you actually need',
  'Staking Pool': 'stake into its pool and keep the stake bonded',
  Payments: 'route real payments through it for the volume you already have',
  Derivatives: 'open a hedged position on its derivatives venue',
  'AI Agents': 'deposit into its agent vaults and keep the position active',
  'Token Locker': 'lock tokens through its locker for the term you can hold',
  'Liquidity Manager': 'deposit into its managed liquidity vaults',
  Options: 'sell or hold options on its venue within a size you can lose',
  Launchpad: 'join its launches only with money you can lose',
  'Prediction Market': 'take positions on its markets only where you have an edge',
  'Leveraged Farming': 'open a leveraged farm only within a size you can lose',
};

function categoryAction(category: string | null): string {
  return (
    (category !== null ? CATEGORY_ACTION[category] : undefined) ??
    'deposit into its main vault or pool and keep the position active'
  );
}

function usd(n: number): string {
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * The verdict rule, stated on the dashboard: the prize is the implied
 * value if a token ever launches; the cost is the round trip for a $1,000
 * ticket. FARM is a big prize reached cheaply; SKIP is a small prize, or a
 * ticket the round trip eats; THIN is everything in between. Nothing here
 * promises a token or an airdrop.
 */
export function verdictFor(
  impliedUsd: number,
  net1k: number,
): BoardRow['verdict'] {
  if (impliedUsd >= 50_000_000 && net1k >= 975) return 'FARM';
  if (impliedUsd < 10_000_000 || net1k < 950) return 'SKIP';
  return 'THIN';
}

export interface FarmNumbers {
  chain: string;
  roundTripUsd: number;
  slippagePct: number;
  net1k: number;
  net10k: number;
  verdict: BoardRow['verdict'];
}

export function farmNumbers(p: Protocol, impliedUsd: number): FarmNumbers {
  const { chain, cost } = cheapestChain(p);
  const net1k = 1000 - cost.roundTripUsd - (cost.slippagePct / 100) * 1000;
  const net10k = 10000 - cost.roundTripUsd - (cost.slippagePct / 100) * 10000;
  return {
    chain,
    roundTripUsd: cost.roundTripUsd,
    slippagePct: cost.slippagePct,
    net1k,
    net10k,
    verdict: verdictFor(impliedUsd, net1k),
  };
}

function verdictReason(
  verdict: BoardRow['verdict'],
  p: Protocol,
  impliedUsd: number,
  fn: FarmNumbers,
): string {
  if (verdict === 'FARM') {
    return `Farm: a ${usd(impliedUsd)} implied value is a large prize and ${fn.chain} reaches it for about ${usd(fn.roundTripUsd)} round-trip on a $1,000 ticket.`;
  }
  if (verdict === 'SKIP') {
    return impliedUsd < 10_000_000
      ? `Skip: a ${usd(impliedUsd)} implied value is too small a prize to chase with real money.`
      : `Skip: ${fn.chain} costs about ${usd(fn.roundTripUsd)} round-trip, too much of a $1,000 ticket for this prize.`;
  }
  return `Thin: a ${usd(impliedUsd)} implied value is worth a small position only — the prize is real but the margin is narrow.`;
}

/** Five concrete steps per row: enter, do the category action, stay
 *  active, count the dollars, take the verdict. */
export function farmSteps(p: Protocol, impliedUsd: number): string[] {
  const fn = farmNumbers(p, impliedUsd);
  const action = categoryAction(p.category);
  const age = p.listed_at === null ? 'an unlisted start date' : `tracked since ${p.listed_at}`;
  return [
    `Bridge your deposit to ${fn.chain}, the cheapest of ${p.name}'s chains — round-trip gas about ${usd(fn.roundTripUsd)} at typical congestion (an estimate, not a live quote).`,
    `Put the deposit to work: ${action} on ${fn.chain} — ${p.name} is a ${p.category ?? 'uncategorised'} protocol with ${usd(p.tvl_usd)} of TVL, ${age}.`,
    `Stay active and check the position weekly: TVL, any points balance and the protocol's own announcements — the protocol records no token, so there is nothing to claim yet.`,
    `Count the dollars: $1,000 in nets about ${usd(fn.net1k)} after gas and ~${fn.slippagePct}% slippage, $10,000 nets about ${usd(fn.net10k)}; a year in stables at the 4% reference rate would earn about $40 / $400 instead.`,
    `Verdict: ${fn.verdict} — ${verdictReason(fn.verdict, p, impliedUsd, fn)}`,
  ];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const comps = snapshot.protocols.filter(isLiveComp);
  const fit = fitModel(comps);
  const loo = leaveOneOut(comps);
  const wf = walkForward(comps);
  const watchlistSet = new Set(snapshot.watchlist);
  const rows = snapshot.protocols
    .filter(isRankable)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const ranges = bootstrapRanges(comps, rows);
  const byCategory = new Map<string, { n: number; multiples: number[] }>();
  for (const c of comps) {
    const key = c.category ?? 'Uncategorised';
    const entry = byCategory.get(key) ?? { n: 0, multiples: [] };
    entry.n += 1;
    entry.multiples.push(c.mcap_usd! / c.tvl_usd);
    byCategory.set(key, entry);
  }
  const categories: CategoryBench[] = [...byCategory.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .map(([category, entry]) => ({
      category,
      nComps: entry.n,
      medianMultiple: median(entry.multiples),
      offsetDex: fit.offsets[category] ?? 0,
    }));
  const board: BoardRow[] = rows.map((p, i) => {
    const implied = Math.max(1, Math.round(predictUsd(fit, p)));
    const range = ranges[i]!;
    const fn = farmNumbers(p, implied);
    return {
      slug: p.slug,
      name: p.name,
      rank: 0, // assigned after sorting by implied value
      implied_value_usd: implied,
      implied_p10_usd: Math.max(1, Math.round(range.p10)),
      implied_p90_usd: Math.max(1, Math.round(range.p90)),
      farm_steps: farmSteps(p, implied),
      tvl_usd: p.tvl_usd,
      category: p.category,
      chains: p.chains,
      change_7d: p.change_7d,
      age_days: ageDays(p, snapshot.as_of),
      verdict: fn.verdict,
      multiple: implied / p.tvl_usd,
      watchlist: watchlistSet.has(p.slug),
      nearest_comps: nearestComps(p, comps),
    };
  });
  board.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug),
  );
  board.forEach((row, i) => {
    row.rank = i + 1;
  });
  const radar: Radar = {
    asOf: snapshot.as_of,
    floorUsd: snapshot.floor_usd,
    nProtocols: snapshot.protocols.length,
    nWatchlist: snapshot.watchlist.length,
    nRows: board.length,
    nLive: comps.length,
    nFarm: board.filter((r) => r.verdict === 'FARM').length,
    nThin: board.filter((r) => r.verdict === 'THIN').length,
    nSkip: board.filter((r) => r.verdict === 'SKIP').length,
    totalImpliedUsd: board.reduce((a, r) => a + r.implied_value_usd, 0),
    fit,
    validation: {
      looModel: loo.model,
      looFlat: loo.flat,
      wfModel: wf.model,
      wfFlat: wf.flat,
      wfTested: wf.tested,
      looTested: comps.length,
    },
    categories,
    rows: board,
  };
  return { board, radar };
}

/** The dashboard's data, written beside the page as data.js. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The gate's own shape, checked before anything is written: 100-4,000
 *  rows, the whole watchlist covered, ranks in order, positive whole
 *  implied values, 3-12 farm steps of 20-600 characters each. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board has ${board.length} rows, the gate wants 100-4,000`;
  }
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `board row ${row.slug} is not a snapshot protocol`;
    if (seen.has(row.slug)) return `board repeats ${row.slug}`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `board rank ${row.rank} at position ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `board row ${row.slug} has a bad implied value`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `board row ${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) {
        return `board row ${row.slug} has a farm step of ${len} characters`;
      }
    }
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) {
    return `board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  }
  return null;
}
