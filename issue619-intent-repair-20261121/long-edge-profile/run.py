import pathlib,json,subprocess,datetime,sys
p=pathlib.Path(__file__).parent; state=pathlib.Path('/workspace/elk-layered-tools/optimization-20261116/run-state.json'); root=pathlib.Path('/workspace/elk-layered-port'); outcomes=[]
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
d=json.loads(state.read_text());assert d.get('timingWindow') is None;assert d['lease']['owner']=='/root'
assert json.loads((p.parent/'benchmark/results-6d8d7fbc/identity.json').read_text())['timingStatus']=='COMPLETED'
d['timingWindow']={'owner':'/root','start':now(),'scope':'Separate long-edge unchanged shipped kernel timing, followed serially by instrumented CPU/allocation diagnosis. No render performance cross-arm claim.'};state.write_text(json.dumps(d,indent=2)+'\n')
try:
 for mode in ['timing','profile']:
  for span in [2,8,24]:
   with (p/f'{mode}-span{span}.log').open('w') as out:r=subprocess.run(['node',str(p/'worker.mjs'),mode,str(span)],cwd=root,stdout=out,stderr=subprocess.STDOUT)
   outcomes.append({'mode':mode,'span':span,'exit':r.returncode,'at':now()});(p/'run-exits.json').write_text(json.dumps(outcomes,indent=2));print(outcomes[-1],flush=True)
   if r.returncode:sys.exit(r.returncode)
finally:
 d=json.loads(state.read_text());window=d['timingWindow'];d['timingWindow']=None;d.setdefault('completedTimingWindows',[]).append({**window,'end':now(),'artifacts':str(p)});state.write_text(json.dumps(d,indent=2)+'\n')
