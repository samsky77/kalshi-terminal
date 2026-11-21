import { quotesFromEvent, priceMarkets, filterFeed, selectionLabel } from '/home/user/kalshi-terminal/sigmaline/packages/core/src/index';
import { statValue } from '/home/user/kalshi-terminal/sigmaline/worker/src/simulate';
import { parseSelection } from '/home/user/kalshi-terminal/sigmaline/worker/src/edges';
for (const k of ['player_goals','player_shots_on_goal','player_assists','player_cards','player_goal_scorer_anytime','player_shots_on_target','player_to_receive_card'])
  console.log(k, statValue(k,{goals:1,shots_on_goal:3,shots_on_target:3,assists:1,cards:1,yellow_cards:1,minutes:90}), statValue(k,{assists:2}));
const now=Date.parse('2026-11-22T12:00:00Z'); const ts=(m:number)=>new Date(now-m*60000).toISOString();
const oc=(n:string,p:number,d:string)=>({name:n,price:p,description:d});
const m=(t:string,y:number,no:number)=>({key:'player_goals',last_update:t,outcomes:[oc('Yes',y,'Fake A'),oc('No',no,'Fake A')]});
const ev:any={id:'f',sport_key:'soccer_epl',commence_time:new Date(now+3600e3).toISOString(),home_team:'H',away_team:'A',bookmakers:[
 {key:'b1',markets:[m(ts(1),+200,-250)]},{key:'b2',markets:[m(ts(1),+190,-240)]},{key:'b3',markets:[m(ts(1),+185,-235)]},{key:'b4',markets:[m(ts(90),+240,-300)]}]};
const qs=quotesFromEvent(ev,'american',ts(0));
const empty:any={n:1,home:new Int16Array(1),away:new Int16Array(1),winner:new Int8Array(1)};
const pr=priceMarkets(empty,qs,{sport:'soccer',threeWay:true,bettable:new Set(['b1','b2','b3','b4']),w:{}});
const fr=filterFeed(pr,{nowMs:now,commenceMs:now+3600e3});
console.log(fr.counts);
for(const p of pr.filter(p=>p.selection.side==='over')) console.log('over',p.books,p.bestBook,(p.ev*100).toFixed(2),p.grade,'consensusP',p.consensusP.toFixed(4));
console.log('stale list',fr.stale.map(p=>p.key+' '+p.bestBook), 'keep',fr.keep.map(p=>p.key+' '+p.grade));
// consensus with/without stale book
const qs3=qs.filter(q=>q.book!=='b4');
const pr3=priceMarkets(empty,qs3,{sport:'soccer',threeWay:true,bettable:new Set(['b1','b2','b3']),w:{}});
console.log('consensusP without stale',pr3.find(p=>p.selection.side==='over')!.consensusP.toFixed(4));
console.log(parseSelection('prop:over:0.5:Jo:Fake Name:player_goals'));
