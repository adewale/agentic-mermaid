from pathlib import Path
import json,statistics,collections
import sys
p=Path(sys.argv[1])
rows=[json.loads(line) for line in (p/'results.jsonl').read_text().splitlines()]
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
  d=x['data'];
  if not d.get('rows'): continue
  rs=d['rows'];warm=[r for r in rs if r['phase'].startswith('repeat')];edits=[r for r in rs if r['phase'].startswith('edit')]
  avg=lambda rows,key:statistics.mean(r[key] for r in rows)
  memory=lambda rows,key:statistics.mean(r['after'][key] for r in rows)/1048576
  measures.append({'importMs':d['importMs'],'coldMs':rs[0]['wallMs'],'warmMs':avg(warm,'wallMs'),'firstEditMs':edits[0]['wallMs'],'editedWarmMs':avg(edits[1:],'wallMs'),'warmRssMiB':memory(warm,'rss'),'warmHeapMiB':memory(warm,'heapUsed'),'warmHeapTotalMiB':memory(warm,'heapTotal'),'peakRssMiB':max(r['peakRssKiB'] for r in rs)/1024,'coldRssMiB':rs[0]['after']['rss']/1048576,'firstEditRssMiB':edits[0]['after']['rss']/1048576})
 if not measures: continue
 summary.append({'id':id,'cache':cache,'arm':arm,'processes':len(data),**{key:statistics.median(m[key] for m in measures) for key in measures[0]}})
result={'base':'32b025bff14e3020fd709a08d84f8543f57cb0cd','candidate':'6d8d7fbc835b2767b83a3bbdfca5e7b7d9f8e19b','processes':len(rows),'proofCounts':dict(proof),'proofByArm':{k:dict(v) for k,v in per_arm.items()},'errors':errors,'lifecycleErrors':[x for x in rows if not x['data'].get('rows')],'method':'Three balanced fresh processes per arm/case/cache. Median per-process means for seven warm repeats and three repeats of one edited source; first edit, cold and import separate. Entire SVG and receipt serialized within each clock. Compression, GC and evidence writes outside clocks. RSS/heap include harness, retained products and prior compression. Exploratory, not formal calibration or full Trident scores.','summary':summary}
result['paired']=[]
for id in dict.fromkeys(r['id'] for r in rows):
 for cache in [0,1]:
  per_replica={}
  for x in rows:
   if x['id']!=id or x['cache']!=cache or not x['data'].get('rows'): continue
   d=x['data']; rs=d['rows']; warm=[r for r in rs if r['phase'].startswith('repeat')]; edits=[r for r in rs if r['phase'].startswith('edit')]
   if any(r['status']!='returned' for r in rs): continue
   m={'importMs':d['importMs'],'coldMs':rs[0]['wallMs'],'warmMs':statistics.mean(r['wallMs'] for r in warm),'firstEditMs':edits[0]['wallMs'],'editedWarmMs':statistics.mean(r['wallMs'] for r in edits[1:]),'warmRssMiB':statistics.mean(r['after']['rss'] for r in warm)/1048576,'warmHeapMiB':statistics.mean(r['after']['heapUsed'] for r in warm)/1048576,'peakRssMiB':max(r['peakRssKiB'] for r in rs)/1024}
   per_replica.setdefault(x['replica'],{})[x['arm']]=m
  pairs=[(v['ts-control'],v['ts-final']) for v in per_replica.values() if set(v)=={'ts-control','ts-final'}]
  result['paired'].append({'id':id,'cache':cache,'completePairs':len(pairs),'expectedPairs':3,'metrics':{k:{'controlMedian':statistics.median(a[k] for a,b in pairs),'candidateMedian':statistics.median(b[k] for a,b in pairs),'medianPairedDelta':statistics.median(b[k]-a[k] for a,b in pairs),'medianPairedRatio':statistics.median(b[k]/a[k] for a,b in pairs) if all(a[k] for a,b in pairs) else None} for k in pairs[0][0]} if pairs else {}})
(p/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
print('Processes',len(rows),'proofs',dict(proof),'byArm',result['proofByArm'],'errors',len(errors))
for id in dict.fromkeys(r['id'] for r in rows):
 v={r['arm']:r for r in summary if r['id']==id and r['cache']==0};print(id,[(k,round(r['warmMs'],2),round(r['warmRssMiB'],2),round(r['warmHeapMiB'],2)) for k,r in v.items()])
