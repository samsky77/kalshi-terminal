const sports=['all','nba','nhl','nfl','cbb','cfb','soccer','tennis'],types=['all','game','prop'],books=['all','betmgm','draftkings','fanduel'],mins=['','2','3','5','8'],grades=['all','A','B'],sorts=['edge','start','updated'];
const dec=s=>s.replace(/&#x27;/g,"'").replace(/&amp;/g,'&');
function parse(h){h=h.replace(/<!-- -->/g,'');
 const m=h.match(/role="status">(\d+) of (\d+) live edges?</);
 const rows=[...h.matchAll(/<li class="border-b border-line2[^"]*"><a [^>]*href="\/game\/([^"]+)">(.*?)<\/a><\/li>/g)].map(x=>{const b=x[2];
  return {id:x[1],sport:(b.match(/uppercase tracking-\[0\.1em\] text-muted">(\w+) ·/)||[])[1],type:(b.match(/· (Prop|Game line) ·/)||[])[1],
   book:(b.match(/text-muted">([^<·]+) · (\d+) books/)||[])[1],ev:parseFloat((b.match(/text-amber">([+−-][\d.]+)%/)||[])[1].replace('−','-')),grade:(b.match(/aria-label="Grade (\w)"/)||[])[1],
   ts:(b.match(/dateTime="([^"]+)"/)||[])[1],label:dec(b.match(/leading-snug text-ink">([^<]+)</)[1])}});
 const sel={};for(const m of h.matchAll(/<select name="(\w+)"[^>]*>(.*?)<\/select>/g)){const o=[...m[2].matchAll(/<option value="([^"]*)"( selected="")?>/g)];sel[m[1]]=(o.find(x=>x[2])||[])[1];}
 return {n:m&&+m[1],m:m&&+m[2],rows,sel,hasStatus:!!m};}
(async()=>{
 const base='http://localhost:3100/edges';
 const all=parse(await (await fetch(base)).text());console.log('base',all.n,all.m,all.rows.length,JSON.stringify(all.sel));
 const bookName={betmgm:'BetMGM',draftkings:'DraftKings',fanduel:'FanDuel'};
 let bad=0,n=0;const issues={};
 const note=(k,u)=>{(issues[k]??=[]).push(u);bad++};
 for(const sport of sports)for(const type of types)for(const book of books)for(const min of mins)for(const grade of grades)for(const sort of sorts){
  const q=new URLSearchParams({sport,type,book,min,grade,sort}).toString();const u=base+'?'+q;n++;
  const r=await fetch(u);if(r.status!==200){note('status'+r.status,u);continue}
  const p=parse(await r.text());
  if(!p.hasStatus){note('nostatus',u);continue}
  const exp=all.rows.filter(x=>(sport=='all'||x.sport.toLowerCase()==({soccer:'soc',tennis:'ten'}[sport]||sport))&&(type=='all'||(type=='prop')==(x.type=='Prop'))&&(book=='all'||x.book==bookName[book])&&(!min||x.ev>=+min)&&(grade=='all'||x.grade==grade));
  if(p.rows.length!==p.n)note('countline!=rows',u);
  if(p.m!==all.m)note('M changed',u);
  if(p.n!==exp.length||p.rows.map(x=>x.id+x.label).sort().join()!==exp.map(x=>x.id+x.label).sort().join())note('rowset',u+' got '+p.rows.length+' exp '+exp.length);
  const key={edge:(a,b)=>b.ev-a.ev,start:null,updated:(a,b)=>b.ts.localeCompare(a.ts)}[sort];
  if(sort==='edge'&&p.rows.some((x,i)=>i&&p.rows[i-1].ev<x.ev))note('sort edge',u);
  if(sort==='updated'&&p.rows.some((x,i)=>i&&p.rows[i-1].ts<x.ts))note('sort updated',u);
  const s=p.sel;const want={sport,type,book,min,grade,sort};
  for(const k in want)if(s[k]!==want[k])note('select '+k+' not showing '+want[k]+' (shows '+s[k]+')',u);
 }
 console.log('combos',n,'issues',bad);for(const k in issues)console.log(k,issues[k].length,issues[k][0]);
})();
