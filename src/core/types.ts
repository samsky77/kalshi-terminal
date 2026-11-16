// Shared domain types. Pure data, no runtime imports.

export type Sport = 'nba' | 'nfl' | 'nhl' | 'ncaaf' | 'ncaab' | 'tennis' | 'soccer';
export const SPORTS: Sport[] = ['nba', 'nfl', 'nhl', 'ncaaf', 'ncaab', 'tennis', 'soccer'];

export type MarketKind = 'winner' | 'tie' | 'spread' | 'total';

/** Kalshi strike_type values seen on the live API (see docs/KALSHI.md). */
export type StrikeType = 'greater' | 'greater_or_equal' | 'less' | 'less_or_equal' | 'between' | 'structured' | 'custom';

export interface FeeInfo {
  feeType: string; // 'quadratic' | 'quadratic_with_maker_fees' | 'flat' | ...
  feeMultiplier: number; // series.fee_multiplier (1 = standard 0.07 taker rate)
}

/** One binary Kalshi contract normalized for pricing. Prices in dollars (0..1). */
export interface KalshiContract {
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  kind: MarketKind;
  /** competitor code from ticker suffix for winner/spread (e.g. "NYK"); undefined for totals/tie */
  code?: string;
  strikeType: StrikeType;
  floorStrike?: number;
  capStrike?: number;
  label: string; // yes_sub_title
  yesAsk: number | null;
  yesAskSize: number;
  noAsk: number | null;
  noAskSize: number; // = yes bid size (a No ask is the complement of a Yes bid)
  yesBid: number | null;
  noBid: number | null;
  fee: FeeInfo;
  status: string;
}

export interface Competitor {
  code: string;
  name: string; // Kalshi display name (winner market yes_sub_title)
}

/** One game on Kalshi with all its winner/spread/total contracts grouped. */
export interface KalshiGame {
  id: string; // stable key: sport:stem
  sport: Sport;
  league: string; // Kalshi league prefix, e.g. KXEPL
  competition: string; // product_metadata.competition or tournament name
  title: string;
  startTime: string; // ISO
  startSource: 'milestone' | 'occurrence';
  competitors: Competitor[]; // 2 entries
  homeCode?: string; // from milestone "A at B" titles when available
  bestOf?: number; // tennis
  eventTickers: string[];
  contracts: KalshiContract[];
}

// ---- The Odds API (v4) response shapes ----
export interface OddsOutcome {
  name: string;
  price: number; // decimal odds
  point?: number;
}
export interface OddsMarket {
  key: 'h2h' | 'spreads' | 'totals' | string;
  last_update?: string;
  outcomes: OddsOutcome[];
}
export interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}
export interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface Consensus {
  pHome: number; // no-vig, median across books (2-way: excludes draw; 3-way: includes)
  pAway: number;
  pDraw?: number; // soccer only
  spreadLine?: number; // HOME handicap (e.g. -3.5 means home favoured by 3.5)
  pHomeCover?: number; // no-vig P(home covers spreadLine), push excluded
  totalLine?: number;
  pOver?: number;
  books: string[];
  booksMl: number;
  mlDerived?: boolean; // no book lists a moneyline: win probability derived from the main spread
  booksSpread: number;
  booksTotal: number;
  lastUpdate: string; // newest bookmaker last_update
}

/** Result of one game's simulation, in HOME/AWAY orientation. */
export interface SimSummary {
  runs: number;
  seed: number;
  model: 'normal' | 'poisson' | 'bivariate-poisson' | 'tennis';
  params: Record<string, number>;
  pHomeWin: number;
  pAwayWin: number;
  pTie: number; // final-result tie (soccer draw / NFL tie)
  pHomeCoverMain?: number;
  pOverMain?: number;
  marginHist: [number, number][]; // home - away
  totalHist: [number, number][];
}

export type Tier = 'A' | 'B' | 'C';

export interface PricedSide {
  side: 'yes' | 'no';
  prob: number;
  ask: number | null;
  size: number;
  fee: number;
  edge: number | null; // dollars per contract
  value: boolean;
  /** This quote contradicts a neighbouring strike on the same ladder (likely a stale order): never flagged as value. */
  suspect?: boolean;
}

export interface PricedContract {
  contract: KalshiContract;
  description: string;
  strikeDisplay: string;
  tier: Tier;
  probYes: number;
  yes: PricedSide;
  no: PricedSide;
}

export type GameStatus = 'priced' | 'unpriced' | 'started';

export interface PricedGame {
  game: KalshiGame;
  status: GameStatus;
  unpricedReason?: string;
  oddsEventId?: string;
  homeCode?: string;
  awayCode?: string;
  homeName?: string;
  awayName?: string;
  consensus?: Consensus;
  sim?: SimSummary;
  /** |sim - consensus| at each anchor; kinds over tolerance are listed in fitMiss and tiered C. */
  fit?: { ml: number; spread?: number; total?: number; fitMiss: MarketKind[] };
  oddsFetchedAt?: string;
  stale: boolean;
  contracts: PricedContract[];
}
