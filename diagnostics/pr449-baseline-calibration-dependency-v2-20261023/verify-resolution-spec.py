"""Local source/manifest-only derivation readback; no resolver/product import."""
from pathlib import Path
import hashlib,json,subprocess,re
R=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
load=lambda p:json.loads(Path(p).read_text())
spec=load(R/'runtime-resolution-spec.json');artifact=load(R/'expected-artifact.json')
origin=Path('/workspace/pr449-frontier/bounded-crossing-cost/baseline-artifact-manifest.json');manifest=load(origin)
lock=subprocess.run(['git','-C','/workspace/pr449-frontier/rebase-main861','show','ec72a06dcf57d1e429fab9672a9acbf794e22d9f:bun.lock'],check=True,capture_output=True).stdout
checks=[]
def check(ok,name):
 if not ok:raise ValueError(name)
 checks.append(name)
check(sha(origin)==spec['originalRuntimeManifestSHA256'],'Original full runtime manifest bound')
check(sha(R/'expected-artifact.json')==spec['expectedArtifactSHA256'],'Original full601 runtime hash catalogue bound')
check(hashlib.sha256(lock).hexdigest()==spec['lockSHA256']==artifact['files']['bun.lock'],'Original exact lock bound')
locked={}
for line in lock.decode().splitlines():
 m=re.match(r'^    ("[^\"]+"): (\[.*\]),?$',line)
 if m:locked[json.loads(m[1])]=json.loads(m[2])
copy_ids={p['copy']:str(Path(p['copy']).relative_to(manifest['root']))for p in manifest['runtimePackages']}
lookup={p['name']:p for p in manifest['runtimePackages']}
for p in manifest['runtimePackages']:
 id=copy_ids[p['copy']];expect=spec['packages'][id]
 check(expect=={'name':p['name'],'version':p['version'],'packageJSONSHA256':p['files']['package.json']},'Manifest exact package:'+p['name'])
 check(all(artifact['files'][id+'/'+k]==h for k,h in p['files'].items()),'Every expected runtime byte:'+p['name'])
roots=[]
for link in manifest['symlinks']:
 if link.startswith('node_modules/'):
  name=link[len('node_modules/'):];roots.append({'consumer':'$project','specifier':name,'target':copy_ids[lookup[name]['copy']],'lockKey':name})
check(roots==spec['roots'],'Seven project consumer roots derive exactly from original links')
check(sum(len(p['files'])for p in manifest['runtimePackages'])==601,'Exactly original601 package files')
check(len(spec['packages'])==13 and len(spec['roots'])==7 and len(spec['edges'])==6,'Exactly13 nodes/7project roots/6 package edges')
for edge in spec['edges']:
 consumer=next(p for p in manifest['runtimePackages']if copy_ids[p['copy']]==edge['consumer'])
 check(copy_ids[consumer['dependencies'][edge['specifier']]]==edge['target'],'Actual original consumer edge:'+consumer['name']+'→'+edge['specifier'])
for edge in spec['roots']+spec['edges']:
 key=edge['lockKey'];target=spec['packages'][edge['target']]
 check(spec['lockedRecords'][key]==locked[key],'Exact lock record:'+key)
 check(locked[key][0]==target['name']+'@'+target['version'],'Locked expected version:'+key)
 if edge['consumer']!='$project':
  parentkey=next(x['lockKey']for x in spec['roots']+spec['edges']if x['target']==edge['consumer'])
  decl={**locked[parentkey][2].get('dependencies',{}),**locked[parentkey][2].get('optionalDependencies',{})}
  check(edge['specifier']in decl,'Edge actually declared by locked consumer:'+parentkey+'→'+edge['specifier'])
report={'protocol':'original-consumer-manifest-plus-lock-spec-derivation-readback@2','rendererImported':False,'resolverExecutedAgainstProduct':False,'checks':checks,'passed':len(checks),'originalManifestSHA256':sha(origin),'specSHA256':sha(R/'runtime-resolution-spec.json')}
(R/'resolution-spec-readback.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':len(checks),'rendererImported':False,'actualProductResolution':False}))
