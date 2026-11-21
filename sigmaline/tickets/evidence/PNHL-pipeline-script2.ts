import { quotesFromEvent, priceMarkets, filterFeed, selectionLabel, buildWriteup } from '/home/user/kalshi-terminal/sigmaline/packages/core/src';
const NOW = Date.parse('2026-11-21T20:00:00Z'); const fresh=new Date(NOW-120000).toISOString();
const o=(name:string,price:number,description:string,point?:number)=>({name,price,description,point});
const mkEv=(bk:any[])=>({id:'F',sport_key:'icehockey_nhl',commence_time:new Date(NOW+3600e3).toISOString(),home_team:'Fake Home',away_team:'Fake Away',bookmakers:bk});
const run=(ev:any,label:string)=>{
  const qs=quotesFromEvent(ev,'decimal',new Date(NOW).toISOString());
  const n=10;const s:any={n,home:new Int16Array(n),away:new Int16Array(n),winner:new Int8Array(n)};
  const pr=priceMarkets(s,qs,{sport:'nhl',threeWay:false,bettable:new Set(['a','b','c']),w:{}});
  const f=filterFeed(pr,{nowMs:NOW,commenceMs:NOW+3600e3});
  console.log('==',label,'priced',pr.length,'keep',f.keep.length,JSON.stringify(f.counts));
  return {pr,f};
};
// A: Yes-only anytime goals
const yesOnly=['a','b','c'].map((b,i)=>({key:b,markets:[{key:'player_goals',last_update:fresh,outcomes:[o('Yes',2.4+i*0.05,'Fake Skater',undefined as any)]}]}));
const r=run(mkEv(yesOnly),'Yes-only goals');
r.pr.forEach(p=>console.log(selectionLabel(p.selection,'H','A'),p.books,p.bestDecimal,p.ev,p.fairDecimal));
// B: graded row
const g=[1.9,1.9,1.95].map((x,i)=>({key:['a','b','c'][i],markets:[{key:'player_player_x',last_update:fresh,outcomes:[]},{key:'player_shots_on_goal',last_update:fresh,outcomes:[o('Over',x,'Fake Skater',2.5),o('Under',1.9,'Fake Skater',2.5)]}]}));
g[2].markets[1].outcomes[0].price=2.05;
const r2=run(mkEv(g),'graded');
r2.f.keep.forEach(p=>{console.log(selectionLabel(p.selection,'Fake Home','Fake Away'),p.books,p.bestDecimal,(p.ev*100).toFixed(2),p.grade);
 if(p.grade!=='none'){console.log(JSON.stringify(buildWriteup({sport:'nhl',home:'Fake Home',away:'Fake Away',selection:p.selection,selectionLabel:selectionLabel(p.selection,'Fake Home','Fake Away'),bestDecimal:p.bestDecimal,book:p.bestBook!,modelP:NaN,consensusP:p.consensusP,fairP:p.fair.win,ev:p.ev,booksChecked:p.books,fairSource:p.fairSource}),null,1));}});
// C: 2 books -> grade
const two=g.slice(1);const r3=run(mkEv(two),'two books');r3.f.keep.forEach(p=>console.log(p.selection.side,p.books,(p.ev*100).toFixed(2),p.grade));
// D: all books stale -> everything stale
