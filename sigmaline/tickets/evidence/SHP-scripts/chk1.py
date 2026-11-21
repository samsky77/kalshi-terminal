import json,collections
d=json.load(open('/home/user/kalshi-terminal/sigmaline/app/.data/demo-db.json'))
ev={e['id']:e for e in d['events']}
mp=d['market_prices']
bad=[];cnt=collections.Counter()
for r in mp:
    f=r['fair_probs']; b=r['best_decimal']
    sp=ev[r['event_id']]['sport_id']
    cnt[sp]+=1
    if b is None or f is None or f.get('win') is None: continue
    e=f['win']*b+f['push']-1
    if r['ev'] is not None and abs(e-r['ev'])>5e-6: bad.append(('ev',r['event_id'],r['selection_key'],e,r['ev']))
    fd=(1-f['push'])/f['win'] if f['win'] else None
    if fd and r['fair_decimal'] and abs(fd-r['fair_decimal'])>5e-6: bad.append(('fd',r['event_id'],r['selection_key'],fd,r['fair_decimal']))
    s=f['win']+f['push']+f['loss']
    if abs(s-1)>1e-6: bad.append(('sum',r['event_id'],r['selection_key'],s))
print(cnt, len(mp)); print(len(bad)); 
for x in bad[:30]: print(x)
print(collections.Counter(r['grade'] for r in mp))
print(collections.Counter((r['fair_source'],r['market']) for r in mp))
