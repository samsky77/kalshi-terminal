import json,collections,datetime as dt
d=json.load(open('/home/user/kalshi-terminal/sigmaline/app/.data/demo-db.json'))
ev={e['id']:e for e in d['events']}
mp=d['market_prices']
def P(s): return dt.datetime.fromisoformat(s.replace('Z','+00:00')) if s else None
for r in mp:
    if r['grade']!='none':
        e=ev[r['event_id']]
        print(e['sport_id'],r['event_id'],r['selection_key'],r['grade'],'ev',r['ev'],'m',r['model_ev'],'c',r['consensus_ev'],'books',r['books'],r['best_book'],r['best_decimal'],'fair',r['fair_decimal'],'price_ts',r['price_ts'],'commence',e['commence_time'],e['status'])
# expected grade
def g(r):
    x=r['ev']
    if x is None: return 'none'
    if r['books']<3 or x>0.10: return 'none'
    if x>=0.05 and r['model_ev']>0 and r['consensus_ev']>0: return 'A'
    if 0.02<=x<0.05: return 'B'
    return 'none'
mm=[(r['event_id'],r['selection_key'],r['grade'],g(r),r['ev'],r['books']) for r in mp if g(r)!=r['grade']]
print('mismatch',len(mm))
for x in mm[:40]: print(x)
