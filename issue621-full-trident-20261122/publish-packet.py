from pathlib import Path
import json,shutil,tarfile,hashlib
p=Path(__file__).parent;dest=Path('/workspace/elk-layered-tools/issue619-intent-evidence-checkout/issue621-full-trident-20261122');assert not dest.exists();dest.mkdir();(dest/'raw').mkdir()
# Keep public provenance, scripts, all failed collection logs and canonical reductions.
for f in sorted(p.iterdir()):
 if f.is_file() and f.suffix in ['.json','.jsonl','.log','.md','.patch','.ts','.mjs','.py'] and not f.name.startswith('pr-body-after'):shutil.copy2(f,dest/f.name)
for directory in ['versions-current','versions-final','versions','browser-resources','consumed-qualified','model-review-reviewed-pins']:
 source=p/directory
 if not source.exists():continue
 for f in source.rglob('*'):
  if f.is_file() and not f.is_symlink() and not any(x in f.parts for x in ['node_modules','.git']) and f.suffix not in ['.tgz']:
   rel=f.relative_to(p);target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,target)
for arm in [a['id'] for a in json.loads((p/'arms.json').read_text())]+['peers']:
 for f in (p/arm).iterdir():
  if f.is_file():target=dest/arm/f.name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,target)
 for sub in ['prepared']:
  for f in (p/arm/sub).rglob('*.json'):
   target=dest/f.relative_to(p);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,target)
# Small version-review reports are directly readable; full native models stay archived.
for name in ['REVIEW.md','zombie-types.json','zombie-comparison.json','franken-comparison.json','core-types.diff','mermaid-parser-types.diff','capability-review-current-versions.json','zombie-old.json','zombie-new.json','franken-old.json','franken-new.json','comparison-bun.log']:
 f=p/'model-review'/name
 if f.exists():target=dest/'model-review'/name;target.parent.mkdir(exist_ok=True);shutil.copy2(f,target)
archives=[]
def regular(info):
 # Derived Fidelity folders link to the original raw directories. Publish the
 # originals and derived results, not host-absolute symlinks or install trees.
 if info.issym() or info.islnk() or '/node_modules/' in info.name or '/.git/' in info.name:return None
 return info
for directory in [a['id'] for a in json.loads((p/'arms.json').read_text())]+['peers','consumed-main-pr','consumed-event-recovery','model-review']:
 target=dest/'raw'/(directory+'.tar.gz')
 with tarfile.open(target,'w:gz',compresslevel=6) as tar:tar.add(p/directory,arcname=directory,filter=regular)
 assert target.stat().st_size<95*1024*1024,(target,target.stat().st_size)
 archives.append({'path':str(target.relative_to(dest)),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
(dest/'RAW-ARCHIVES.json').write_text(json.dumps(archives,indent=2))
(dest/'README.md').write_text('# Full Trident, 22 November 2026\n\n[Full results, usual metrics and revised merge assessment](REPORT.md).\n\nExact source head6d8d7fbc835b2767b83a3bbdfca5e7b7d9f8e19b versus mainf49196e7f5d6d2f0970a4a76fe62644ee5e9d004, plus historical Native/ELK.js and current ZM, BM, Pele SDK, Mermaid and Frankenmermaid. Full input populations; no source or CI change.\n\nRaw canonical collections, outputs and failed/recovered commands are in the per-arm archives listed in [RAW-ARCHIVES.json](RAW-ARCHIVES.json). Prepared package/browser manifests, reports, scores, geometry comparisons and resource measurements are also readable directly. The initial invalid Event edits and their valid-edit recovery remain separate. Derived Fidelity symlinks were omitted from archives; the original audit/job/model data and separately rescored results are retained. No install tree, package binary, checkout or executable bundle is published.\n\nThe parser model `.v8` files use Bun1.4.4\u2019s serialization compatibility API and must be decoded with Bun, as the retained successful comparison did. Source inputs and model contents are public corpus evidence. [PROVENANCE.json](PROVENANCE.json), the full adapter patch, unchanged-scorer digests and the packet manifest bind the result.\n')
files=[]
for f in sorted(dest.rglob('*')):
 if f.is_file():files.append({'path':str(f.relative_to(dest)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
(dest/'MANIFEST.json').write_text(json.dumps({'sourceHead':'6d8d7fbc835b2767b83a3bbdfca5e7b7d9f8e19b','files':files},indent=2));print(json.dumps({'destination':str(dest),'files':len(files)+1,'bytes':sum(x['bytes'] for x in files),'archives':archives},indent=2))
