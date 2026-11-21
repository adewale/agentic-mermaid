from pathlib import Path
import json,gzip,hashlib,collections
p=Path(__file__).parent; raw=[json.loads(x) for x in (p/'results/results.jsonl').read_text().splitlines()]; rows={}; groups=collections.defaultdict(dict)
for row in raw:groups[(row['id'],row['cache'],row['replica'])][row['arm']]=row
sha=lambda b:hashlib.sha256(b).hexdigest(); out=[]
for key,arms in groups.items():
 id,cache,replica=key
 for phase in ['cold-render']+[r['phase'] for r in arms['ts-control']['data']['rows'][1:]]:
  products=[]
  for arm in ['ts-control','ts-final']:
   import re
   stem=f'cache{cache}-{arm}-{re.sub("[^a-zA-Z0-9_.-]","_",id)}-{replica}'; folder=p/'results'/stem; name='warmup' if phase=='cold-render' else phase
   svg=gzip.decompress((folder/(name+'.svg.gz')).read_bytes());receipt=gzip.decompress((folder/(name+'.receipt.json.gz')).read_bytes());products.append((svg,receipt))
  a,b=products; exactSvg=a[0]==b[0];exactReceipt=a[1]==b[1];expectedDifference=id=='event-clear';assert expectedDifference or(exactSvg and exactReceipt),(key,phase);out.append({'case':id,'cache':cache,'replica':replica,'phase':phase,'sameSvg':exactSvg,'sameEntireReceipt':exactReceipt,'intentionalChangedEvent':expectedDifference,'svgSha256':[sha(a[0]),sha(b[0])],'receiptSha256':[sha(a[1]),sha(b[1])]})
result={'source':'c18f607364ca1d85dd91a669c8ac33a2c7173a23','pairedProducts':len(out),'exactGraphAndBlockedEvent':sum(x['sameSvg'] and x['sameEntireReceipt'] for x in out),'intentionalClearEvent':sum(x['intentionalChangedEvent'] for x in out),'rows':out};(p/'byte-controls.json').write_text(json.dumps(result,indent=2)+'\n');print({k:v for k,v in result.items() if k!='rows'})
