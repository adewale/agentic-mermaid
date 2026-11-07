import json,pathlib,subprocess,gzip
r=pathlib.Path(__file__).parent;old=r.parent/'current-execution-c9/affected-public-products';rows=[]
for case in ['nonlinear-forest','requirement-cycle-TB','Sparse256-default-gap','ER208-chain','er256-chain','raw-fan-circle']:
 for backend in ['agentic','elk']:
  job=json.load(open(old/case/backend/'job.json'));job.update(root='/tmp/pr449-main-integration-20261029-762',revision='433b523b86f9017960d8004f3c776d9d8d82dbce',expectedHead='433b523b86f9017960d8004f3c776d9d8d82dbce',bindingReference=None);out=r/'fresh-products'/case/backend;out.mkdir(parents=True,exist_ok=True);(out/'job.json').write_text(json.dumps(job,indent=2)+'\n')
  with open(out/'worker.log','w') as log:result=subprocess.run(['node',str(r.parent/'requirement-directions-62af/capture.mjs'),str(out),str(out/'job.json')],stdout=log,stderr=subprocess.STDOUT)
  d=json.load(gzip.open(out/'RESULT.json.gz','rt'));row={'case':case,'backend':backend,'status':d['status'],'exit':result.returncode,'proof':d.get('proof',{}).get('status'),'failure':d.get('failure'),'sizes':d.get('sizes'),'decisions':d.get('layoutDecisions')};rows.append(row);print(json.dumps({k:row[k] for k in ['case','backend','status','proof']}),flush=True)
(r/'FRESH-PRODUCTS.json').write_text(json.dumps(rows,indent=2)+'\n')
