import os,json,pathlib,datetime,subprocess
p=pathlib.Path(__file__).parent;state=pathlib.Path('/workspace/elk-layered-tools/optimization-20261116/run-state.json');now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();s=json.loads(state.read_text());assert s['lease']['owner']=='/root' and s.get('timingWindow') is None;s['timingWindow']={'owner':'/root','start':now(),'scope':'Only the two corrected Event source edits, serial identical fully consumed protocol; original 192 invalid-edit refusals retained.'};state.write_text(json.dumps(s,indent=2));e=os.environ.copy();e['PATH']='/workspace/pr449-runtime-recovery/node-v24.19.0-linux-x64/bin:'+e.get('PATH','');d=p/'consumed-event-recovery'
try:
 with (d/'collection.log').open('x') as f:r=subprocess.run(['node',str(d/'run-three.cjs'),str(d/'arms.json'),str(d/'run')],env=e,stdout=f,stderr=subprocess.STDOUT)
finally:
 s=json.loads(state.read_text());w=s['timingWindow'];s['timingWindow']=None;s.setdefault('completedTimingWindows',[]).append({**w,'end':now(),'exitCode':r.returncode,'artifacts':str(d)});state.write_text(json.dumps(s,indent=2))
raise SystemExit(r.returncode)
