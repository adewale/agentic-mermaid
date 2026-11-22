import json,subprocess,os,datetime,pathlib,sys,hashlib
p=pathlib.Path(__file__).parent;h=p/'harness';state=pathlib.Path('/workspace/elk-layered-tools/optimization-20261116/run-state.json');env=os.environ.copy();env.update(PATH='/workspace/pr449-runtime-recovery/node-v24.19.0-linux-x64/bin:/workspace/elk-layered-tools/bun-1.4.4/package/bin:/workspace/elk-layered-tools/trident-040-python/bin:'+env.get('PATH',''),MERMAID_REFERENCE_DIR='/workspace/elk-layered-tools/trident-040-reference',MERMAID_UPSTREAM_DIR='/workspace/elk-layered-tools/trident-040-mermaid',TRIDENT_CHROMIUM_EXECUTABLE='/usr/bin/chromium',TMPDIR='/tmp/issue621-trident-work')
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();arms=json.loads((p/'arms.json').read_text());peerids=['dfadler/zombie-mermaid','lukilabs/beautiful-mermaid','obsidianmd/pele','mermaid-js/mermaid','Dicklesworthstone/frankenmermaid'];entries=[{'id':a['id'],'catalog':p/a['id']/'catalog.json','prepared':p/a['id']/'prepared','projects':['adewale/agentic-mermaid']} for a in arms]+[{'id':'peers','catalog':p/'versions-current/catalog.json','prepared':p/'peers/prepared','projects':peerids}];records=[]
for e in entries:assert (e['prepared']/'community-browser-prepared.json').is_file()
assert not (p/'collection-status.json').exists();s=json.loads(state.read_text());assert s.get('timingWindow') is None and s['lease']['owner']=='/root';s['timingWindow']={'owner':'/root','start':now(),'scope':'Full Trident0.4 public canonical Drawing/DaveBench/Fidelity for all selected peers and six exact AM artifact/mode arms; serial only; no analysis/browser/build/otherprofiler. Current versus main and historical controls preserved.'};state.write_text(json.dumps(s,indent=2)+'\n')
def run(e,suite):
 d=p/e['id'];args=['bun','commands.ts',suite,'--catalog',str(e['catalog']),'--projects',','.join(e['projects'])];folder={'drawing:correctness':'drawing','davebench':'dave-images','davebench:terminal':'dave-terminal','mermaid:fidelity':'fidelity'}[suite];target=d/folder;assert not target.exists(),target
 if suite in ['drawing:correctness','davebench']:args+=['--prepared',str(e['prepared']/'community-browser-prepared.json')]
 else:args+=['--prepared',str(e['prepared']/'community-prepared.json')]
 if suite=='drawing:correctness':args+=['--terminal-prepared',str(e['prepared']/'community-prepared.json')]
 if suite in ['davebench','davebench:terminal','mermaid:fidelity']:args+=['--upstream',env['MERMAID_UPSTREAM_DIR']]
 if suite=='mermaid:fidelity':
  args+=['--reference',env['MERMAID_REFERENCE_DIR'],'--runtime','/workspace/elk-layered-tools/trident-040-fidelity-runtime']
  if e['id']!='current-default':args+=['--reuse-reference',str(p/'current-default/fidelity')]
 args+=['--out',str(target)];log=d/(suite.replace(':','-')+'.log');rec={'arm':e['id'],'suite':suite,'startedAt':now(),'command':args,'status':'running','log':str(log)};records.append(rec);(p/'collection-status.json').write_text(json.dumps(records,indent=2));print('START',e['id'],suite,flush=True)
 with log.open('x') as f:r=subprocess.run(args,cwd=h,env=env,stdout=f,stderr=subprocess.STDOUT)
 rec.update(exitCode=r.returncode,status='complete' if r.returncode==0 else 'failed',finishedAt=now());(p/'collection-status.json').write_text(json.dumps(records,indent=2));print('END',e['id'],suite,r.returncode,flush=True)
 if r.returncode:raise SystemExit('Canonical collector failed; retain and repair '+str(log))
try:
 for suite in ['drawing:correctness','davebench','davebench:terminal','mermaid:fidelity']:
  for e in entries:
   if suite in ['davebench:terminal','mermaid:fidelity'] and e['id'].endswith(('-balanced','-native')):
    # Same fresh parser/terminal entry, same sealed package. These observations
    # cannot be claimed as separate layout-backend wins.
    (p/e['id']/(suite.replace(':','-')+'-alias.json')).write_text(json.dumps({'freshRun':e['id'].rsplit('-',1)[0]+'-default','suite':suite,'reason':'Identical artifact parser and terminal public entry; SVG-only backend/mode option does not enter these calls. Not a historical reuse or independent solver win.'},indent=2));continue
   run(e,suite)
finally:
 s=json.loads(state.read_text());window=s.get('timingWindow');s['timingWindow']=None;s.setdefault('completedTimingWindows',[]).append({**(window or {}),'end':now(),'status':'all recorded commands complete' if all(r['status']=='complete' for r in records) else 'failed command retained','artifacts':str(p)});state.write_text(json.dumps(s,indent=2)+'\n')
print('ALL FULL CANONICAL SUITES COMPLETE',flush=True)
