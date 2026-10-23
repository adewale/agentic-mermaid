"""Pinned source-only stable-entry projection; no config evaluation/build/import."""
from pathlib import Path
import hashlib,json,re,subprocess
R=Path(__file__).resolve().parent
SOURCE='ec72a06dcf57d1e429fab9672a9acbf794e22d9f';REPO=R.parent/'rebase-main861'
sha=lambda b:hashlib.sha256(b).hexdigest()
def gitfile(name):return subprocess.run(['git','-C',str(REPO),'show',SOURCE+':'+name],check=True,capture_output=True).stdout
sources={name:gitfile(name)for name in ['package.json','tsup.config.ts','tsup.browser.config.ts','tsup.browser-lazy.config.ts','src/elk-constructor.node.js']}
# This closed parser accepts only the pinned literal entry-map grammar. No eval,
# package import, computed expression or best-effort fallback is permitted.
def literal_entry_maps(text):
 without_comments=re.sub(r'//[^\n]*','',text)
 maps=[]
 for match in re.finditer(r'\bentry\s*:\s*\{([^{}]*)\}',without_comments,re.S):
  body=match[1];pairs=list(re.finditer(r"(?:'([^'\\]+)'|([A-Za-z_][A-Za-z0-9_-]*))\s*:\s*'([^'\\]+)'\s*,?",body))
  residue=body
  for p in reversed(pairs):residue=residue[:p.start()]+residue[p.end():]
  if residue.strip()or not pairs:raise ValueError('Unsupported pinned entry-map grammar')
  maps.append({p[1]or p[2]:p[3]for p in pairs})
 return maps
node_maps=literal_entry_maps(sources['tsup.config.ts'].decode());lazy_maps=literal_entry_maps(sources['tsup.browser-lazy.config.ts'].decode());browser_maps=literal_entry_maps(sources['tsup.browser.config.ts'].decode())
assert len(node_maps)==2 and len(lazy_maps)==2 and len(browser_maps)==1
stable={}
def add(path,reason):stable.setdefault(path,[]).append(reason)
for name,input_ in node_maps[0].items():add('dist/'+name+'.js',{'source':'tsup.config.ts','literalEntry':name,'input':input_,'format':'esm'})
for name,input_ in node_maps[1].items():add('dist/'+name+'.d.ts',{'source':'tsup.config.ts','dtsLiteralEntry':name,'input':input_})
assert browser_maps==[{'browser':'src/index.ts'}]
add('dist/browser.global.js',{'source':'tsup.browser.config.ts','literalEntry':'browser','format':'iife','declaredGlobalName':'agenticMermaid','packageExport':'./browser'})
for name,input_ in lazy_maps[0].items():add('dist/'+name+'.js',{'source':'tsup.browser-lazy.config.ts','literalEntry':name,'input':input_,'format':'esm'})
for name,input_ in lazy_maps[1].items():add('dist/'+name+'.d.ts',{'source':'tsup.browser-lazy.config.ts','dtsLiteralEntry':name,'input':input_})
node=sources['tsup.config.ts'].decode();bridge="copyFileSync('src/elk-constructor.node.js', 'dist/elk-constructor.node.js')"
assert bridge in node;add('dist/elk-constructor.node.js',{'source':'tsup.config.ts','literalOnSuccess':bridge,'verbatimInputSHA256':sha(sources['src/elk-constructor.node.js'])})
package=json.loads(sources['package.json'])
def paths(value,pointer):
 if isinstance(value,str):
  normalized=value.removeprefix('./')
  if normalized.startswith('dist/'):
   assert normalized in stable,(pointer,value)
   add(normalized,{'source':'package.json','jsonPointer':pointer,'literal':value})
 elif isinstance(value,dict):
  for key,v in value.items():paths(v,pointer+'/'+key.replace('~','~0').replace('/','~1'))
for key in ['main','types','exports','bin','imports']:paths(package.get(key),'/'+key)
assert len(stable)==17
expected=json.loads((R/'expected-artifact.json').read_text())
assert all(path in expected['files']for path in stable)
spec={'protocol':'pinned-source-stable-distribution-admission@3','source':SOURCE,
'sources':{p:{'sha256':sha(b),'bytes':len(b)}for p,b in sources.items()},
'stableFiles':[{'path':p,'provenance':reasons}for p,reasons in sorted(stable.items())],
'cardinalities':{'distributionRegularFiles':134,'rootJavaScriptFiles':27,'entireArtifactRegularFiles':737,'runtimePackageFiles':601,'relativeContainedLinks':13,'distributionLexicalJavaScriptModules':99},
'generatedNames':'All non-stable generated names are catalogued verbatim and may change hash suffix under the pre-existing NEW hosted artifact policy. No prefix heuristic designates fixed files.',
'limits':'This stable-entry projection is not an actual build or a graph equivalence claim. Exact counts, physical census, runtime bytes, lexical/observed graph admission and300 original full-value/fourUTF8 outputs remain required.'}
with(R/'distribution-admission-spec.json').open('x')as f:json.dump(spec,f,indent=2);f.write('\n')
print(json.dumps({'stableFiles':len(stable),'sourceOnly':True,'productImported':False,'distributionCountUnchanged':134,'rootJSUnchanged':27}))
