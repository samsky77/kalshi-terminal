import { quotesFromEvent, priceMarkets, filterFeed, PROP_MARKETS, propLabel, selectionLabel, buildWriteup, edgePct, SPORT_DEFS, GRADE_CONFIG } from '/home/user/kalshi-terminal/sigmaline/packages/core/src';
const NOW = Date.parse('2026-11-21T20:00:00Z');
const fresh = new Date(NOW - 2*60000).toISOString(), old = new Date(NOW - 45*60000).toISOString();
const books = ['fakebook_a','fakebook_b','fakebook_c','fakebook_d'];
const ev:any = { id:'FAKE1', sport_key:'icehockey_nhl', commence_time:new Date(NOW+3600e3).toISOString(), home_team:'Fake Home', away_team:'Fake Away', bookmakers:[] };
const o=(name:string,price:number,description:string,point?:number,extra:any={})=>({name,price,description,point,...extra});
function mk(bk:string, ts:string, markets:any[]){ return {key:bk,markets:markets.map(m=>({last_update:ts,...m}))}; }
const pl='Fake Skater One';
const bks:any[]=[];
const stats = PROP_MARKETS.nhl;
for (const [i,b] of books.entries()) {
  const ms:any[]=[];
  const d=(x:number)=>+(x+i*0.02).toFixed(3);
  ms.push({key:'player_shots_on_goal',outcomes:[o('Over',d(1.90),pl,2.5),o('Under',d(1.90),pl,2.5), ...(i<3?[o('Over',d(3.2),pl,3.5),o('Under',d(1.30),pl,3.5)]:[]), ...(i===0?[o('Over',2.8,pl,4.5),o('Under',1.4,pl,4.5)]:[])]});
  ms.push({key:'player_goals',outcomes:[o('Yes',d(2.5),pl),o('No',d(1.55),pl), o('Over',d(2.5),'Fake Skater Two',0.5),o('Under',d(1.55),'Fake Skater Two',0.5)]});
  ms.push({key:'player_points',outcomes:[o('Over',d(1.95),pl,0.5),o('Under',d(1.85),pl,0.5)]});
  ms.push({key:'player_assists',outcomes:[o('Over',d(2.1),pl,0.5),o('Under',d(1.75),pl,0.5)]});
  ms.push({key:'player_blocked_shots',outcomes:[o('Over',d(1.9),pl,1.5),o('Under',d(1.9),pl,1.5)]});
  ms.push({key:'goalie_saves',outcomes:[o('Over',d(1.9),'Fake Goalie',26.5),o('Under',d(1.9),'Fake Goalie',26.5)]});
  bks.push(mk(b, fresh, ms));
}
// one-book line, suspended outcome, stale book offering big price
bks[0].markets.push({key:'player_points',last_update:fresh,outcomes:[o('Over',1.9,'Fake Solo',1.5),o('Under',1.9,'Fake Solo',1.5)]});
bks[1].markets.find((m:any)=>m.key==='player_assists').outcomes[0].suspended=true;
bks.push(mk('fakebook_stale',old,[{key:'player_blocked_shots',outcomes:[o('Over',2.2,pl,1.5),o('Under',1.7,pl,1.5)]}]));
// 2-book only rung + big edge outlier
bks.push(mk('fakebook_e',fresh,[{key:'player_shots_on_goal',outcomes:[o('Over',3.3,pl,2.5),o('Under',1.4,pl,2.5)]},{key:'player_goals',outcomes:[o('Yes',9,pl),o('No',1.05,pl)]}]));
ev.bookmakers=bks;
const st={suspended:0};
const qs=quotesFromEvent(ev,'decimal',new Date(NOW).toISOString(),st);
console.log('quotes',qs.length,'suspended',st.suspended);
for(const k of PROP_MARKETS.nhl) console.log('label',k,'=>',propLabel(k));
const n=100; const samples:any={n,home:new Int16Array(n),away:new Int16Array(n),winner:new Int8Array(n)};
const priced=priceMarkets(samples,qs,{sport:'nhl',threeWay:false,bettable:new Set([...books,'fakebook_stale','fakebook_e']),w:{}});
const f=filterFeed(priced,{nowMs:NOW,commenceMs:NOW+3600e3});
console.log('counts',f.counts,'keep',f.keep.length,'stale',f.stale.length,'anom',f.anomalies.length);
const show=(p:any)=>console.log([selectionLabel(p.selection,'H','A'),p.key,'books',p.books,'best',p.bestBook,p.bestDecimal,'cP',p.consensusP?.toFixed(4),'fairDec',p.fairDecimal?.toFixed(3),'ev',(p.ev*100).toFixed(2)+'%','grade',p.grade,p.fairSource].join(' | '));
console.log('--- priced (all)'); priced.forEach(show);
console.log('--- keep'); f.keep.forEach(show);
console.log('--- stale'); f.stale.forEach(show);
console.log('--- anomalies'); f.anomalies.forEach(show);
// edge math check
for(const p of priced){ const e=edgePct(p.consensusP,p.bestDecimal); if(Math.abs(e-p.ev)>1e-9) console.log('EDGE MISMATCH',p.key,e,p.ev); }
// writeup
const pick=f.keep.find(p=>p.selection.stat==='player_shots_on_goal'&&p.selection.side==='over')!;
const w=buildWriteup({sport:'nhl',home:'Fake Home',away:'Fake Away',selection:pick.selection,selectionLabel:selectionLabel(pick.selection,'Fake Home','Fake Away'),bestDecimal:pick.bestDecimal,book:pick.bestBook!,modelP:NaN,consensusP:pick.consensusP,fairP:pick.fair.win,ev:pick.ev,booksChecked:pick.books,fairSource:pick.fairSource});
console.log(JSON.stringify(w,null,1));
const g=f.keep.find(p=>p.selection.stat==='player_goals'&&p.selection.player===pl&&p.selection.side==='over');
if(g){const w2=buildWriteup({sport:'nhl',home:'Fake Home',away:'Fake Away',selection:g.selection,selectionLabel:selectionLabel(g.selection,'Fake Home','Fake Away'),bestDecimal:g.bestDecimal,book:g.bestBook!,modelP:NaN,consensusP:g.consensusP,fairP:g.fair.win,ev:g.ev,booksChecked:g.books,fairSource:g.fairSource});console.log(JSON.stringify(w2,null,1));}
