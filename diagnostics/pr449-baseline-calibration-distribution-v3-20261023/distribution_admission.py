"""Filesystem/source-only diagnostic preparation. No renderer imports."""
from pathlib import Path
import hashlib,os

def census_distribution(root):
    root=Path(root);result={'protocol':'complete-generated-distribution-pre-admission-census@3',
      'root':str(root),'regularFiles':{},'symlinks':{},'directories':[],'readErrors':[],
      'rootIsSymlink':root.is_symlink(),'rootExists':root.is_dir(),'otherEntries':{}}
    if root.is_symlink()or not root.is_dir():return result
    def walk_error(error):result['readErrors'].append({'path':str(error.filename),'type':type(error).__name__,'message':str(error)})
    for current,dirs,names in os.walk(root,followlinks=False,onerror=walk_error):
        result['directories'].append('dist'if Path(current)==root else'dist/'+Path(current).relative_to(root).as_posix())
        for name in dirs[:]+names:
            path=Path(current)/name;relative='dist/'+path.relative_to(root).as_posix()
            if path.is_symlink():
                result['symlinks'][relative]=os.readlink(path)
                if name in dirs:dirs.remove(name)
            elif path.is_file():
                try:
                    h=hashlib.sha256();size=0
                    with path.open('rb')as f:
                        for b in iter(lambda:f.read(1024*1024),b''):size+=len(b);h.update(b)
                    result['regularFiles'][relative]={'sha256':h.hexdigest(),'bytes':size}
                except Exception as error:result['readErrors'].append({'path':relative,'type':type(error).__name__,'message':str(error)})
            elif not path.is_dir():result['otherEntries'][relative]={'mode':oct(path.lstat().st_mode)}
    result['regularFiles']=dict(sorted(result['regularFiles'].items()));result['directories'].sort()
    result['rootJavaScriptFiles']=sorted(p for p in result['regularFiles']if p.count('/')==1 and p.endswith('.js'))
    result['regularFileCount']=len(result['regularFiles']);result['rootJavaScriptFileCount']=len(result['rootJavaScriptFiles'])
    return result

def admit_distribution(census,spec):
    target=spec['cardinalities'];present=census['regularFiles']
    missing=[row['path']for row in spec['stableFiles']if row['path']not in present]
    checks=[{'name':'distribution-root-ordinary-directory','passed':census['rootExists']and not census['rootIsSymlink']},
      {'name':'all-regular-files-readable','passed':not census['readErrors'],'errors':census['readErrors']},
      {'name':'only-regular-files-and-directories','passed':not census['otherEntries'],'actual':census['otherEntries']},
      {'name':'no-distribution-symlinks','passed':not census['symlinks'],'actual':census['symlinks']},
      {'name':'exact-distribution-file-count','passed':len(present)==target['distributionRegularFiles'],'actual':len(present),'expected':target['distributionRegularFiles']},
      {'name':'exact-root-javascript-count','passed':len(census.get('rootJavaScriptFiles',[]))==target['rootJavaScriptFiles'],'actual':len(census.get('rootJavaScriptFiles',[])),'expected':target['rootJavaScriptFiles']},
      {'name':'all-source-derived-stable-entries-present','passed':not missing,'missing':missing}]
    return{'protocol':'generated-distribution-explicit-admission@3','qualified':all(x['passed']for x in checks),
      'checks':checks,'failedChecks':[x for x in checks if not x['passed']],
      'scope':'Source-derived17stable entries and unchanged134file/27rootJS counts. Full pre-assertion census is retained separately; all downstream graph/output controls remain mandatory.'}
