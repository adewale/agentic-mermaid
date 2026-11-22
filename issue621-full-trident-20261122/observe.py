import json,subprocess,os,pathlib,datetime
p=pathlib.Path(__file__).parent;h=p/'harness';env=os.environ.copy();env.update(PATH='/workspace/pr449-runtime-recovery/node-v24.19.0-linux-x64/bin:/workspace/elk-layered-tools/bun-1.4.4/package/bin:/workspace/elk-layered-tools/trident-040-python/bin:'+env.get('PATH',''),MERMAID_REFERENCE_DIR='/workspace/elk-layered-tools/trident-040-reference',MERMAID_UPSTREAM_DIR='/workspace/elk-layered-tools/trident-040-mermaid',TRIDENT_CHROMIUM_EXECUTABLE='/usr/bin/chromium',TMPDIR='/tmp/issue621-trident-work')
records=[]
for arm in [r['id'] for r in json.loads((p/'arms.json').read_text())]+['peers']:
 for suite in ['layout:observe','drawing:structure']:
  out=p/arm/suite.replace(':','-');assert not out.exists();cmd=['bun','commands.ts',suite,'--run',str(p/arm/'drawing'),'--out',str(out)];log=p/arm/(suite.replace(':','-')+'.log');print('START',arm,suite,flush=True)
  with log.open('x') as f:r=subprocess.run(cmd,cwd=h,env=env,stdout=f,stderr=subprocess.STDOUT)
  records.append({'arm':arm,'suite':suite,'exitCode':r.returncode,'command':cmd,'log':str(log)});(p/'observers-status.json').write_text(json.dumps(records,indent=2));print('END',arm,suite,r.returncode,flush=True)
  assert r.returncode==0
