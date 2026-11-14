'use client';
import { useEffect, useMemo, useState } from 'react';
import { valueRows, type ValueRow } from '@/core/pipeline';
import { SPORT_LABEL, STALE_HOURS } from '@/core/sports';
import { SPORTS, type MarketKind, type PricedContract, type PricedGame, type Sport, type Tier } from '@/core/types';
import { ago, cents, edgeC, pct, signClass, size, when } from './format';
import { useTerminal, type Terminal } from './useTerminal';

type Tab = 'value' | 'games' | 'data';
const KIND_LABEL: Record<MarketKind, string> = { winner: 'ML', tie: 'TIE', spread: 'SPR', total: 'TOT' };

export default function App() {
  const t = useTerminal();
  const [tab, setTab] = useState<Tab>('value');
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  const allGames = useMemo(() => SPORTS.flatMap((s) => t.results[s]?.games ?? []), [t.results]);
  const detailGame = detail ? allGames.find((g) => g.game.id === detail) : undefined;
  const credits = t.status?.credits?.remaining ?? t.meta.credits?.remaining ?? null;
  const working = Object.values(t.busy).filter(Boolean).length;

  return (
    <div className="app">
      <header className="top">
        <span className="brand">KX<b>TERM</b></span>
        <span className={`badge ${t.mode === 'demo' ? 'warn' : ''}`}>{t.mode === 'demo' ? 'DEMO' : t.status?.mode === 'fixture' ? 'NO KEY' : 'LIVE'}</span>
        {!t.online && <span className="badge neg">OFFLINE</span>}
        <span className="grow" />
        {working > 0 && <span className="spin" aria-label="working" />}
        <span className="mono dim">CR {credits ?? '—'}</span>
      </header>

      <main className="content">
        {tab === 'value' && <ValueTab t={t} onOpen={setDetail} />}
        {tab === 'games' && <GamesTab t={t} onOpen={setDetail} />}
        {tab === 'data' && <DataTab t={t} />}
      </main>

      {detailGame && <GameDetail g={detailGame} onClose={() => setDetail(null)} />}

      <nav className="tabs">
        {(['value', 'games', 'data'] as Tab[]).map((x) => (
          <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
            {x === 'value' ? 'Value' : x === 'games' ? 'Games' : 'Data'}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------- Value tab
function ValueTab({ t, onOpen }: { t: Terminal; onOpen: (id: string) => void }) {
  const [sport, setSport] = useState<Sport | 'all'>('all');
  const [kind, setKind] = useState<MarketKind | 'all'>('all');
  const [tiers, setTiers] = useState<Record<Tier, boolean>>({ A: true, B: true, C: false });
  const [minEdge, setMinEdge] = useState(2);

  const rows = useMemo(() => {
    const games = SPORTS.filter((s) => sport === 'all' || s === sport).flatMap((s) => t.results[s]?.games ?? []);
    return valueRows(games).filter((r) => (kind === 'all' || r.kind === kind) && tiers[r.tier] && r.edge * 100 >= minEdge - 1e-9);
  }, [t.results, sport, kind, tiers, minEdge]);

  const priced = SPORTS.reduce((a, s) => a + (t.results[s]?.games.filter((g) => g.status === 'priced').length ?? 0), 0);

  return (
    <section>
      <p className="anchor">Sim is anchored to sportsbook consensus lines, not an independent forecast. Edge = sim prob − ask − taker fee.</p>
      <div className="filters">
        <select value={sport} onChange={(e) => setSport(e.target.value as Sport | 'all')} aria-label="Sport">
          <option value="all">All sports</option>
          {SPORTS.map((s) => <option key={s} value={s}>{SPORT_LABEL[s]}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as MarketKind | 'all')} aria-label="Market type">
          <option value="all">All mkts</option>
          <option value="winner">Moneyline</option>
          <option value="spread">Spread</option>
          <option value="total">Total</option>
          <option value="tie">Tie</option>
        </select>
        <span className="tiers">
          {(['A', 'B', 'C'] as Tier[]).map((x) => (
            <button key={x} className={`chip tier-${x} ${tiers[x] ? 'on' : ''}`} onClick={() => setTiers({ ...tiers, [x]: !tiers[x] })}>{x}</button>
          ))}
        </span>
        <label className="minedge mono">
          ≥{minEdge}¢
          <input type="range" min={2} max={15} step={1} value={minEdge} onChange={(e) => setMinEdge(Number(e.target.value))} aria-label="Minimum edge" />
        </label>
      </div>

      <div className="row head mono">
        <span className="c-desc">CONTRACT</span><span>T</span><span>SIM</span><span>ASK</span><span>FEE</span><span>EDGE</span><span>SZ</span>
      </div>
      {rows.length === 0 && (
        <div className="empty">
          {priced === 0
            ? t.mode === 'live'
              ? 'No priced games yet. Open Data and refresh odds for a sport (manual, uses credits), or switch to Demo.'
              : 'Loading demo fixtures…'
            : 'No contracts pass the filters.'}
        </div>
      )}
      {rows.map((r) => <ValueLine key={`${r.ticker}-${r.side}`} r={r} onOpen={onOpen} />)}

      <footer className="legal">
        Model output, not advice. No guarantee of profit. Markets can move before you act.{' '}
        Gambling problem? Call <a href="tel:18004262537">1-800-GAMBLER</a> or visit{' '}
        <a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noreferrer">ncpgambling.org</a>.
      </footer>
    </section>
  );
}

function ValueLine({ r, onOpen }: { r: ValueRow; onOpen: (id: string) => void }) {
  return (
    <button className="row mono" onClick={() => onOpen(r.gameId)}>
      <span className="c-desc">
        <em className="sp">{SPORT_LABEL[r.sport]}</em> {r.description}
        <small>{r.game} · {when(r.startTime)}{r.stale ? ' · STALE' : ''}</small>
      </span>
      <span className={`tier tier-${r.tier}`}>{r.tier}</span>
      <span>{pct(r.prob, 0)}</span>
      <span>{cents(r.ask)}</span>
      <span className="dim">{cents(r.fee)}</span>
      <span className={signClass(r.edge)}>{edgeC(r.edge)}</span>
      <span className="dim">{size(r.size)}</span>
    </button>
  );
}

// ---------------------------------------------------------------- Games tab
function GamesTab({ t, onOpen }: { t: Terminal; onOpen: (id: string) => void }) {
  const [sport, setSport] = useState<Sport>('nfl');
  const res = t.results[sport];
  const err = t.errors[sport];
  return (
    <section>
      <div className="chips">
        {SPORTS.map((s) => (
          <button key={s} className={`chip ${sport === s ? 'on' : ''}`} onClick={() => setSport(s)}>
            {SPORT_LABEL[s]} <small>{t.results[s]?.games.length ?? (t.busy[s] ? '…' : '')}</small>
          </button>
        ))}
      </div>
      {err && <div className="err">Kalshi: {err}</div>}
      {!res && <div className="empty">{t.busy[sport] ? 'Loading Kalshi markets…' : 'No data yet.'}</div>}
      {res?.games.map((g) => <GameCard key={g.game.id} g={g} onOpen={onOpen} />)}
    </section>
  );
}

function GameCard({ g, onOpen }: { g: PricedGame; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [c0, c1] = g.game.competitors;
  const away = g.awayName ?? c0.name, home = g.homeName ?? c1.name;
  const by = (k: MarketKind) => g.contracts.filter((c) => c.contract.kind === k);
  const sortStrike = (a: PricedContract, b: PricedContract) => (a.contract.floorStrike ?? 0) - (b.contract.floorStrike ?? 0);
  const spreads = by('spread').sort((a, b) => (a.contract.code ?? '').localeCompare(b.contract.code ?? '') || sortStrike(a, b));
  const best = g.contracts.reduce((m, c) => Math.max(m, c.yes.edge ?? -1, c.no.edge ?? -1), -1);
  return (
    <div className="card">
      <button className="card-head" onClick={() => setOpen(!open)}>
        <span className="teams">
          <b>{away}</b> @ <b>{home}</b>
          <small className="mono">{when(g.game.startTime)} · {g.game.competition}</small>
        </span>
        <span className="badges">
          {g.status === 'unpriced' && <span className="badge mute" title={g.unpricedReason}>UNPRICED</span>}
          {g.status === 'started' && <span className="badge warn">STARTED</span>}
          {g.stale && <span className="badge warn">STALE</span>}
          {g.status === 'priced' && best >= 0.02 && <span className="badge pos mono">{edgeC(best)}</span>}
        </span>
      </button>
      {open && (
        <div className="ladders">
          {g.status === 'unpriced' ? (
            <p className="dim">Unpriced: {g.unpricedReason}. Kalshi lists {g.game.contracts.length} contracts; none are flagged without a sportsbook anchor.</p>
          ) : (
            <>
              <Ladder title="Moneyline / tie" rows={[...by('winner'), ...by('tie')]} />
              <Ladder title="Spread ladder" rows={spreads} />
              <Ladder title="Total ladder" rows={by('total').sort(sortStrike)} />
              <button className="link" onClick={() => onOpen(g.game.id)}>Sim distribution, consensus, books →</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Ladder({ title, rows }: { title: string; rows: PricedContract[] }) {
  if (!rows.length) return null;
  return (
    <div className="ladder">
      <div className="lad-title">{title}</div>
      <div className="lrow head mono"><span className="l-desc">YES =</span><span>T</span><span>SIM</span><span>Y ASK</span><span>Y EDGE</span><span>N ASK</span><span>N EDGE</span></div>
      {rows.map((c) => (
        <div key={c.contract.ticker} className="lrow mono">
          <span className="l-desc">{c.description}</span>
          <span className={`tier tier-${c.tier}`}>{c.tier}</span>
          <span>{pct(c.probYes, 1)}</span>
          <span>{cents(c.yes.ask)}</span>
          <span className={signClass(c.yes.edge)}>{edgeC(c.yes.edge)}{c.yes.value ? '•' : ''}</span>
          <span>{cents(c.no.ask)}</span>
          <span className={signClass(c.no.edge)}>{edgeC(c.no.edge)}{c.no.value ? '•' : ''}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Game detail
function GameDetail({ g, onClose }: { g: PricedGame; onClose: () => void }) {
  const c = g.consensus, s = g.sim;
  const homeHandicap = c?.spreadLine;
  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet-body">
        <div className="sheet-head">
          <b>{g.awayName ?? g.game.competitors[0].name} @ {g.homeName ?? g.game.competitors[1].name}</b>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="dim mono">{when(g.game.startTime)} · {g.game.competition} · {g.status.toUpperCase()}{g.stale ? ' · STALE' : ''}</p>
        <p className="anchor">This simulation is calibrated to the sportsbook consensus below. It is not an independent forecast.</p>
        {!c || !s ? (
          <p>Unpriced: {g.unpricedReason}</p>
        ) : (
          <>
            <h4>Consensus inputs (no-vig, median of books)</h4>
            <table className="kv mono"><tbody>
              <tr><td>ML home / away{c.pDraw !== undefined ? ' / draw' : ''}</td><td>{pct(c.pHome)} / {pct(c.pAway)}{c.pDraw !== undefined ? ` / ${pct(c.pDraw)}` : ''}</td><td className="dim">{c.booksMl} bk</td></tr>
              <tr><td>Main spread (home)</td><td>{homeHandicap ?? '—'} @ {pct(c.pHomeCover)}</td><td className="dim">{c.booksSpread} bk</td></tr>
              <tr><td>Main total</td><td>{c.totalLine ?? '—'} @ {pct(c.pOver)} over</td><td className="dim">{c.booksTotal} bk</td></tr>
              <tr><td>Sim ML home</td><td>{pct(c.pDraw !== undefined ? s.pHomeWin : s.pHomeWin / (s.pHomeWin + s.pAwayWin))}</td><td className="dim">fit Δ{pct(g.fit?.ml, 1)}</td></tr>
              <tr><td>Sim cover / over</td><td>{pct(s.pHomeCoverMain)} / {pct(s.pOverMain)}</td><td className="dim">{g.fit?.fitMiss.length ? `MISS ${g.fit.fitMiss.join(',')}` : 'fit ok'}</td></tr>
            </tbody></table>
            <Hist title={`Margin (${g.homeName} − ${g.awayName})`} data={s.marginHist} marker={homeHandicap !== undefined ? -homeHandicap : undefined} />
            <Hist title="Total" data={s.totalHist} marker={c.totalLine} />
            <h4>Model</h4>
            <p className="mono small">{s.model} · {s.runs.toLocaleString()} runs · seed {s.seed}<br />
              {Object.entries(s.params).map(([k, v]) => `${k}=${Number(v).toFixed(3)}`).join('  ')}</p>
            <h4>Books used ({c.books.length})</h4>
            <p className="mono small">{c.books.join(', ')}</p>
            <p className="mono small dim">Odds fetched {g.oddsFetchedAt ? `${new Date(g.oddsFetchedAt).toLocaleString()} (${ago(g.oddsFetchedAt)})` : '—'} · newest book update {c.lastUpdate ? new Date(c.lastUpdate).toLocaleString() : '—'} · stale after {STALE_HOURS}h</p>
          </>
        )}
      </div>
    </div>
  );
}

function Hist({ title, data, marker }: { title: string; data: [number, number][]; marker?: number }) {
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
  const mx = marker !== undefined ? ((marker - x0 + 0.5) / span) * W : undefined;
  return (
    <figure className="hist">
      <figcaption className="mono small">{title} <span className="dim">{x0}…{x1}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H + 12}`} width="100%" role="img" aria-label={title}>
        {d.map(([x, p]) => (
          <rect key={x} x={(x - x0) * bw} y={H - (p / maxP) * H} width={Math.max(bw - 0.5, 0.5)} height={(p / maxP) * H} className={x === 0 ? 'bar zero' : 'bar'} />
        ))}
        {mx !== undefined && mx >= 0 && mx <= W && <line x1={mx} x2={mx} y1={0} y2={H} className="mark" />}
        <text x={0} y={H + 11} className="axis">{x0}</text>
        <text x={W} y={H + 11} textAnchor="end" className="axis">{x1}</text>
      </svg>
    </figure>
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
  return (
    <section>
      <div className="panel">
        <div className="kvline"><span>Odds API credits left</span><b className="mono">{credits ?? '—'}</b></div>
        <div className="kvline dim small"><span>Reserve (refresh refused below)</span><span className="mono">{reserve}</span></div>
        <div className="kvline dim small"><span>Checked</span><span className="mono">{ago(t.status?.credits?.checkedAt ?? t.meta.credits?.checkedAt)}</span></div>
        <div className="kvline dim small"><span>Server odds source</span><span className="mono">{fixtureMode ? 'fixtures (no ODDS_API_KEY)' : 'The Odds API (us, h2h+spreads+totals)'}</span></div>
        <div className="kvline small">
          <span>Data mode</span>
          <span>
            <button className={`chip ${t.mode === 'live' ? 'on' : ''}`} onClick={() => t.setMode('live')}>Live</button>
            <button className={`chip ${t.mode === 'demo' ? 'on' : ''}`} onClick={() => t.setMode('demo')}>Demo (recorded)</button>
          </span>
        </div>
      </div>
      {t.notice && <div className="notice" onClick={() => t.setNotice(null)}>{t.notice}</div>}

      <div className="row head mono"><span className="c-desc">SPORT</span><span>KALSHI</span><span>ODDS</span><span>COST</span><span /></div>
      {SPORTS.map((s) => {
        const res = t.results[s];
        const plan = t.plans[s];
        const cost = plan?.cost ?? 0;
        const blocked = t.mode === 'demo' || (!fixtureMode && credits !== null && credits - cost < reserve) || !plan?.keys.length;
        const um = res?.report.unmatchedKalshi.length ?? 0;
        return (
          <div key={s} className="sportrow">
            <div className="row mono">
              <span className="c-desc"><b>{SPORT_LABEL[s]}</b> <small>{res ? `${res.games.filter((g) => g.status === 'priced').length}/${res.games.length} priced` : t.busy[s] ?? '…'}</small></span>
              <span className="dim">{ago(t.snaps[s]?.fetchedAt)}</span>
              <span className="dim">{ago(t.meta.lastOddsRefresh?.[s])}</span>
              <span>{plan ? cost : '…'}</span>
              <button className="btn" disabled={blocked || !!t.busy[s]} onClick={() => t.refreshOdds(s)} title={plan?.keys.join(', ')}>
                {t.busy[s] === 'odds' ? '…' : 'Refresh'}
              </button>
            </div>
            <div className="sub small dim">
              {plan?.keys.length ? `keys: ${plan.keys.join(', ')}` : plan ? 'no odds key has a matching open Kalshi event' : ''}
              {plan?.unmapped.length ? ` · no odds key for: ${plan.unmapped.join(', ')}` : ''}
              {um > 0 && <button className="link" onClick={() => setShowUnmatched(showUnmatched === s ? null : s)}> · {um} unmatched</button>}
              {t.errors[s] && <span className="neg"> · {t.errors[s]}</span>}
            </div>
            {showUnmatched === s && res && (
              <ul className="unmatched mono small">
                {res.report.unmatchedKalshi.map((u) => <li key={u.gameId}>K: {u.title} <span className="dim">{when(u.startTime)} — {u.reason}</span></li>)}
                {res.report.unmatchedOdds.map((u) => <li key={u.id}>O: {u.title} <span className="dim">{when(u.commence)} — no Kalshi event</span></li>)}
              </ul>
            )}
          </div>
        );
      })}

      <div className="panel">
        <div className="kvline"><span>Saved snapshots (backtest dataset)</span><b className="mono">{t.datasetCount}</b></div>
        <p className="small dim">Each odds refresh (and Kalshi prices at most every 15 min) stores sims, consensus and Kalshi prices on this device.</p>
        <button className="btn" onClick={t.exportDataset} disabled={!t.datasetCount}>Export JSON</button>{' '}
        <button className="btn ghost" onClick={() => { if (confirm('Delete all saved snapshots on this device?')) t.clearDataset(); }} disabled={!t.datasetCount}>Clear</button>
      </div>
      <p className="small dim">Kalshi markets reload every 90 s while open (free). Odds refresh only when you tap Refresh. Read-only: this app cannot place orders.</p>
    </section>
  );
}
