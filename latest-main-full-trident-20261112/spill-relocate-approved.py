"""Exact owner-approved 31-file data relocation; every logical path/byte preserved."""
from pathlib import Path
import os,json,stat,hashlib,datetime
out=Path(__file__).parent
manifest=json.loads((out/'SPILL-MANIFEST.json').read_text())
journal=out/'SPILL-RELOCATION-JOURNAL.jsonl'
assert not journal.exists(), 'Inspect existing journal before any resume; no blind replay'
assert manifest['fileCount']==31 and manifest['logicalBytes']==790004435
assert json.loads((out/'SPILL-COPY-EXIT.json').read_text())['exit']==0
approval={'request':'call_3296b55b19ce4519af810a6e1b2f0c31','answer':'Approve relocation (Recommended)','scope':'EXACT31 SPILL-MANIFEST historical data files; copies then verified disk symlinks'}
(out/'SPILL-OWNER-APPROVAL.json').write_text(json.dumps(approval,indent=2)+'\n')
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb')as f:
  while chunk:=f.read(1024*1024): h.update(chunk)
 return h.hexdigest()
def memory():
 return {n:Path('/sys/fs/cgroup/'+n).read_text().strip()for n in ['memory.current','memory.max','memory.events']}
def append(row):
 with journal.open('a')as f:f.write(json.dumps(row)+'\n');f.flush();os.fsync(f.fileno())
append({'phase':'start','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'approval':approval,'memory':memory()})
# Validate EVERY original/copy first; do not begin relocation with an incomplete copy set.
for r in manifest['files']:
 src=Path(r['path']);dst=Path(r['destination']);s=src.lstat();d=dst.lstat()
 assert stat.S_ISREG(s.st_mode)and stat.S_ISREG(d.st_mode)
 assert (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink)==(r['device'],r['inode'],r['bytes'],r['mtimeNs'],1)
 assert d.st_size==r['bytes']and d.st_uid==r['uid']and d.st_gid==r['gid']and stat.S_IMODE(d.st_mode)==stat.S_IMODE(r['mode'])
 assert sha(src)==sha(dst)==r['sha256']
 append({'phase':'preverified','id':r['id'],'sha256':r['sha256']})
for r in manifest['files']:
 src=Path(r['path']);dst=Path(r['destination']);s=src.lstat()
 assert stat.S_ISREG(s.st_mode)and(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink)==(r['device'],r['inode'],r['bytes'],r['mtimeNs'],1)
 assert sha(src)==sha(dst)==r['sha256']
 os.utime(dst,ns=(r['atimeNs'],r['mtimeNs']))
 with dst.open('rb')as f:os.fsync(f.fileno())
 tmp=src.parent/('.pr449-spill-'+r['id']+'.tmp')
 assert not tmp.exists()and not tmp.is_symlink()
 os.symlink(str(dst),tmp)
 append({'phase':'before-atomic-replace','id':r['id'],'original':str(src),'destination':str(dst),'device':s.st_dev,'inode':s.st_ino,'size':s.st_size})
 os.replace(tmp,src)
 fd=os.open(src.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
 assert src.is_symlink()and os.readlink(src)==str(dst)
 assert src.stat().st_size==r['bytes']and sha(src)==r['sha256']
 os.utime(dst,ns=(r['atimeNs'],r['mtimeNs']))
 d=src.stat();assert(d.st_uid,d.st_gid,d.st_mtime_ns,stat.S_IMODE(d.st_mode))==(r['uid'],r['gid'],r['mtimeNs'],stat.S_IMODE(r['mode']))
 append({'phase':'postverified','id':r['id'],'path':str(src),'fileKindBefore':'regular','fileKindAfter':'symlink','sha256':r['sha256'],'bytes':r['bytes'],'mtimeNs':d.st_mtime_ns})
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':31,'logicalBytesPreserved':790004435,'regularToVerifiedSymlinks':31,'pathsAndBytesPreserved':True,'allSourcesCurrentSdkGitExcluded':True,'futureArchives':'Must dereference/include actual bytes, never only absolute symlinks','memoryAfter':memory()}
(out/'SPILL-RELOCATION-COMPLETED.json').write_text(json.dumps(result,indent=2)+'\n');append({'phase':'completed',**result});print(json.dumps(result))
