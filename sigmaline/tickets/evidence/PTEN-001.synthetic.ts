import { simulateGame, priceMarkets, quotesFromEvent, filterFeed, GRADE_CONFIG } from '/home/user/kalshi-terminal/sigmaline/packages/core/src/index';
const t=new Date().toISOString();
const mk=(key:string,rows:any[])=>({key,last_update:t,outcomes:rows});
const books=['b1','b2','b3','b5','b6','b4'];
const bk=(k:string,i:number)=>({key:k,last_update:t,markets:[
 mk('h2h',[{name:'H',price:1.80},{name:'A',price:2.0}]),
 mk('spreads',[{name:'H',price:1.9+(k==='b4'?0.16:0),point:-2.5},{name:'A',price:1.9,point:2.5}]),
 mk('totals',[{name:'Over',price:1.9+(k==='b4'?0.16:0),point:21.5},{name:'Under',price:1.9}]),
 mk('player_aces',[{name:'Over',description:'Carlos Alcaraz',price:1.9+(k==='b4'?0.16:0),point:7.5},{name:'Under',description:'Carlos Alcaraz',price:1.9,point:7.5}]),
]});
const ev:any={id:1,sport_key:'tennis_atp_x',commence_time:new Date(Date.now()+86400000).toISOString(),home_team:'H',away_team:'A',bookmakers:books.map(bk)};
const quotes=quotesFromEvent(ev,'decimal',t);
const sim:any=simulateGame({sport:'tennis',seed:1,n:10000,tennis:{tour:'atp',bestOf:3,slam:false,modelWinProb:0.55,anchor:{totalLine:21.5}}} as any);
const priced=priceMarkets(sim.samples,quotes,{sport:'tennis',threeWay:false,bettable:new Set(books),w:{ml:0.35,spread:0.35,total:0.35,prop:0.35} as any,marketOnly:true});
const f=filterFeed(priced,{nowMs:Date.now(),commenceMs:Date.parse(ev.commence_time)});
for(const p of f.keep.filter(p=>p.bestBook==='b4'||p.grade!=='none')) console.log(p.selection.market,p.selection.side,p.selection.line,p.selection.player,p.selection.stat,p.bestBook,p.books,(p.ev*100).toFixed(1)+'%',p.grade,p.fairSource);
console.log('ALL', priced.filter(p=>p.selection.market==='total').map(p=>[p.selection.side,p.bestBook,p.ev,p.grade,p.fairSource].join(' ')));
