"""Standalone archive hash/count checks; does not execute the study reader."""
from pathlib import Path
import json,gzip,hashlib,base64,sys
archive=Path(sys.argv[1]);out=Path(sys.argv[2]);compressed=archive.read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest();raw=gzip.decompress(compressed);p=json.loads(raw);assert p['protocol']=='four-worker-gc-selected-diagnostic-portable-evidence@1';assert compressed[:3]==b'\x1f\x8b\x08'and not compressed[3]&8 and compressed[4:8]==b'\0'*4;assert json.dumps(p,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()==raw
blobs={}
for h,d in p['objects'].items():
 b=d['content'].encode()if d['encoding']=='utf-8'else base64.b64decode(d['content']);assert len(b)==d['bytes']and sha(b)==h;blobs[h]=b
for path,d in p['pathIndex'].items():assert d['sha256']in blobs and len(blobs[d['sha256']])==d['bytes']
def read(path):return blobs[p['pathIndex'][path]['sha256']]
def load(path):return json.loads(read(path))
F='/workspace/pr449-frontier/';R=F+'rss-per-input-gc-diagnostic/run-fixed-four/';calls=anchors=snapshots=0;slots=[]
for name in ['native-off','elk-off','elk-normal','native-normal']:
 d=load(R+name+'/result.json');journal=[json.loads(line)for line in read(R+name+'/calls.jsonl').splitlines()];assert len(d['calls'])==75 and d['calls']==journal;assert len(d['importSnapshots'])==2
 for i,c in enumerate(d['calls']):
  assert c['index']==i and c['oracleMatches']is True and all(k in c for k in ['svgSha256','receiptSha256','beforeMemory','afterMemory','clockAnchors','wrapperEnvelope']);assert isinstance(c['beforeMemory']['memoryUsage'],dict)and isinstance(c['afterMemory']['memoryUsage'],dict)
 tracepaths=[x for x in p['pathIndex']if x.startswith(R+name+'/trace-')and x.endswith('.json')];assert len(tracepaths)==1
 events=[e for e in load(tracepaths[0])['traceEvents']if e.get('cat')=='node,node.console'and e.get('ph')in ['b','e']and e.get('name','').startswith('time::console-anchor:')];assert len(events)==150
 counts={}
 for e in events:counts.setdefault(e['name'],[]).append(e['ph'])
 assert len(counts)==75 and all(sorted(v)==['b','e']for v in counts.values())
 calls+=75;anchors+=150;snapshots+=len(d['importSnapshots'])+2*len(d['calls']);slots.append({'slot':name,'calls':75,'consoleAnchorEndpoints':150,'snapshots':152})
assert(calls,anchors,snapshots)==(300,600,608);actual=[x for x in p['pathIndex']if x.startswith(R)];assert len(actual)==34
independent=load(F+'rss-per-input-gc-actual-independent-review/assessment.json');assert independent['diagnosticComplete']is True;assert independent['counts']=={'calls':300,'anchorEnds':600,'snapshots':608,'recognizedGCPairs':317}
assert p['scope']=={'instrumentationOnly':True,'RSSWinClaim':False,'causalAttribution':False,'allocatorOrLeakClaim':False,'timingClaim':False,'performanceOrMemoryQualification':False,'standaloneLiveReplay':False}
result={'protocol':'gc-selected-portable-archive-hash-and-complete-count-check@1','passed':True,'archiveSHA256':sha(compressed),'gzipBytes':len(compressed),'originalPaths':len(p['pathIndex']),'uniqueObjects':len(blobs),'uniqueDecodedBytes':sum(map(len,blobs.values())),'actualRawFiles':34,'workers':4,'calls':calls,'consoleAnchorEndpoints':anchors,'memorySnapshots':snapshots,'slots':slots,'allOriginalStudyReadersWorkersRenderersExecuted':False,'clockAssociationOrGCUnionRecalculated':False,'newPerformanceOrMemoryClaim':False}
with out.open('x')as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result))
