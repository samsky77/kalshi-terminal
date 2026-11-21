import json,re,glob
d=json.load(open('/home/user/kalshi-terminal/sigmaline/app/.data/demo-db.json'))
ev={e['id']:e for e in d['events']}
def am(x):
    if x>=2: a=round((x-1)*100+1e-9); return f'+{a}'
    a=round(100/(x-1)); return f'−{a}'
def pc(x):
    v=f'{abs(x)*100:.1f}'; return ('+' if x>0 else '−' if x<0 else '')+v+'%'
def lab(r,e):
    s=r['selection']; t=e['home'] if s['side']=='home' else e['away']
    if r['market']=='ml': return 'Draw' if s['side']=='draw' else t+' ML'
    if r['market']=='spread':
        l=s['line']; ls=('+%g'%l) if l>0 else ('PK' if l==0 else '−%g'%abs(l)); return f'{t} {ls}'
    return ('Over ' if s['side']=='over' else 'Under ')+'%g'%s['line']
tot=0;bad=[]
for f in glob.glob('g_*.txt'):
    eid=f[2:-4]; e=ev[eid]; t=open(f).read()
    for r in [r for r in d['market_prices'] if r['event_id']==eid]:
        L=lab(r,e)
        m=re.search(re.escape(L)+r'\n(.*?)\n.*?\t(\S+)\t(\S+)\t(\S+)\t\n(.*?)\n',t)
        if not m: bad.append(('missing',eid,L)); continue
        tot+=1
        exp=(am(r['best_decimal']), am(r['fair_decimal']), pc(r['ev']))
        got=m.group(2,3,4)
        g=m.group(5).strip()
        eg={'none':'no edge'}.get(r['grade'],r['grade'])
        if exp!=got or g!=eg: bad.append((eid,L,'exp',exp,eg,'got',got,g,r['best_decimal'],r['fair_decimal'],r['ev']))
print('compared',tot); 
for b in bad: print(b)
