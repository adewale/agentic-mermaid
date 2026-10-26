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
 plain_lines=[re.sub(r'\s*[│┃|]\s*$','',re.sub(r'^\s*[│┃|]\s?','',line))for line in re.sub(r'\x1b\[[0-9;]*m','',sink).splitlines()]
 plain=' '.join(line for line in plain_lines if not re.fullmatch(r'[\s┌┐└┘├┤┬┴┼─━┏┓┗┛╭╮╰╯+|=-]*',line))
 compact=lambda value:re.sub(r'\s+','',value).lower()
 bare='\n'not in w['source'].strip()and len(w['source'].strip().split())<=2 and not re.search(r'[;:\[\]{}<>|]',w['source'])
 if not bare and compact(w['source']) and compact(w['source']) in compact(plain):raise ValueError('Visible terminal output echoes source instead of diagram ink')
 missing=[label for label in w['expected']if not re.search(r'(?<!\w)'+re.escape(re.sub(r'\s+',' ',label).strip())+r'(?!\w)',re.sub(r'\s+',' ',sink))]
 if missing:raise ValueError('Missing declared labels: '+', '.join(missing[:8]))
for w in job['workloads']:
 r=dict(type='result',workload=w['id'])
 try:
  t=time.perf_counter();sink=termaid.render(w['source']);first=(time.perf_counter()-t)*1000;r['firstMs']=first
  qualify(sink,w)
  if job.get('coverageOnly'):
   r.update(status='ok',firstMs=first,outputBytes=len(sink.encode()),coverageOnly=True)
   out.write(json.dumps(r)+'\n');out.flush();continue
  t=time.perf_counter();n=0
  while n<job['timing']['warmCalls']or(time.perf_counter()-t)*1000<job['timing']['warmupMs']:sink=termaid.render(w['source']);n+=1
  per=(time.perf_counter()-t)*1000/n;iterations=max(1,min(1024,__import__('math').ceil(job['timing']['minSampleMs']/max(.001,per))));samples=[]
  for _ in range(job['timing']['samples']):
   t=time.perf_counter()
   for i in range(iterations):sink=termaid.render(w['source'])
   samples.append((time.perf_counter()-t)*1000/iterations)
  qualify(sink,w)
  r.update(status='ok',firstMs=first,samplesMs=samples,medianMs=statistics.median(samples),outputBytes=len(sink.encode()))
 except Exception as e:r.update(status='error',rejected=not isinstance(e,ValueError),detail=str(e))
 out.write(json.dumps(r)+'\n');out.flush()
out.write(json.dumps(dict(type='end',maxRssKiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss))+'\n')
