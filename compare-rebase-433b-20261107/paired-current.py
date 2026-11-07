import pathlib,zipfile,json,collections,statistics,hashlib
r=pathlib.Path(__file__).parent;z=zipfile.ZipFile(r/'generated-layouts-433b.zip');head='433b523b86f9017960d8004f3c776d9d8d82dbce';samples={k:[] for k in ['agentic','elk']};cohorts=[]
for n in sorted(x for x in z.namelist() if x.endswith('/agentic.json') or x=='agentic.json'):
 a=json.loads(z.read(n));b=json.loads(z.read(n.replace('agentic.json','elk.json')));assert a['rev']==b['rev']==head and not a['dirty'] and not b['dirty'];assert len(a['samples'])==len(b['samples']);assert {k:v for k,v in a['renderOptions'].items() if k!='graphLayout'}=={k:v for k,v in b['renderOptions'].items() if k!='graphLayout'}
 for x,y in zip(a['samples'],b['samples']):assert all(x[k]==y[k] for k in ['id','family','source'])
 samples['agentic']+=a['samples'];samples['elk']+=b['samples'];cohorts.append({'path':n,'count':len(a['samples'])})
created_at=json.loads(z.read('agentic.json'))['createdAt']
for arm,rows in samples.items():
 assert len(rows)==len({s['id'] for s in rows})
 (r/(arm+'.json')).write_text(json.dumps({'label':arm+' at433b','rev':head,'createdAt':created_at,'dirty':False,'renderOptions':{'graphLayout':{'backend':arm,'fallback':'none'}},'samples':rows}))
proof=lambda s:s.get('svgReceipt',{}).get('layoutCertification',{}).get('status','unavailable' if s.get('svg') else 'not-delivered')
family={};rows=[];pairs=collections.Counter();proofpairs=collections.Counter();vectors=collections.defaultdict(lambda:collections.Counter());pct=collections.defaultdict(list)
for a,b in zip(samples['agentic'],samples['elk']):
 assert a['id']==b['id'];f=a['family'];g=family.setdefault(f,{'samples':0,'agentic':collections.Counter(),'elk':collections.Counter(),'delivery':collections.Counter()});g['samples']+=1
 delivery='both' if a.get('svg') and b.get('svg') else 'agentic-only' if a.get('svg') else 'elk-only' if b.get('svg') else 'neither';pairs[delivery]+=1;g['delivery'][delivery]+=1;proofpairs[proof(a)+'/'+proof(b)]+=1
 row={'id':a['id'],'family':f,'delivery':delivery,'proof':{'agentic':proof(a),'elk':proof(b)},'svgExact':a.get('svg')==b.get('svg'),'metrics':{},'outcomes':{}}
 for arm,s in [('agentic',a),('elk',b)]:
  g[arm]['svgDelivered' if s.get('svg') else 'svgNotDelivered']+=1;g[arm]['layoutDelivered' if s.get('layout') else 'layoutNotDelivered']+=1;g[arm]['proof:'+proof(s)]+=1
  row['outcomes'][arm]={'ok':s['ok'],'failures':s.get('failures'),'errorCode':s.get('errorCode'),'error':s.get('error'),'decisions':s.get('svgReceipt',{}).get('layoutDecisions'),'svgSHA256':hashlib.sha256(s.get('svg','').encode()).hexdigest()}
  row['metrics'][arm]=s.get('metrics')
 if delivery=='both':
  for key in ['area','length','bends','edgeCrossings','labelConflicts','opposingOverlap','parallelOverlap']:
   def value(s):
    m=s.get('metrics',{})
    if key in ['area','length','bends']:return m.get('routeGeometry',{}).get(key)
    if key=='labelConflicts':return m.get('labelConflicts',{}).get('total')
    if key in ['opposingOverlap','parallelOverlap']:return m.get('routeOverlaps',{}).get('opposing' if key.startswith('opposing') else 'parallel')
    return m.get(key)
   x,y=value(a),value(b)
   if not isinstance(x,(int,float)) or not isinstance(y,(int,float)):vectors[key]['unknown']+=1;continue
   delta=x-y;vectors[key]['less' if delta<-.0000001 else 'more' if delta>.0000001 else 'equal']+=1
   if y:pct[key].append(100*(x/y-1))
 rows.append(row)
result={'head':head,'artifact':{'id':13577493020,'sha256':'c43ea8e9a9ba7f98082e538d8dfc45a5e1d16aac5f9e42327f323ab64dbac957'},'cohorts':cohorts,'samplesPerBackend':len(rows),'deliveryPairs':dict(pairs),'finalSvgProofPairs':dict(proofpairs),'qualityVectorsNativeVsElk':{k:dict(v) for k,v in vectors.items()},'medianPercentDelta':{k:statistics.median(v) for k,v in pct.items()},'families':family,'samples':rows,'scope':'Same literal input and options except backend, fallback none. Final SVG delivery and final receipt proof separate from projected metrics. Quality vectors are not acceptance gates or authored-meaning/actual-ink proof. Family-specific solvers may ignore this layout selection; receipt decisions retained.'}
(r/'PAIRED-CURRENT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['samples','artifact','cohorts']},indent=2))
