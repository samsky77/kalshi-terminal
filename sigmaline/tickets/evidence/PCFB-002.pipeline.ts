import { PROP_MARKETS, quotesFromEvent, priceMarkets, filterFeed, buildWriteup, selectionLabel, propLabel, GRADE_CONFIG, americanToDecimal } from '/home/user/kalshi-terminal/sigmaline/packages/core/src';
import { keepDeepLines } from '/home/user/kalshi-terminal/sigmaline/worker/src/ingest';
import { statValue } from '/home/user/kalshi-terminal/sigmaline/worker/src/simulate';
const NOW = Date.parse('2026-11-21T18:00:00Z'); const iso=(m:number)=>new Date(NOW-m*60000).toISOString();
const HOME='Fake Home State', AWAY='Fake Away Tech';
const samples:any={n:100,home:new Int16Array(100),away:new Int16Array(100),winner:new Int8Array(100)};
const opt:any={sport:'cfb',threeWay:false,bettable:new Set(['dk','fd','mgm','czr','pin']),w:{prop:0.35}};
function mk(books:{k:string;ageMin:number;over:number;under:number;pt?:number;susp?:boolean}[], stat:string, player='Fake QB Alpha'){
  return {id:'x',sport_key:'americanfootball_ncaaf',commence_time:iso(-120),home_team:HOME,away_team:AWAY,
   bookmakers:books.map(b=>({key:b.k,last_update:iso(b.ageMin),markets:[{key:stat,last_update:iso(b.ageMin),outcomes:[
     {name:'Over',description:player,price:b.over,point:b.pt??250.5,suspended:b.susp},{name:'Under',description:player,price:b.under,point:b.pt??250.5}]}]}))} as any;
}
const run=(ev:any,label:string)=>{
  const st={suspended:0}; const q=quotesFromEvent(ev,'american',iso(0),st);
  const kept=keepDeepLines(q);
  const pr=priceMarkets(samples,kept,opt);
  const f=filterFeed(pr,{nowMs:NOW,commenceMs:NOW+7200000});
  console.log('\n##',label,'quotes',q.length,'kept',kept.length,'susp',st.suspended);
  for(const p of pr) console.log(' ',selectionLabel(p.selection,HOME,AWAY),'|best',p.bestBook,p.bestDecimal.toFixed(3),'books',p.books,'fairDec',p.fairDecimal.toFixed(3),'consP',p.consensusP.toFixed(4),'ev',(p.ev*100).toFixed(2)+'%','grade',p.grade,'src',p.fairSource);
  console.log('  feed keep',f.keep.length,'stale',f.stale.length,'anom',f.anomalies.length,JSON.stringify(f.counts));
  return {pr,f};
};
// labels for all CFB markets
console.log('CFB markets',PROP_MARKETS.cfb.map(k=>k+'='+propLabel(k)).join(', '));
for(const s of PROP_MARKETS.cfb){ const sel:any={market:'prop',side:'over',line:49.5,player:'Fake Player',stat:s}; console.log(s,'->',selectionLabel(sel,HOME,AWAY), '| statValue sample:', statValue(s,{passing_yards:1,pass_yds:2,passing_touchdowns:3,rushing_yards:4,receiving_yards:5,receptions:6})); }
// 1 normal edge: consensus-only, +EV line shop
const base=(o:any)=>({k:'',ageMin:2,over:-110,under:-110,...o});
run(mk([base({k:'dk',over:-110,under:-110}),base({k:'fd',over:-112,under:-108}),base({k:'mgm',over:-108,under:-112}),base({k:'czr',over:+105,under:-125})],'player_pass_yds'),'1 four books, one generous over (+105)');
// 2 integer line push
run(mk([base({k:'dk',pt:5,over:-120,under:100}),base({k:'fd',pt:5,over:-125,under:105}),base({k:'mgm',pt:5,over:-118,under:-102}),base({k:'czr',pt:5,over:+105,under:-135})],'player_receptions','Fake WR Beta'),'2 integer line receptions 5.0 (push possible)');
// 3 single book
run(mk([base({k:'dk',over:+130,under:-160})],'player_rush_yds'),'3 single book');
// 4 two books
run(mk([base({k:'dk',over:+110,under:-130}),base({k:'fd',over:-110,under:-110})],'player_rush_yds'),'4 two books');
// 5 stale best + fresh others
run(mk([base({k:'dk',over:-110,under:-110}),base({k:'fd',over:-112,under:-108}),base({k:'mgm',over:-108,under:-112}),base({k:'czr',ageMin:30,over:+115,under:-140})],'player_pass_tds','Fake QB Alpha'),'5 best price from 30-min old book (stale threshold 10)');
// 5b stale book drives consensus, best price from fresh book
run(mk([base({k:'dk',over:-105,under:-125}),base({k:'fd',ageMin:60,over:+130,under:-170}),base({k:'mgm',ageMin:60,over:+130,under:-170}),base({k:'czr',ageMin:90,over:+135,under:-175})],'player_reception_yds','Fake WR Beta'),'5b consensus from 3 hour-old quotes, fresh DK price vs them');
// 6 suspended over at best book
run(mk([base({k:'dk',over:-110,under:-110}),base({k:'fd',over:-112,under:-108}),base({k:'mgm',over:-108,under:-112}),base({k:'czr',over:+150,under:-190,susp:true})],'player_pass_yds'),'6 suspended over at czr');
// 7 huge edge >25%
run(mk([base({k:'dk',over:-110,under:-110}),base({k:'fd',over:-112,under:-108}),base({k:'mgm',over:-108,under:-112}),base({k:'czr',over:+190,under:-250})],'player_pass_yds'),'7 prop edge ~ >25% (sanity)');
// 7b 15% edge -> A? 
run(mk([base({k:'dk',over:-110,under:-110}),base({k:'fd',over:-112,under:-108}),base({k:'mgm',over:-108,under:-112}),base({k:'czr',over:+125,under:-160})],'player_pass_yds'),'7b ~ 17% edge');
// 8 alternate rung: 2 books on alt line
const ev8=mk([base({k:'dk',pt:200.5,over:-250,under:200}),base({k:'fd',pt:200.5,over:-260,under:210}),base({k:'mgm',pt:250.5}),base({k:'czr',pt:250.5}),base({k:'dk',pt:250.5})],'player_pass_yds');
// mixed-book alt line
run(ev8,'8 alt line');
// writeup
const {pr}=run(mk([base({k:'dk',over:-110,under:-110}),base({k:'fd',over:-112,under:-108}),base({k:'mgm',over:-108,under:-112}),base({k:'czr',over:+105,under:-125})],'player_pass_yds'),'writeup');
const p=pr.find(x=>x.selection.side==='over')!;
const w=buildWriteup({sport:'cfb',home:HOME,away:AWAY,selection:p.selection,selectionLabel:selectionLabel(p.selection,HOME,AWAY),bestDecimal:p.bestDecimal,book:p.bestBook!,modelP:p.model.win,consensusP:p.consensusP,fairP:p.fair.win,ev:p.ev,booksChecked:p.books,fairSource:p.fairSource});
console.log(JSON.stringify(w,null,1));
const w2=buildWriteup({sport:'cfb',home:HOME,away:AWAY,selection:p.selection,selectionLabel:selectionLabel(p.selection,HOME,AWAY),bestDecimal:p.bestDecimal,book:p.bestBook!,modelP:NaN,consensusP:p.consensusP,fairP:p.fair.win,ev:p.ev,booksChecked:p.books,fairSource:p.fairSource,propMean:undefined});
console.log(JSON.stringify(w2));
