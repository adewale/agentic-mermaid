from pathlib import Path
import json,subprocess
p=Path(__file__).parent;h=p/'harness';old=Path('/workspace/elk-layered-tools/optimization-20261116/fidelity');rows=[];left=json.loads((p/'historical-default/prepared/community-prepared.json').read_text())[0]['artifact']
for arm in ['current-default','main-default']:
 right=json.loads((p/arm/'prepared/community-prepared.json').read_text())[0]['artifact'];out=p/(arm+'-parser-qualification.json');cmd=['node',str(old/'qualify-public-api.mjs'),'--adapters',str(h),'--left',left['module'],'--right',right['module'],'--left-revision',left['revision'],'--right-revision',right['revision'],'--corpus',str(h/'corpus/community-corpus.json'),'--reference','/workspace/elk-layered-tools/trident-040-reference/node_modules/mermaid/dist/mermaid.core.mjs','--dom','/workspace/elk-layered-tools/trident-040-fidelity-runtime/node_modules/jsdom/lib/api.js','--out',str(out)]
 with (p/(arm+'-parser-qualification.log')).open('w') as f:r=subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT)
 rows.append({'arm':arm,'exit':r.returncode,'command':cmd});(p/'parser-qualification-status.json').write_text(json.dumps(rows,indent=2));print(rows[-1]['arm'],r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
