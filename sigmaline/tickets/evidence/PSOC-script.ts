import { quotesFromEvent, priceMarkets, filterFeed, selectionLabel, buildWriteup, gradeBet, SPORT_DEFS, PROP_MARKETS, propLabel, edgePct } from '/home/user/kalshi-terminal/sigmaline/packages/core/src/index';
const now = Date.parse('2026-11-22T12:00:00Z');
const ts = (m:number)=>new Date(now-m*60000).toISOString();
const home='FAKE United', away='FAKE City';
const oc=(name:string,price:number,description?:string,point?:number,extra:any={})=>({name,price,description,point,...extra});
const books=['b1','b2','b3','b4'];
function bk(key:string, markets:any[], last?:string){return {key, last_update:last, markets};}
const bms:any[]=[];
// anytime goalscorer Yes/No, 4 books, player A
const gs=(b:string,y:number,n:number,t=ts(1))=>({key:'player_goals',last_update:t,outcomes:[oc('Yes',y,'Fake Striker'),oc('No',n,'Fake Striker')]});
bms.push(bk('b1',[gs('b1',+150,-190)]),bk('b2',[gs('b2',+140,-175)]),bk('b3',[gs('b3',+145,-180)]),bk('b4',[gs('b4',+200,-250)])); // b4 generous
// shots on goal over/under rungs 0.5, 1.5, 2.5
const sog=(l:number,o:number,u:number,t=ts(1))=>({key:'player_shots_on_goal',last_update:t,outcomes:[oc('Over',o,'Fake Winger',l),oc('Under',u,'Fake Winger',l)]});
for (const [b,o,u] of [['b1',-150,120],['b2',-140,110],['b3',-145,115]] as any) bms.find(x=>x.key==b).markets.push(sog(1.5,o,u));
bms.find(x=>x.key=='b1').markets.push(sog(2.5,+250,-330)); // one-book alt rung
bms.find(x=>x.key=='b2').markets.push(sog(0.5,-300,+240), sog(2.5,+260,-340));
// assists
const ast=(o:number,u:number)=>({key:'player_assists',last_update:ts(2),outcomes:[oc('Over',o,'Fake Midfielder',0.5),oc('Under',u,'Fake Midfielder',0.5)]});
bms[0].markets.push(ast(+200,-260)); bms[1].markets.push(ast(+190,-250));
// cards yes/no and over
const cd=(y:number,n:number,t=ts(1),extra:any={})=>({key:'player_cards',last_update:t,outcomes:[oc('Over',y,'Fake Defender',0.5,extra),oc('Under',n,'Fake Defender',0.5)]});
bms[0].markets.push(cd(+180,-230)); bms[1].markets.push(cd(+170,-220)); bms[2].markets.push(cd(+175,-225,ts(1),{suspended:true}));
// stale one: player Stale Guy, book b4 stale 120 min, generous
const stl=(t:string,y:number,n:number)=>({key:'player_goals',last_update:t,outcomes:[oc('Yes',y,'Fake Stale',undefined),oc('No',n,'Fake Stale')]});
bms[0].markets.push(stl(ts(1),+300,-400)); bms[1].markets.push(stl(ts(1),+290,-380)); bms[3].markets.push(stl(ts(120),+500,-700));
// one-book only
bms[2].markets.push({key:'player_goals',last_update:ts(1),outcomes:[oc('Yes',+400,'Fake OneBook'),oc('No',-600,'Fake OneBook')]});
// two books A grade test: huge edge >25 sanity
bms[0].markets.push({key:'player_goals',last_update:ts(1),outcomes:[oc('Yes',+300,'Fake Sanity'),oc('No',-400,'Fake Sanity')]});
bms[1].markets.push({key:'player_goals',last_update:ts(1),outcomes:[oc('Yes',+280,'Fake Sanity'),oc('No',-380,'Fake Sanity')]});
bms[3].markets.push({key:'player_goals',last_update:ts(1),outcomes:[oc('Yes',+500,'Fake Sanity'),oc('No',-700,'Fake Sanity')]});
// provider-style odd keys
bms[0].markets.push({key:'player_goal_scorer_anytime',last_update:ts(1),outcomes:[oc('Yes',+150,'Fake Striker')]},{key:'player_to_receive_card',last_update:ts(1),outcomes:[oc('Yes',+200,'Fake Defender'),oc('No',-260,'Fake Defender')]},{key:'player_shots_on_target',last_update:ts(1),outcomes:[oc('Over',-120,'Fake Winger',1.5),oc('Under',-110,'Fake Winger',1.5)]});
// Odds missing prices
const ev:any={id:'fake1',sport_key:'soccer_epl',commence_time:new Date(now+3600e3).toISOString(),home_team:home,away_team:away,bookmakers:bms};
const stats={suspended:0};
const qs=quotesFromEvent(ev,'american',ts(0),stats);
console.log('quotes',qs.length,'suspended',stats);
const empty:any={n:1,home:new Int16Array(1),away:new Int16Array(1),winner:new Int8Array(1)};
const priced=priceMarkets(empty,qs,{sport:'soccer',threeWay:true,bettable:new Set(books),w:{}});
const fr=filterFeed(priced,{nowMs:now,commenceMs:now+3600e3});
console.log('counts',fr.counts);
const row=(p:any)=>`${selectionLabel(p.selection,home,away).padEnd(48)} bk=${p.books} best=${p.bestBook}@${p.bestDecimal.toFixed(2)} fair=${p.fairDecimal.toFixed(3)} ev=${(p.ev*100).toFixed(2)}% cEv=${(p.consensusEv*100).toFixed(2)} grade=${p.grade} src=${p.fairSource} bestTs=${p.bestTs?Math.round((now-Date.parse(p.bestTs))/60000)+'m':null} key=${p.key}`;
console.log('--- ALL priced'); priced.forEach(p=>console.log(row(p)));
console.log('--- KEEP'); fr.keep.forEach(p=>console.log(row(p)));
console.log('--- STALE'); fr.stale.forEach(p=>console.log(row(p)));
console.log('--- ANOM'); fr.anomalies.forEach(p=>console.log(row(p)));
// edge math check
for(const p of priced){const e=edgePct(p.fair.win,p.bestDecimal,p.fair.push); if(Math.abs(e-p.ev)>1e-9)console.log('EDGE MISMATCH',p.key)}
// labels for each key
for(const k of [...PROP_MARKETS.soccer,'player_goal_scorer_anytime','player_to_receive_card','player_shots_on_target','player_shots','player_first_goal_scorer']){
 console.log(k,'->',propLabel(k),'|',selectionLabel({market:'prop',side:'over',line:0.5,player:'P',stat:k},home,away),'|',selectionLabel({market:'prop',side:'under',line:0.5,player:'P',stat:k},home,away),'|',selectionLabel({market:'prop',side:'over',line:1.5,player:'P',stat:k},home,away));
}
// writeup
const p=fr.keep[0]??priced[0];
const w=buildWriteup({sport:'soccer',home,away,selection:p.selection,selectionLabel:selectionLabel(p.selection,home,away),bestDecimal:p.bestDecimal,book:p.bestBook!,modelP:NaN,consensusP:p.consensusP,fairP:p.fair.win,ev:p.ev,booksChecked:p.books,fairSource:'consensus'});
console.log(JSON.stringify(w,null,1));
const wu=buildWriteup({sport:'soccer',home,away,selection:{market:'prop',side:'under',line:1.5,player:'Fake Winger',stat:'player_shots_on_goal'},selectionLabel:'x',bestDecimal:1.9,book:'b1',modelP:NaN,consensusP:0.5,fairP:0.55,ev:0.045,booksChecked:3,fairSource:'consensus'});
console.log(JSON.stringify(wu,null,1));
// grading
console.log('grade no player',gradeBet({market:'prop',side:'over',line:0.5,player:'X',stat:'player_goals'},'soccer',{home:1,away:0,props:{}}));
console.log('grade goals1',gradeBet({market:'prop',side:'over',line:0.5,player:'X',stat:'player_goals'},'soccer',{home:1,away:0,props:{'X|player_goals':1}}));
console.log('grade cards under 0.5 w 0',gradeBet({market:'prop',side:'under',line:0.5,player:'X',stat:'player_cards'},'soccer',{home:1,away:0,props:{'X|player_cards':0}}));
console.log('grade integer line push',gradeBet({market:'prop',side:'over',line:2,player:'X',stat:'player_shots_on_goal'},'soccer',{home:1,away:0,props:{'X|player_shots_on_goal':2}}));
