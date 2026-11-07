from pathlib import Path
import subprocess,json,hashlib
p=Path(__file__).resolve().parent
rows=[]
for name,paths in json.loads((p/'selected-source-jobs.json').read_text()).items():
 repo=p/'partial-sources'/name
 sha=subprocess.check_output(['git','rev-parse','FETCH_HEAD'],cwd=repo,text=True).strip()
 files=set((repo/'FILES.txt').read_text().splitlines())
 for path in paths:
  row={'repository':name,'revision':sha,'path':path}
  if path not in files:
   row['status']='absent';rows.append(row);continue
  try:
   result=subprocess.run(['git','show',sha+':'+path],cwd=repo,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90,check=True)
   dest=p/'sources'/name/path;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(result.stdout)
   row.update(status='recovered',bytes=len(result.stdout),sha256=hashlib.sha256(result.stdout).hexdigest())
  except Exception as e:row.update(status='failed',failure=str(e))
  rows.append(row)
 (p/'SELECTED-SOURCE-RECEIPTS.json').write_text(json.dumps(rows,indent=2)+'\n')
 print(name,sum(r['status']=='recovered' for r in rows if r['repository']==name),'files recovered',flush=True)
