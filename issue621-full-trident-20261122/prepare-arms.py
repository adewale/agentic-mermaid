from pathlib import Path
import json,subprocess,os,hashlib,datetime
p=Path(__file__).parent;arms=[];states=[]
for name,revision,archive,backend in [('current','6d8d7fbc835b2767b83a3bbdfca5e7b7d9f8e19b',p/'current-archive/agentic-mermaid-0.5.7.tgz','elk'),('main','f49196e7f5d6d2f0970a4a76fe62644ee5e9d004',p/'main-archive/agentic-mermaid-0.5.7.tgz','elk'),('historical','6f11d6d095c61f63c89bb558ba66b3bf519f2a9e',Path('/workspace/elk-layered-tools/native-retirement-20261116/main6f/release-artifact/package.tgz'),'elk')]:
 qualities=['default','balanced'] if name!='historical' else ['default','native']
 for quality in qualities:
  arm={'id':name+'-'+quality,'source':revision,'archive':str(archive),'backend':'agentic' if quality=='native' else backend,'quality':quality,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()};arms.append(arm)
(p/'arms.json').write_text(json.dumps(arms,indent=2))
for arm in arms:
 cmd=['bun',str(p/'prepare-arm.ts'),arm['id'],arm['backend'],arm['quality'],arm['source'],arm['archive']]
 with (p/('prepare-'+arm['id']+'.log')).open('w') as f:r=subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT)
 states.append({'id':arm['id'],'exit':r.returncode,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()});(p/'preparation-status.json').write_text(json.dumps(states,indent=2));print(states[-1],flush=True)
 if r.returncode:raise SystemExit(r.returncode)
