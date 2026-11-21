from pathlib import Path
import json,statistics,collections
p=Path(__file__).parent
rows=[json.loads(line) for line in (p/'results/results.jsonl').read_text().splitlines()]
groups=collections.defaultdict(list);proof=collections.Counter();per_arm=collections.defaultdict(collections.Counter);errors=[]
for x in rows:
 groups[(x['id'],x['cache'],x['arm'])].append(x)
 for r in x['data'].get('rows',[]):
  status=r.get('proof',{}).get('status','missing');proof[status]+=1;per_arm[x['arm']][status]+=1
  if r['status']!='returned':errors.append({'id':x['id'],'arm':x['arm'],'cache':x['cache'],'failure':r.get('failure')})
summary=[]
for (id,cache,arm),data in groups.items():
 measures=[]
 for x in data:
  d=x['data'];rs=d['rows'];warm=[r for r in rs if r['phase'].startswith('repeat')];edits=[r for r in rs if r['phase'].startswith('edit')]
  avg=lambda rows,key:statistics.mean(r[key] for r in rows)
  memory=lambda rows,key:statistics.mean(r['after'][key] for r in rows)/1048576
  measures.append({'importMs':d['importMs'],'coldMs':rs[0]['wallMs'],'warmMs':avg(warm,'wallMs'),'firstEditMs':edits[0]['wallMs'],'editedWarmMs':avg(edits[1:],'wallMs'),'warmRssMiB':memory(warm,'rss'),'warmHeapMiB':memory(warm,'heapUsed'),'warmHeapTotalMiB':memory(warm,'heapTotal'),'peakRssMiB':max(r['peakRssKiB'] for r in rs)/1024,'coldRssMiB':rs[0]['after']['rss']/1048576,'firstEditRssMiB':edits[0]['after']['rss']/1048576})
 summary.append({'id':id,'cache':cache,'arm':arm,'processes':len(data),**{key:statistics.median(m[key] for m in measures) for key in measures[0]}})
result={'base':'f49196e7f5d6d2f0970a4a76fe62644ee5e9d004','processes':len(rows),'proofCounts':dict(proof),'proofByArm':{k:dict(v) for k,v in per_arm.items()},'errors':errors,'method':'Three balanced fresh processes per arm/case/cache. Median per-process means for seven warm repeats and three repeats of one edited source; first edit, cold and import separate. Entire SVG and receipt serialized within each clock. Compression, GC and evidence writes outside clocks. RSS/heap include harness, retained products and prior compression. Exploratory, not formal calibration or full Trident scores.','summary':summary}
(p/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
print('Processes',len(rows),'proofs',dict(proof),'byArm',result['proofByArm'],'errors',len(errors))
for id in dict.fromkeys(r['id'] for r in rows):
 v={r['arm']:r for r in summary if r['id']==id and r['cache']==0};print(id,[(k,round(r['warmMs'],2),round(r['warmRssMiB'],2),round(r['warmHeapMiB'],2)) for k,r in v.items()])
