import json,collections
BET={'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers', 'espnbet', 'fanatics', 'hardrockbet', 'ballybet', 'betparx', 'fliff'}
d=json.load(open('/home/user/kalshi-terminal/sigmaline/app/.data/demo-db.json'))
def power(dec):
    q=[1/x for x in dec]
    if any(x>=1 for x in q): return None
    f=lambda k: sum(x**k for x in q)-1
    lo,hi=0.5,5
    if f(lo)<0: lo=0.01
    for _ in range(200):
        m=(lo+hi)/2
        if f(m)>0: lo=m
        else: hi=m
    k=(lo+hi)/2; p=[x**k for x in q]; s=sum(p); return [x/s for x in p]
def wmed(vals):
    xs=sorted(vals); tot=sum(w for v,w in xs); acc=0
    for i,(v,w) in enumerate(xs):
        acc+=w
        if acc>tot/2+1e-12: return v
        if abs(acc-tot/2)<=1e-12: return (v+xs[i+1][0])/2
    return xs[-1][0]
ev={e['id']:e for e in d['events']}
snaps=collections.defaultdict(list)
for s in d['odds_snapshots']: snaps[s['event_id']].append(s)
def sides(m,three): 
    if m=='ml': return ['home','away','draw'] if three else ['home','away']
    if m=='spread': return ['home','away']
    return ['over','under']
res=[]
for r in d['market_prices']:
    e=r['event_id']; m=r['market']; sel=r['selection']; side=sel['side']
    line=sel.get('line')
    gl = (line if side=='home' else -line) if m=='spread' else line
    # use snapshots at or before r['price_ts']? use those with pulled_at <= updated_at
    grp=[s for s in snaps[e] if s['market']==m and (s['line']==gl if m!='ml' else True)]
    # latest per book among those with pulled_at <= r updated_at? try snapshot_ts match
    lat={}
    for s in grp:
        pass
        p=lat.get(s['book'])
        if not p or p['ts']<s['ts'] or (p['ts']==s['ts'] and p['id']<s['id']): lat[s['book']]=s
    sd=sides(m, 'draw' in (grp[0]['prices'] if grp else {}))
    full=[s for s in lat.values() if all((s['prices'].get(x) or 0)>1 for x in sd)]
    rows=[(s['book'],power([s['prices'][x] for x in sd])) for s in full]
    rows=[x for x in rows if x[1]]
    if not rows: res.append((r,None,0,None)); continue
    i=sd.index(side)
    med=[wmed([(p[j],2 if b=='pinnacle' else 1) for b,p in rows]) for j in range(len(sd))]
    cp=med[i]/sum(med)
    best=max([s['prices'].get(side) or 0 for s in lat.values() if s['book'] in BET]+[0])
    res.append((r,cp,len(rows),best))
bad=[x for x in res if x[1] is None or abs(x[1]-(x[0]['consensus_p'] or -1))>2e-6 or x[2]!=x[0]['books']]
print(len(res),'mismatch',len(bad))
for r,cp,n,b in bad[:25]:
    print(r['event_id'],r['selection_key'],'stored',r['consensus_p'],r['books'],r['best_decimal'],'mine',cp,n,b)
bb=[x for x in res if x[3] is not None and abs(x[3]-x[0]['best_decimal'])>1e-9]
print('best mismatch',len(bb))
for r,cp,n,b in bb[:20]: print(r['event_id'],r['selection_key'],r['best_book'],r['best_decimal'],'max any book',b)
