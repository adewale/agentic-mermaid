from pathlib import Path
import subprocess,json
p=Path('/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107');nodes=json.load(open(p/'SELECTED-CATALOG.json'))['nodes'];wanted=['lukilabs/beautiful-mermaid','wevm/ondine','1jehuang/mermaid-rs-renderer','Latias94/merman','Dicklesworthstone/frankenmermaid','crabtalk/bezel','dfadler/zombie-mermaid'];jobs=[{'id':n['id'],'revision':n['head']}for n in nodes if n['id']in wanted]+[{'id':'mermaid-js/mermaid','revision':'1fb7869866dd619168d840291c9c54b4f129758b'},{'id':'eclipse-elk/elk','revision':'v0.11.0'}];rows=[]
for job in jobs:
 dest=p/'partial-sources'/job['id'].replace('/','--');dest.mkdir(parents=True,exist_ok=True);log=p/(job['id'].replace('/','--')+'-partial-fetch.log')
 with open(log,'wb')as f:
  steps=[['git','init','-q'],['git','remote','add','origin','https://github.com/'+job['id']+'.git'],['git','config','remote.origin.promisor','true'],['git','config','remote.origin.partialclonefilter','blob:none'],['git','fetch','--filter=blob:none','--depth=1','origin',job['revision']]]
  try:
   for step in steps:
    x=subprocess.run(step,cwd=dest,stdout=f,stderr=subprocess.STDOUT,timeout=100)
    if x.returncode:raise RuntimeError('fetch exit'+str(x.returncode))
   sha=subprocess.check_output(['git','rev-parse','FETCH_HEAD'],cwd=dest,text=True).strip();files=subprocess.check_output(['git','ls-tree','-r','--name-only',sha],cwd=dest,text=True).splitlines();(dest/'FILES.txt').write_text('\n'.join(files)+'\n');row={**job,'head':sha,'gitRoot':str(dest),'files':len(files),'status':'tree-recovered'}
  except Exception as e:row={**job,'status':'tree-unavailable','failure':str(e)}
 rows.append(row);(p/'PARTIAL-SOURCES.json').write_text(json.dumps(rows,indent=2)+'\n');print(row,flush=True)
