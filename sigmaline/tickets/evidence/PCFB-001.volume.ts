import { keepDeepLines } from '/home/user/kalshi-terminal/sigmaline/worker/src/ingest';
const books=['dk','fd','mgm','czr','espnbet','fanatics','hardrock','betrivers'];
function game(altRungs:number, altBooks:number, propAlt:number, propAltBooks:number, propBooks:number){
  const q:any[]=[]; const ts='t';
  books.forEach(b=>{q.push({book:b,market:'ml',prices:{home:1.5,away:2.6},ts});
    q.push({book:b,market:'spread',line:-7.5,prices:{},ts});q.push({book:b,market:'total',line:54.5,prices:{},ts});});
  for(let r=1;r<=altRungs;r++) for(const m of ['spread','total'] as const) books.slice(0,altBooks).forEach(b=>q.push({book:b,market:m,line:(m==='spread'?-7.5:54.5)+r,prices:{},ts}));
  const pm=[['player_pass_yds',2],['player_pass_tds',2],['player_rush_yds',4],['player_reception_yds',6],['player_receptions',6]] as const;
  for(const [s,n] of pm) for(let p=0;p<n;p++){
    books.slice(0,propBooks).forEach(b=>q.push({book:b,market:'prop',line:50.5,player:s+p,stat:s,prices:{},ts}));
    for(let r=1;r<=propAlt;r++) books.slice(0,propAltBooks).forEach(b=>q.push({book:b,market:'prop',line:50.5+10*r,player:s+p,stat:s,prices:{},ts}));}
  return q;
}
for(const [name,args] of [['main only',[0,0,0,0,6]],['alt game 10 rungs x4 books, props main only',[10,4,0,0,6]],['+2 prop rungs x3 books',[10,4,2,3,6]],['+4 prop rungs x4 books (heavy)',[20,5,4,4,7]]] as any){
  const g=game(...args); const k=keepDeepLines(g); const props=k.filter(x=>x.market==='prop').length;
  console.log(name,'raw/game',g.length,'kept/game',k.length,'(props',props,') x63 =',k.length*63,'per full-league pull');
}
