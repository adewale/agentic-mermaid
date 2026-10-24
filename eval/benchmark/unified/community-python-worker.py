"""A Python public-API worker. This is not a CLI startup measurement."""
import json,sys,time,statistics,re,resource
job=json.load(open(sys.argv[1]));out=open(sys.argv[2],'w');started=time.perf_counter()
import termaid
out.write(json.dumps(dict(type='import',ms=(time.perf_counter()-started)*1000))+'\n');out.flush()
def qualify(sink,w):
 if not isinstance(sink,str)or not sink.strip():raise ValueError('Empty terminal artifact')
 try:
  value=json.loads(sink)
  if isinstance(value,(dict,list)):raise ValueError('JSON sidecars are not terminal ink')
 except json.JSONDecodeError:pass
 missing=[label for label in w['expected']if label not in re.sub(r'\s+',' ',sink)]
 if missing:raise ValueError('Missing declared labels: '+', '.join(missing[:8]))
for w in job['workloads']:
 r=dict(type='result',workload=w['id'])
 try:
  t=time.perf_counter();sink=termaid.render(w['source']);first=(time.perf_counter()-t)*1000;r['firstMs']=first
  qualify(sink,w)
  t=time.perf_counter();n=0
  while n<job['timing']['warmCalls']or(time.perf_counter()-t)*1000<job['timing']['warmupMs']:sink=termaid.render(w['source']);n+=1
  per=(time.perf_counter()-t)*1000/n;iterations=max(1,min(1024,__import__('math').ceil(job['timing']['minSampleMs']/max(.001,per))));samples=[]
  for _ in range(job['timing']['samples']):
   t=time.perf_counter()
   for i in range(iterations):sink=termaid.render(w['source'])
   samples.append((time.perf_counter()-t)*1000/iterations)
  qualify(sink,w)
  r.update(status='ok',firstMs=first,samplesMs=samples,medianMs=statistics.median(samples),outputBytes=len(sink.encode()))
 except Exception as e:r.update(status='unsupported'if not isinstance(e,ValueError) and re.search(r'unsupported|unknown.*diagram|invalid.*header',str(e),re.I)else'error',detail=str(e))
 out.write(json.dumps(r)+'\n');out.flush()
out.write(json.dumps(dict(type='end',maxRssKiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss))+'\n')
