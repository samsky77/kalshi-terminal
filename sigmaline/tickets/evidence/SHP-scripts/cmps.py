import json,re
exec(open('cmpg.py').read().split('tot=0')[0])
n=0;bad=[]
for s in ['nba','cbb','nhl','nfl','cfb','tennis']:
    t=open(f's_{s}.txt').read(); j=json.load(open(f'slate_{s}.json'))
    for row in j['rows']:
        x=row.get('top') or row.get('main')
        if not x: continue
        i=t.find(x['label']+'\n')
        if i<0: bad.append(('nolabel',s,x['label'])); continue
        seg=t[i:i+200].split('\n')
        n+=1
        bestline=seg[1]; 
        rest=[l for l in seg[2:8] if l and not l.startswith('updated') and l!='LOGGED PICK']
        fair=rest[0]
        exp_b=am(x['best_decimal']); exp_f=am(x['fair_decimal'])
        if not bestline.startswith(exp_b) or fair!=exp_f: bad.append((s,x['label'],exp_b,exp_f,seg[1:6]))
        if x['grade']!='none':
            if rest[1]!=pc(x['ev']) or rest[2]!=x['grade']: bad.append((s,x['label'],'grade',rest[:3],pc(x['ev']),x['grade']))
print(n,bad[:20])
