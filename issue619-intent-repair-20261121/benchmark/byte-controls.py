# Adapted retained benchmark-final/byte-controls.py; postmeasurement only.
from pathlib import Path
import sys,json,gzip,hashlib,collections,re
p=Path(sys.argv[1]); raw=[json.loads(x) for x in (p/'results.jsonl').read_text().splitlines()]
groups=collections.defaultdict(dict)
for row in raw:groups[(row['id'],row['cache'],row['replica'])][row['arm']]=row
sha=lambda b:hashlib.sha256(b).hexdigest(); rows=[];failures=[];determinism=[]
def receipt_diffs(before,after,path=''):
 if isinstance(before,dict) and isinstance(after,dict):
  result=[]
  for key in sorted(set(before)|set(after)):
   at=path+'/'+key
   if key not in before:result.append({'path':at,'beforeMissing':True,'after':after[key]})
   elif key not in after:result.append({'path':at,'before':before[key],'afterMissing':True})
   else:result.extend(receipt_diffs(before[key],after[key],at))
  return result
 if before!=after:return [{'path':path,'before':before,'after':after}]
 return []
operational={'/layoutOptimization/primaryProducerCalls','/layoutOptimization/additionalProducerCalls','/layoutOptimization/alternativesAttempted','/layoutOptimization/selected'}

for key,arms in groups.items():
 id,cache,replica=key
 for phase in ['cold-render']+[f'repeat{i}' for i in range(1,8)]+[f'edit{i}' for i in range(1,5)]:
  products=[]
  for arm in ['ts-control','ts-final']:
   stem=f'cache{cache}-{arm}-{re.sub("[^a-zA-Z0-9_.-]","_",id)}-{replica}';folder=p/stem;name='warmup' if phase=='cold-render' else phase
   try:svg=gzip.decompress((folder/(name+'.svg.gz')).read_bytes());receipt=gzip.decompress((folder/(name+'.receipt.json.gz')).read_bytes());products.append((svg,receipt))
   except Exception as error:failures.append({'case':id,'cache':cache,'replica':replica,'phase':phase,'arm':arm,'error':str(error)});products.append(None)
  if None in products:continue
  a,b=products;eqsvg=a[0]==b[0];eqreceipt=a[1]==b[1];default=id.endswith('-default')
  rows.append({'case':id,'cache':cache,'replica':replica,'phase':phase,'sameSvg':eqsvg,'sameEntireReceipt':eqreceipt,'defaultSvgRequiredExact':default,'defaultSvgViolation':default and not eqsvg,'entireReceiptDifferences':receipt_diffs(json.loads(a[1]),json.loads(b[1])),'paintStatuses':[json.loads(x[1]).get('layoutCertification',{}).get('status','missing') for x in products],'svgSha256':[sha(x[0]) for x in products],'receiptSha256':[sha(x[1]) for x in products]})
 for arm in ['ts-control','ts-final']:
  folder=p/f'cache{cache}-{arm}-{re.sub("[^a-zA-Z0-9_.-]","_",id)}-{replica}'
  for kind,names,reference in [('warm',[f'repeat{i}' for i in range(1,8)],'warmup'),('edit-repeat',[f'edit{i}' for i in range(2,5)],'edit1')]:
   for name in names:
    try:
     actual={ext:gzip.decompress((folder/f'{name}.{ext}.gz').read_bytes()) for ext in ['svg','receipt.json']}
     prior={ext:gzip.decompress((folder/f'{reference}.{ext}.gz').read_bytes()) for ext in ['svg','receipt.json']}
     exact={ext:actual[ext]==prior[ext] for ext in actual}
     previous=json.loads(prior['receipt.json']);current=json.loads(actual['receipt.json'])
     diffs=receipt_diffs(previous,current)
     # Exact byte flags above are never normalized. Classify only the known
     # per-execution accounting paths documented by the shared source owner.
     consistent=bool(diffs) and cache==1 and exact['svg'] and all(d['path'] in operational for d in diffs)
     if consistent:
      budget=current.get('layoutOptimization',{})
      consistent=budget.get('primaryProducerCalls')==0 and budget.get('additionalProducerCalls')==0 and budget.get('alternativesAttempted')==0 and budget.get('selected')==[]
     determinism.append({'case':id,'cache':cache,'replica':replica,'arm':arm,'phase':name,'reference':reference,**exact,'entireReceiptDifferences':diffs,'onlyDocumentedCachedExecutionAccounting':consistent})
    except Exception as error:failures.append({'case':id,'cache':cache,'replica':replica,'phase':name,'arm':arm,'check':'determinism','error':str(error)})
result={'control':'32b025bff14e3020fd709a08d84f8543f57cb0cd','candidate':'6d8d7fbc835b2767b83a3bbdfca5e7b7d9f8e19b','expectedPairedProducts':648,'pairedProducts':len(rows),'defaultSvgViolations':sum(x['defaultSvgViolation'] for x in rows),'failures':failures,'exactReceiptDifferenceCount':sum(not x['receipt.json'] for x in determinism),'documentedCachedExecutionAccountingDifferences':sum(x['onlyDocumentedCachedExecutionAccounting'] for x in determinism),'otherReceiptDifferenceCount':sum(not x['receipt.json'] and not x['onlyDocumentedCachedExecutionAccounting'] for x in determinism),'determinismFailures':[x for x in determinism if not x['svg'] or not x['receipt.json'] and not x['onlyDocumentedCachedExecutionAccounting']],'rows':rows,'determinism':determinism}
(p/'byte-controls.json').write_text(json.dumps(result,indent=2)+'\n')
print({k:v for k,v in result.items() if k not in ['rows','determinism']})
