'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { plainSide, valueRows, type ValueRow } from '@/core/pipeline';
import { SPORT_LABEL, STALE_HOURS } from '@/core/sports';
import { SPORTS, type MarketKind, type PricedContract, type PricedGame, type PricedSide, type Sport, type Tier } from '@/core/types';
import { ago, cents, cents1, edgeC, money, pct, signClass, size, when } from './format';
import type { BacktestSummary } from '@/core/backtest';
import { SIM_HORIZON_H, useTerminal, type Terminal } from './useTerminal';

type Tab = 'value' | 'games' | 'track' | 'data';
const TAB_LABEL: Record<Tab, string> = { value: 'Value', games: 'Games', track: 'Track', data: 'Data' };
const SPORT_NAME: Record<Sport, string> = { nba: 'NBA', nfl: 'NFL', nhl: 'NHL', ncaaf: 'College football', ncaab: 'College basketball', tennis: 'Tennis', soccer: 'Soccer' };
const KIND_NAME: Record<string, string> = { winner: 'Moneyline', tie: 'Tie', spread: 'Spread', total: 'Total' };
const BUSY_LABEL: Record<string, string> = { kalshi: 'loading Kalshi…', simulating: 'simulating…', odds: 'loading odds…' };

/** Which contract (and side) the detail sheet should highlight. */
interface Detail { gameId: string; ticker?: string; side?: 'yes' | 'no' }
interface Filters { sport: Sport | 'all'; kind: MarketKind | 'all'; tiers: Record<Tier, boolean>; minEdge: number }

const gameNames = (g: PricedGame): { away: string; home: string; title: string } => {
  const [c0, c1] = g.game.competitors;
  // Without a sportsbook match we do not know who is at home, so use Kalshi's own event title as written.
  if (g.awayName && g.homeName) return { away: g.awayName, home: g.homeName, title: `${g.awayName} @ ${g.homeName}` };
  return { away: c0?.name ?? '?', home: c1?.name ?? '?', title: g.game.title || `${c0?.name ?? '?'} vs ${c1?.name ?? '?'}` };
};

export default function App() {
  const t = useTerminal();
  const [tab, setTab] = useState<Tab>('value');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filters, setFilters] = useState<Filters>({ sport: 'all', kind: 'all', tiers: { A: true, B: true, C: false }, minEdge: 2 });
  const [gamesSport, setGamesSport] = useState<Sport | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    // Tell the service worker which files this page loaded, so the app also opens offline after a first visit.
    const send = () => {
      const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.includes('/_next/static/'));
      navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'cache-assets', urls })).catch(() => {});
    };
    const id = setTimeout(send, 4000);
    return () => clearTimeout(id);
  }, []);

  // Re-render twice a minute so "x ago" labels and started-game checks stay current.
  useEffect(() => { const id = setInterval(() => setTick((x) => x + 1), 30_000); return () => clearInterval(id); }, []);

  // The phone's Back button or gesture closes the sheet instead of leaving the app.
  const openDetail = (d: Detail) => {
    if (!detail) { try { history.pushState({ kxSheet: true }, ''); } catch { /* ignore */ } }
    setDetail(d);
  };
  const closeDetail = () => {
    if (history.state?.kxSheet) history.back(); // popstate below clears the sheet
    else setDetail(null);
  };
  useEffect(() => {
    const pop = () => setDetail(null);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  const allGames = useMemo(() => SPORTS.flatMap((s) => t.results[s]?.games ?? []), [t.results]);
  const detailGame = detail ? allGames.find((g) => g.game.id === detail.gameId) : undefined;
  // If the game drops out of the data while its sheet is open, close the sheet for good rather than letting it pop back later.
  useEffect(() => {
    if (detail && !detailGame && allGames.length) closeDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, detailGame, allGames.length]);

  const credits = t.status?.credits?.remaining ?? t.meta.credits?.remaining ?? null;
  const working = Object.values(t.busy).filter(Boolean).length;
  const noKey = t.status?.mode === 'fixture';

  return (
    <div className="app">
      <header className="top">
        <span className="brand">KX<b>TERM</b></span>
        {t.mode === 'demo'
          ? <span className="badge warn" title="Recorded sample data, not live prices">DEMO DATA</span>
          : <span className="badge">{t.online ? 'LIVE' : 'SAVED DATA'}</span>}
        {!t.online && <span className="badge neg">OFFLINE</span>}
        <span className="grow" />
        {working > 0 && <span className="spin" role="status" aria-label="Loading" />}
        {credits !== null && !noKey && <span className="mono dim" title="Odds API credits left this month">Credits {credits}</span>}
      </header>

      <main className="content" aria-hidden={detailGame ? true : undefined}>
        {tab === 'value' && <ValueTab t={t} f={filters} setF={setFilters} onOpen={openDetail} goData={() => setTab('data')} />}
        {tab === 'games' && <GamesTab t={t} sport={gamesSport} setSport={setGamesSport} onOpen={openDetail} />}
        {tab === 'track' && <TrackTab t={t} />}
        {tab === 'data' && <DataTab t={t} />}
        <footer className="legal">
          Model output, not advice. No guarantee of profit. Prices can move before you act; always check the price on Kalshi.{' '}
          This app is read-only and cannot place orders.{' '}
          Gambling problem? Call <a href="tel:18004262537">1-800-GAMBLER</a> or visit{' '}
          <a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noopener noreferrer">ncpgambling.org</a>.
        </footer>
      </main>

      {detailGame && <GameDetail g={detailGame} sel={detail!} demo={t.mode === 'demo'} onClose={closeDetail} />}

      <nav className="tabs" aria-label="Sections">
        <div className="tabs-in">
          {(Object.keys(TAB_LABEL) as Tab[]).map((x) => (
            <button key={x} className={tab === x ? 'on' : ''} aria-current={tab === x ? 'page' : undefined} onClick={() => { setTab(x); window.scrollTo(0, 0); }}>
              {TAB_LABEL[x]}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

/** Small "BUY YES" / "BUY NO" pill. */
function SidePill({ side }: { side: 'yes' | 'no' }) {
  return <span className={`side side-${side}`}>{side === 'yes' ? 'BUY YES' : 'BUY NO'}</span>;
}

/** How old the data on screen is, in plain words. */
function Freshness({ t }: { t: Terminal }) {
  const snaps = SPORTS.map((s) => t.snaps[s]?.fetchedAt).filter((x): x is string => !!x).sort();
  if (!snaps.length) return null;
  if (t.mode === 'demo') {
    return <p className="fresh warn-text">Demo: recorded prices from {new Date(snaps[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}. Not live. Switch to Live on the Data tab.</p>;
  }
  const oldest = snaps[0];
  const oldMs = Date.now() - Date.parse(oldest);
  const lateK = oldMs > 5 * 60_000;
  return (
    <p className={`fresh ${lateK ? 'warn-text' : 'dim'}`}>
      Kalshi prices updated {ago(oldest)}{lateK ? ' — they may have moved' : ''}.{' '}
      {lateK && t.online && <button className="link inline" onClick={() => t.loadAll()}>Update now</button>}
    </p>
  );
}

function Errors({ t, sports }: { t: Terminal; sports: Sport[] }) {
  const bad = sports.filter((s) => t.errors[s]);
  if (!bad.length) return null;
  const same = new Set(bad.map((s) => t.errors[s])).size === 1;
  return (
    <div className="err" role="alert">
      {same ? `${bad.map((s) => SPORT_LABEL[s]).join(', ')}: ${t.errors[bad[0]]}.` : bad.map((s) => `${SPORT_LABEL[s]}: ${t.errors[s]}`).join('. ') + '.'}{' '}
      {bad.some((s) => t.results[s]) ? 'Showing the last saved prices. ' : ''}
      <button className="link inline" onClick={() => bad.forEach((s) => t.loadKalshi(s))}>Try again</button>
    </div>
  );
}

// ---------------------------------------------------------------- Value tab
function ValueTab({ t, f, setF, onOpen, goData }: { t: Terminal; f: Filters; setF: (f: Filters) => void; onOpen: (d: Detail) => void; goData: () => void }) {
  const [help, setHelp] = useState(false);
  const now = t.mode === 'demo' ? undefined : Date.now();
  const nowBucket = now ? Math.floor(now / 30_000) : 0;

  const rows = useMemo(() => {
    const games = SPORTS.filter((s) => f.sport === 'all' || s === f.sport).flatMap((s) => t.results[s]?.games ?? []);
    // Compare with the same one-decimal, truncated number the row prints, so a row showing +5.0 passes a 5¢ filter.
    return valueRows(games, now).filter((r) => (f.kind === 'all' || r.kind === f.kind) && f.tiers[r.tier] && Number(edgeC(r.edge)) >= f.minEdge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.results, f, nowBucket]);

  const scope = SPORTS.filter((s) => f.sport === 'all' || s === f.sport);
  const priced = scope.reduce((a, s) => a + (t.results[s]?.games.filter((g) => g.status === 'priced').length ?? 0), 0);
  const loading = scope.some((s) => t.busy[s]);
  const failed = scope.filter((s) => t.errors[s] && !t.results[s]);
  const hiddenC = useMemo(() => {
    if (f.tiers.C) return 0;
    const games = scope.flatMap((s) => t.results[s]?.games ?? []);
    return valueRows(games, now).filter((r) => r.tier === 'C' && (f.kind === 'all' || r.kind === f.kind) && Number(edgeC(r.edge)) >= f.minEdge).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.results, f, nowBucket]);

  return (
    <section>
      <p className="intro">
        Kalshi contracts priced below what the model thinks they are worth.{' '}
        <button className="link inline" aria-expanded={help} onClick={() => setHelp(!help)}>{help ? 'Hide help' : 'How to read this'}</button>
      </p>
      {help && (
        <div className="panel help">
          <p><b>Each row is one Kalshi contract.</b> A contract pays $1 if it comes true and $0 if not. <span className="side side-yes">BUY YES</span> / <span className="side side-no">BUY NO</span> says which side is underpriced.</p>
          <p><b>MODEL %</b> chance this side wins, from 20,000 simulated games fitted to sportsbook lines (not an independent forecast).</p>
          <p><b>COST ¢</b> what one contract costs on Kalshi right now: the ask price plus Kalshi&apos;s fee.</p>
          <p><b>EDGE ¢</b> = MODEL − COST: the average profit per contract the model expects. Rows need at least 2¢.</p>
          <p><b>QTY</b> contracts offered at that price. Small numbers mean the price will not last.</p>
          <p><b>TIER</b> how much to trust the row. <b className="tier-A">A</b> the sportsbooks&apos; main line or the moneyline. <b className="tier-B">B</b> one step from the main line. <b className="tier-C">C</b> far from the main line, or the model could not match the books: least reliable, hidden unless you turn it on.</p>
          <p className="dim">Tap a row for the exact Kalshi ticker, what you win or lose, and the model details.</p>
        </div>
      )}
      <Freshness t={t} />
      <Errors t={t} sports={scope} />
      <div className="filters">
        <select value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value as Sport | 'all' })} aria-label="Sport">
          <option value="all">All sports</option>
          {SPORTS.map((s) => <option key={s} value={s}>{SPORT_NAME[s]}</option>)}
        </select>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as MarketKind | 'all' })} aria-label="Market type">
          <option value="all">All markets</option>
          <option value="winner">Moneyline</option>
          <option value="spread">Spread</option>
          <option value="total">Total</option>
          <option value="tie">Tie</option>
        </select>
        <span className="tiers" role="group" aria-label="Tiers shown">
          <span className="dim small">Tier</span>
          {(['A', 'B', 'C'] as Tier[]).map((x) => (
            <button key={x} className={`chip tier-${x} ${f.tiers[x] ? 'on' : ''}`} aria-pressed={f.tiers[x]} aria-label={`Tier ${x}`} onClick={() => setF({ ...f, tiers: { ...f.tiers, [x]: !f.tiers[x] } })}>{x}</button>
          ))}
        </span>
        <label className="minedge mono">
          <span>Edge ≥ {f.minEdge}¢</span>
          <input type="range" min={2} max={15} step={1} value={f.minEdge} onChange={(e) => setF({ ...f, minEdge: Number(e.target.value) })} aria-label="Minimum edge in cents" aria-valuetext={`${f.minEdge} cents`} />
        </label>
      </div>

      <div className="row head mono">
        <span className="c-desc">CONTRACT</span><span title="Confidence tier">TIER</span><span>MODEL%</span><span>COST¢</span><span>EDGE¢</span><span>QTY</span>
      </div>
      {rows.length === 0 && (
        <div className="empty" role="status">
          {loading && priced === 0 ? 'Loading markets and running simulations…'
            : failed.length && priced === 0 ? 'Could not load Kalshi markets. Check your connection and tap Try again above.'
            : !Object.values(f.tiers).some(Boolean) ? 'All tiers are switched off. Turn on A, B or C above.'
            : priced === 0 && t.mode === 'live' ? (
              <>No games are priced yet. Sportsbook odds load automatically for games starting within a day.{' '}
                <button className="link inline" onClick={goData}>Open Data</button> to load odds now, or try Demo there to see sample data.</>
            )
            : priced === 0 ? 'No games could be priced from the demo data.'
            : `No contract has an edge of ${f.minEdge}¢ or more with these filters right now (${priced} games priced).`}
          {hiddenC > 0 && <div className="small">{hiddenC} lower-confidence tier C row{hiddenC === 1 ? '' : 's'} hidden. Turn on C to see {hiddenC === 1 ? 'it' : 'them'}.</div>}
        </div>
      )}
      {rows.map((r) => <ValueLine key={`${r.ticker}-${r.side}`} r={r} onOpen={onOpen} />)}
      {rows.length > 0 && hiddenC > 0 && <p className="small dim center">{hiddenC} lower-confidence tier C row{hiddenC === 1 ? '' : 's'} hidden.</p>}
    </section>
  );
}

function ValueLine({ r, onOpen }: { r: ValueRow; onOpen: (d: Detail) => void }) {
  return (
    <button className="row mono" onClick={() => onOpen({ gameId: r.gameId, ticker: r.ticker, side: r.side })}
      aria-label={`${r.side === 'yes' ? 'Buy yes' : 'Buy no'}: ${r.plain}. ${r.game}, ${when(r.startTime)}. Tier ${r.tier}, model ${pct(r.prob, 1)} percent, cost ${cents1(r.ask + r.fee)} cents, edge ${edgeC(r.edge)} cents, ${size(r.size)} available.`}>
      <span className="c-desc">
        <span className="c-main"><SidePill side={r.side} /> {r.plain}{r.stale && <span className="badge warn tiny">OLD ODDS</span>}</span>
        <small><em className="sp">{SPORT_LABEL[r.sport]}</em> {when(r.startTime)} · {r.game}</small>
      </span>
      <span className={`tier tier-${r.tier}`}>{r.tier}</span>
      <span>{pct(r.prob, 1)}</span>
      <span>{cents1(r.ask + r.fee)}</span>
      <span className={signClass(r.edge)}>{edgeC(r.edge)}</span>
      <span className="dim">{size(r.size)}</span>
    </button>
  );
}

// ---------------------------------------------------------------- Games tab
function GamesTab({ t, sport: picked, setSport, onOpen }: { t: Terminal; sport: Sport | null; setSport: (s: Sport) => void; onOpen: (d: Detail) => void }) {
  // Until the user picks a sport, show the first one that has priced games (then any games).
  const auto = SPORTS.find((s) => t.results[s]?.games.some((g) => g.status === 'priced')) ?? SPORTS.find((s) => t.results[s]?.games.length) ?? 'nfl';
  const sport = picked ?? auto;
  const res = t.results[sport];
  const days = Math.round(SIM_HORIZON_H / 24);
  return (
    <section>
      <div className="chips" role="group" aria-label="Sport">
        {SPORTS.map((s) => (
          <button key={s} className={`chip ${sport === s ? 'on' : ''}`} aria-pressed={sport === s} aria-label={`${SPORT_NAME[s]}, ${t.results[s]?.games.length ?? 0} games`} onClick={() => setSport(s)}>
            {SPORT_LABEL[s]} <small>{t.results[s]?.games.length ?? (t.busy[s] ? '…' : t.errors[s] ? '!' : '')}</small>
          </button>
        ))}
      </div>
      <p className="intro">Every {SPORT_NAME[sport]} game on Kalshi. Tap a game for its prices; tap a price row for details. Games more than {days} days away are priced closer to game time.</p>
      <Errors t={t} sports={[sport]} />
      {!res && <div className="empty" role="status">{t.busy[sport] ? 'Loading Kalshi markets…' : t.errors[sport] ? 'No data loaded yet.' : 'Waiting to load…'}</div>}
      {res && res.games.length === 0 && <div className="empty">Kalshi has no open {SPORT_NAME[sport]} game markets right now.</div>}
      {res?.games.map((g) => <GameCard key={g.game.id} g={g} onOpen={onOpen} />)}
    </section>
  );
}

function GameCard({ g, onOpen }: { g: PricedGame; onOpen: (d: Detail) => void }) {
  const [open, setOpen] = useState(false);
  const n = gameNames(g);
  const by = (k: MarketKind) => g.contracts.filter((c) => c.contract.kind === k);
  const sortStrike = (a: PricedContract, b: PricedContract) => (a.contract.floorStrike ?? 0) - (b.contract.floorStrike ?? 0);
  const spreads = by('spread').sort((a, b) => (a.contract.code ?? '').localeCompare(b.contract.code ?? '') || sortStrike(a, b));
  // Badge = best flagged edge, matching what the Value tab lists. Tier C is marked as such.
  let best = -1, bestC = -1;
  for (const c of g.contracts) for (const s of [c.yes, c.no]) {
    if (!s.value || s.edge === null) continue;
    if (c.tier === 'C') bestC = Math.max(bestC, s.edge); else best = Math.max(best, s.edge);
  }
  const started = g.status === 'started';
  const pick = (c: PricedContract) => onOpen({ gameId: g.game.id, ticker: c.contract.ticker });
  return (
    <div className="card">
      <button className="card-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="teams">
          {g.awayName && g.homeName ? <><b>{n.away}</b> @ <b>{n.home}</b></> : <b>{n.title}</b>}
          <small className="mono">{when(g.game.startTime)} · {g.game.competition}</small>
        </span>
        <span className="badges">
          {g.status === 'unpriced' && <span className="badge mute">NOT PRICED</span>}
          {started && <span className="badge warn">STARTED</span>}
          {g.stale && !started && <span className="badge warn">OLD ODDS</span>}
          {g.status === 'priced' && best >= 0 && <span className="badge pos mono">{edgeC(best)}¢</span>}
          {g.status === 'priced' && best < 0 && bestC >= 0 && <span className="badge mute mono" title="Best edge is a tier C contract">{edgeC(bestC)}¢ C</span>}
        </span>
      </button>
      {open && (
        <div className="ladders">
          {g.status === 'unpriced' ? (
            <p className="dim small">Not priced: {g.unpricedReason}. Kalshi lists {g.game.contracts.length} contracts for this game; nothing is flagged without sportsbook lines to anchor the model.</p>
          ) : (
            <>
              {started && <p className="warn-text small">This game has started. The model is pre-game only, so edges are hidden.</p>}
              {g.stale && !started && <p className="warn-text small">Sportsbook odds are more than {STALE_HOURS} hours old. Refresh them on the Data tab before trusting these edges.</p>}
              <Ladder title="Moneyline" rows={[...by('winner'), ...by('tie')]} started={started} onPick={pick} />
              <Ladder title="Spread" rows={spreads} started={started} onPick={pick} />
              <Ladder title="Total" rows={by('total').sort(sortStrike)} started={started} onPick={pick} />
              <p className="small dim">Prices in cents. Edge = model % − price − Kalshi fee. A dot marks an edge of 2¢ or more.</p>
              <button className="link" onClick={() => onOpen({ gameId: g.game.id })}>Model details and sportsbook lines →</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Rows worth showing by default: near the main line, flagged, or not a foregone conclusion. */
const liveRow = (c: PricedContract) => c.tier !== 'C' || c.yes.value || c.no.value || (c.probYes > 0.05 && c.probYes < 0.95);

function Ladder({ title, rows, started, onPick }: { title: string; rows: PricedContract[]; started: boolean; onPick: (c: PricedContract) => void }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.filter(liveRow);
  const hidden = rows.length - shown.length;
  const edge = (s: PricedSide) => (started ? <span className="mute">—</span> : <span className={signClass(s.edge)}>{edgeC(s.edge)}{s.value ? '•' : ''}{s.suspect ? '?' : ''}</span>);
  return (
    <div className="ladder">
      <div className="lad-title">{title}</div>
      <div className="lrow head mono"><span className="l-desc">YES MEANS</span><span>T</span><span>MODEL%</span><span>YES¢</span><span>EDGE</span><span>NO¢</span><span>EDGE</span></div>
      {shown.map((c) => (
        <button key={c.contract.ticker} className="lrow mono" onClick={() => onPick(c)}>
          <span className="l-desc">{c.description}</span>
          <span className={`tier tier-${c.tier}`}>{c.tier}</span>
          <span>{pct(c.probYes, 1)}</span>
          <span>{cents(c.yes.ask)}</span>
          {edge(c.yes)}
          <span>{cents(c.no.ask)}</span>
          {edge(c.no)}
        </button>
      ))}
      {(hidden > 0 || (all && rows.some((c) => !liveRow(c)))) && (
        <button className="link small" onClick={() => setAll(!all)}>{all ? 'Hide long-shot lines' : `Show ${hidden} more long-shot line${hidden === 1 ? '' : 's'}`}</button>
      )}
      {shown.some((c) => c.yes.suspect || c.no.suspect) && <p className="small dim">? = this quote disagrees with the strikes next to it (likely a stale order), so it is never flagged.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Game detail
function GameDetail({ g, sel, demo, onClose }: { g: PricedGame; sel: Detail; demo: boolean; onClose: () => void }) {
  const c = g.consensus, s = g.sim;
  const n = gameNames(g);
  const homeHandicap = c?.spreadLine;
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  // Modal behaviour: lock the page behind, move focus in, close on Escape, give focus back afterwards.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab') {
        const els = [...document.querySelectorAll<HTMLElement>('.sheet-body button, .sheet-body a[href]')];
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!els.includes(document.activeElement as HTMLElement)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pc = sel.ticker ? g.contracts.find((x) => x.contract.ticker === sel.ticker) : undefined;
  const sides: PricedSide[] = pc ? (sel.side ? [sel.side === 'yes' ? pc.yes : pc.no] : [pc.yes, pc.no]) : [];
  const started = g.status === 'started';
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const strikeMarker = pc && pc.contract.floorStrike !== undefined
    ? pc.contract.kind === 'total' ? { total: pc.contract.floorStrike }
      : pc.contract.kind === 'spread' && g.homeCode ? { margin: pc.contract.code === g.homeCode ? pc.contract.floorStrike : -pc.contract.floorStrike }
      : {}
    : {};
  const mlFit = g.fit ? g.fit.ml * 100 : null;

  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-body" role="dialog" aria-modal="true" aria-label={`Details: ${n.title}`}>
        <div className="sheet-head">
          <b>{n.title}</b>
          <button ref={closeRef} className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="dim mono small">{when(g.game.startTime)} · {g.game.competition}{started ? ' · STARTED' : ''}{g.stale ? ' · OLD ODDS' : ''}{demo ? ' · DEMO DATA' : ''}</p>

        {pc && (
          <div className="panel sel">
            <div className="small dim">Kalshi contract</div>
            <div className="sel-title">{pc.description} <span className={`tier tier-${pc.tier}`}>tier {pc.tier}</span></div>
            <div className="mono small tick">
              <span>{pc.contract.ticker}</span>
              <button className="btn tinybtn" onClick={() => copy(pc.contract.ticker)}>{copied ? 'Copied' : 'Copy ticker'}</button>
            </div>
            <p className="small dim">Search this ticker in the Kalshi app to find the exact market.</p>
            {started && <p className="warn-text small">The game has started: the pre-game model no longer applies.</p>}
            {sides.map((sd) => (
              <div key={sd.side} className="sidebox">
                <div><SidePill side={sd.side} /> <b>{plainSide(pc, sd.side)}</b></div>
                {sd.ask === null || sd.edge === null ? <p className="small dim">No offer on this side right now.</p> : (
                  <table className="kv mono"><tbody>
                    <tr><td>Model chance</td><td>{pct(sd.prob, 1)}%</td></tr>
                    <tr><td>Price (ask) + fee</td><td>{cents(sd.ask)}¢ + {cents1(sd.fee)}¢ = {cents1(sd.ask + sd.fee)}¢</td></tr>
                    <tr><td>Edge per contract</td><td className={started ? 'mute' : signClass(sd.edge)}>{started ? '—' : `${edgeC(sd.edge)}¢`}</td></tr>
                    <tr><td>If it wins / loses</td><td><span className="pos">+{cents1(1 - sd.ask - sd.fee)}¢</span> / <span className="neg">−{cents1(sd.ask + sd.fee)}¢</span></td></tr>
                    <tr><td>Offered at this price</td><td>{size(sd.size)} contract{Math.floor(sd.size) === 1 ? '' : 's'}</td></tr>
                  </tbody></table>
                )}
                {sd.suspect && <p className="warn-text small">This quote disagrees with the strikes next to it and is probably a stale order, so it is not flagged as value.</p>}
              </div>
            ))}
            {pc.contract.kind === 'winner' && sides.some((x) => x.side === 'no') && c?.pDraw === undefined && g.game.sport === 'nfl' && <p className="small dim">NO also wins if the game ends in a tie.</p>}
            {pc.contract.kind === 'winner' && sides.some((x) => x.side === 'no') && c?.pDraw !== undefined && <p className="small dim">NO also wins if the match is drawn.</p>}
            <p className="small dim">Fee shown is for one contract; larger orders pay slightly less per contract. Check the live price on Kalshi before buying.</p>
          </div>
        )}

        {!c || !s ? (
          <p>Not priced: {g.unpricedReason}.</p>
        ) : (
          <>
            <h4>Sportsbook lines the model is fitted to</h4>
            <p className="small dim">Vig removed, median across books. The model reproduces these lines; it is not an independent forecast.</p>
            <table className="kv mono"><tbody>
              <tr><td>Win chance: {n.home} / {n.away}{c.pDraw !== undefined ? ' / draw' : ''}</td><td>{pct(c.pHome)}% / {pct(c.pAway)}%{c.pDraw !== undefined ? ` / ${pct(c.pDraw)}%` : ''}</td><td className="dim">{c.booksMl} book{c.booksMl === 1 ? '' : 's'}</td></tr>
              <tr><td>Main spread ({n.home})</td><td>{homeHandicap === undefined ? '—' : `${homeHandicap > 0 ? '+' : ''}${homeHandicap}, covers ${pct(c.pHomeCover)}%`}</td><td className="dim">{c.booksSpread} book{c.booksSpread === 1 ? '' : 's'}</td></tr>
              <tr><td>Main total</td><td>{c.totalLine === undefined ? '—' : `${c.totalLine}, over ${pct(c.pOver)}%`}</td><td className="dim">{c.booksTotal} book{c.booksTotal === 1 ? '' : 's'}</td></tr>
            </tbody></table>
            <h4>How closely the model matches them</h4>
            <table className="kv mono"><tbody>
              <tr><td>Model win chance ({n.home})</td><td>{pct(c.pDraw !== undefined ? s.pHomeWin : s.pHomeWin / (s.pHomeWin + s.pAwayWin))}%</td><td className="dim">{mlFit === null ? '' : `off by ${mlFit.toFixed(1)} pts`}</td></tr>
              <tr><td>Model cover / over</td><td>{pct(s.pHomeCoverMain)}% / {pct(s.pOverMain)}%</td><td className={g.fit?.fitMiss.length ? 'warn-text' : 'dim'}>{g.fit?.fitMiss.length ? 'poor match' : 'good match'}</td></tr>
            </tbody></table>
            {!!g.fit?.fitMiss.length && <p className="warn-text small">The model could not match the books on: {g.fit.fitMiss.map((k) => KIND_NAME[k]?.toLowerCase() ?? k).join(', ')}. Those contracts are tier C.</p>}
            <Hist title={`Simulated margin (${n.home} minus ${n.away})`} data={s.marginHist} marker={homeHandicap !== undefined ? -homeHandicap : undefined} marker2={strikeMarker.margin} />
            <Hist title="Simulated total" data={s.totalHist} marker={c.totalLine} marker2={strikeMarker.total} />
            <p className="small dim">Dashed orange = sportsbook main line{pc && (strikeMarker.margin !== undefined || strikeMarker.total !== undefined) ? '; solid blue = this contract’s strike' : ''}.</p>
            <details className="more">
              <summary>Model settings and books</summary>
              <p className="mono small wrap">{s.model} · {s.runs.toLocaleString()} runs · seed {s.seed}<br />
                {Object.entries(s.params).map(([k, v]) => `${k}=${Number(v).toFixed(3)}`).join('  ')}</p>
              <p className="mono small wrap">Books ({c.books.length}): {c.books.join(', ')}</p>
            </details>
            <p className="mono small dim">Odds loaded {g.oddsFetchedAt ? `${when(g.oddsFetchedAt)}${demo ? '' : ` (${ago(g.oddsFetchedAt)})`}` : '—'} · treated as old after {STALE_HOURS}h</p>
          </>
        )}
        <button className="btn wide" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function Hist({ title, data, marker, marker2 }: { title: string; data: [number, number][]; marker?: number; marker2?: number }) {
  if (!data.length) return null;
  // trim 0.5% tails for display
  let lo = 0, hi = data.length - 1, acc = 0;
  while (lo < hi && acc + data[lo][1] < 0.005) acc += data[lo++][1];
  acc = 0;
  while (hi > lo && acc + data[hi][1] < 0.005) acc += data[hi--][1];
  const d = data.slice(lo, hi + 1);
  const x0 = d[0][0], x1 = d[d.length - 1][0];
  const maxP = Math.max(...d.map((v) => v[1]));
  const W = 340, H = 70, span = Math.max(1, x1 - x0 + 1), bw = W / span;
  const pos = (m?: number) => { if (m === undefined) return undefined; const x = ((m - x0 + 0.5) / span) * W; return x >= 0 && x <= W ? x : undefined; };
  const mx = pos(marker), mx2 = pos(marker2);
  return (
    <figure className="hist">
      <figcaption className="mono small">{title} <span className="dim">{x0} to {x1}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H + 12}`} width="100%" role="img" aria-label={`${title}: histogram from ${x0} to ${x1}${marker !== undefined ? `, sportsbook line at ${marker}` : ''}`}>
        {d.map(([x, p]) => (
          <rect key={x} x={(x - x0) * bw} y={H - (p / maxP) * H} width={Math.max(bw - 0.5, 0.5)} height={(p / maxP) * H} className={x === 0 ? 'bar zero' : 'bar'} />
        ))}
        {mx !== undefined && <line x1={mx} x2={mx} y1={0} y2={H} className="mark" />}
        {mx2 !== undefined && <line x1={mx2} x2={mx2} y1={0} y2={H} className="mark2" />}
        <text x={0} y={H + 11} className="axis">{x0}</text>
        <text x={W} y={H + 11} textAnchor="end" className="axis">{x1}</text>
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------- Track tab (automatic backtest)
function TrackTab({ t }: { t: Terminal }) {
  // Uses the 20-minute throttle: opening this tab repeatedly must not re-query Kalshi each time.
  useEffect(() => { t.runBacktest(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const b = t.backtest;
  const roi = (x: BacktestSummary['total']) => {
    if (!x.staked) return '—';
    const r = Math.round((x.pnl / x.staked) * 100);
    return `${r > 0 ? '+' : ''}${r === 0 ? 0 : r}%`;
  };
  const cls = (x: BacktestSummary['total']) => (Math.abs(x.pnl) < 0.005 ? 'mute' : x.pnl > 0 ? 'pos' : 'neg');
  const row = (label: string, x: BacktestSummary['total']) => (
    <tr key={label}>
      <td>{label}</td><td className="mono">{x.n}</td>
      <td className="mono">{x.n ? `${pct(x.wins / x.n, 0)}%` : '—'}</td>
      <td className="mono">{x.n ? `${pct(x.avgProb, 0)}%` : '—'}</td>
      <td className={`mono ${cls(x)}`}>{money(x.pnl)}</td>
      <td className={`mono ${cls(x)}`}>{roi(x)}</td>
    </tr>
  );
  const head = <thead><tr><th></th><th>Picks</th><th>Won</th><th>Model</th><th>Profit $</th><th>Return</th></tr></thead>;
  const group = (title: string, g: Record<string, BacktestSummary['total']>, names: Record<string, string>) => (
    <div className="panel">
      <div className="small dim">{title}</div>
      <table className="kv track mono">{head}<tbody>{Object.entries(g).map(([k, v]) => row(names[k] ?? k, v))}</tbody></table>
    </div>
  );
  return (
    <section>
      <div className="panel">
        <p className="small"><b>Track record.</b> Every contract the Value list showed with a 2¢+ edge before its game started is logged on this phone and graded when Kalshi settles it, as if you bought 1 contract at the price shown plus the fee.</p>
        <p className="small dim">It only logs while the app is open, so it fills in over days. “Won” should come out close to “Model” if the model is honest. Several strikes from one game count as separate picks, so a few games can swing the numbers.</p>
        {!b || (!b.total.n && !b.pending) ? <p>No picks logged yet. Open the app on game days and results will appear here.</p>
          : !b.total.n ? <p>{b.pending} pick{b.pending === 1 ? '' : 's'} logged. Results appear here after the games finish and Kalshi settles them.</p>
          : <table className="kv track mono">{head}<tbody>{row('All graded', b.total)}</tbody></table>}
        {b && b.total.n > 0 && b.pending > 0 && <div className="small dim">{b.pending} more pick{b.pending === 1 ? '' : 's'} waiting for results.</div>}
      </div>
      {b && b.total.n > 0 && group('By sport', b.bySport, SPORT_NAME)}
      {b && b.total.n > 0 && group('By market', b.byKind, KIND_NAME)}
      {b && b.total.n > 0 && group('By tier', b.byTier, { A: 'Tier A', B: 'Tier B', C: 'Tier C' })}
      {b && b.recent.length > 0 && (
        <div className="panel">
          <div className="small dim">Latest graded picks (profit per contract)</div>
          {b.recent.map((r) => (
            <div className="kvline small" key={r.pick.key}>
              <span>{r.pick.title}<br /><span className="dim mono">{r.pick.side === 'yes' ? 'YES' : 'NO'} on {r.pick.ticker.split('-').slice(-2).join('-')} · {KIND_NAME[r.pick.kind] ?? r.pick.kind} · paid {cents1(r.pick.ask + r.pick.fee)}¢ · {r.won ? 'won' : 'lost'}</span></span>
              <b className={`mono ${r.won ? 'pos' : 'neg'}`}>{money(r.pnl)}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Data tab
function DataTab({ t }: { t: Terminal }) {
  const [showUnmatched, setShowUnmatched] = useState<Sport | null>(null);
  useEffect(() => {
    t.loadStatus();
    for (const s of SPORTS) t.loadPlan(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.mode]);
  const credits = t.status?.credits?.remaining ?? t.meta.credits?.remaining ?? null;
  const reserve = t.status?.reserve ?? 30;
  const fixtureMode = t.status?.mode === 'fixture';
  const demo = t.mode === 'demo';
  return (
    <section>
      <p className="intro">Where the numbers come from. Kalshi prices are free and update on their own. Sportsbook odds come from a free feed where possible; the paid Odds API (limited monthly credits) is the fallback.</p>
      <div className="panel">
        <div className="kvline small">
          <span>Data</span>
          <span role="group" aria-label="Data mode">
            <button className={`chip ${!demo ? 'on' : ''}`} aria-pressed={!demo} onClick={() => t.setMode('live')}>Live</button>{' '}
            <button className={`chip ${demo ? 'on' : ''}`} aria-pressed={demo} onClick={() => t.setMode('demo')}>Demo (recorded)</button>
          </span>
        </div>
        {demo && <p className="small warn-text">Demo shows a recorded sample of real markets so you can explore. Nothing here is a live price.</p>}
        {!t.status && t.statusError ? (
          <div className="err">Could not check the odds service ({t.statusError}). <button className="link inline" onClick={() => { t.loadStatus(); for (const s of SPORTS) t.loadPlan(s); }}>Try again</button></div>
        ) : (
          <>
            <div className="kvline"><span>Odds API credits left</span><b className="mono">{fixtureMode ? 'no key set' : credits ?? '—'}</b></div>
            {!fixtureMode && <div className="kvline dim small"><span>Refresh is blocked if it would leave fewer than</span><span className="mono">{reserve}</span></div>}
            {!fixtureMode && <div className="kvline dim small"><span>Credits checked</span><span className="mono">{ago(t.status?.credits?.checkedAt ?? t.meta.credits?.checkedAt)}</span></div>}
            <div className="kvline dim small"><span>Paid odds source</span><span className="mono">{!t.status ? 'checking…' : fixtureMode ? 'off (recorded odds only)' : 'The Odds API'}</span></div>
          </>
        )}
      </div>
      {t.notice && <button className="notice" onClick={() => t.setNotice(null)} aria-label="Dismiss message">{t.notice} <span className="dim">(tap to dismiss)</span></button>}
      <div role="status" aria-live="polite" className="sr">{t.notice ?? ''}</div>

      <div className="drow head mono"><span className="c-desc">SPORT</span><span>KALSHI</span><span>ODDS</span><span>COST</span><span /></div>
      {SPORTS.map((s) => {
        const res = t.results[s];
        const plan = t.plans[s];
        const cost = plan?.cost ?? 0;
        const low = !fixtureMode && credits !== null && credits - cost < reserve;
        const why = demo ? 'Switch to Live to refresh odds.'
          : !plan ? ''
          : !plan.keys.length ? 'Nothing to refresh: no open Kalshi game here is covered by sportsbooks right now.'
          : low ? `Not enough credits: this refresh needs ${cost} and must leave ${reserve}.`
          : '';
        const blocked = demo || !plan || !plan.keys.length || low;
        const um = res?.report.unmatchedKalshi.length ?? 0;
        const pricedN = res?.games.filter((g) => g.status === 'priced').length ?? 0;
        return (
          <div key={s} className="sportrow">
            <div className="drow mono">
              <span className="c-desc"><b>{SPORT_LABEL[s]}</b> <small>{t.busy[s] ? BUSY_LABEL[t.busy[s]!] ?? 'working…' : res ? `${pricedN} of ${res.games.length} games priced` : t.errors[s] ? 'not loaded' : 'waiting…'}</small></span>
              <span className="dim">{demo ? 'recorded' : ago(t.snaps[s]?.fetchedAt)}</span>
              <span className="dim">{demo ? 'recorded' : ago(t.meta.lastOddsRefresh?.[s])}</span>
              <span>{demo ? '—' : plan ? (cost === 0 ? 'free' : cost) : '…'}</span>
              <button className="btn" disabled={blocked || !!t.busy[s]} onClick={() => t.refreshOdds(s)} aria-label={`Refresh ${SPORT_NAME[s]} odds`}>
                {t.busy[s] === 'odds' ? '…' : 'Refresh'}
              </button>
            </div>
            <div className="sub small dim">
              {why && <span>{why} </span>}
              {!demo && plan && cost === 0 && plan.keys.length > 0 && !fixtureMode && <span>Free feed first; if it has no lines the paid feed is used ({plan.keys.length * (t.status?.costPerKey ?? 3)} credits at most). </span>}
              {plan?.unmapped.length ? <span>No sportsbook feed for: {plan.unmapped.join(', ')}. </span> : null}
              {um > 0 && <button className="link inline" aria-expanded={showUnmatched === s} onClick={() => setShowUnmatched(showUnmatched === s ? null : s)}>{um} game{um === 1 ? '' : 's'} without sportsbook lines</button>}
              {t.errors[s] && <span className="neg"> {t.errors[s]}. <button className="link inline" onClick={() => t.loadKalshi(s)}>Try again</button></span>}
            </div>
            {showUnmatched === s && res && (
              <ul className="unmatched mono small">
                {res.report.unmatchedKalshi.map((u) => <li key={u.gameId}>{u.title} <span className="dim">{when(u.startTime)} — {u.reason}</span></li>)}
                {res.report.unmatchedOdds.map((u) => <li key={u.id}>Sportsbook only: {u.title} <span className="dim">{when(u.commence)} — not on Kalshi</span></li>)}
              </ul>
            )}
          </div>
        );
      })}
      <p className="small dim">KALSHI and ODDS show when each was last updated. COST is Odds API credits for one refresh.</p>

      <div className="panel">
        <div className="kvline"><span>Saved history on this phone</span><b className="mono">{t.datasetCount} snapshot{t.datasetCount === 1 ? '' : 's'}</b></div>
        <p className="small dim">The app saves the flagged contracts and their prices every 30 minutes while it is open. The Track tab grades them. History older than 30 days is removed. It lives only on this device: add the app to your home screen so the phone keeps it.</p>
        <button className="btn" onClick={t.exportDataset} disabled={!t.datasetCount}>Export as file</button>{' '}
        <button className="btn ghost" onClick={() => { if (confirm(`Delete all ${t.datasetCount} saved snapshots on this device? The Track tab will start over.`)) t.clearDataset(); }} disabled={!t.datasetCount}>Delete history</button>
      </div>
      <p className="small dim">Kalshi prices reload every 90 seconds while the app is open (free). Sportsbook odds load automatically about once a day per sport for games starting within 24 hours, or when you tap Refresh.</p>
    </section>
  );
}
