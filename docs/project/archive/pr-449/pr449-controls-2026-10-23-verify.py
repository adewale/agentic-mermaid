"""Archive hash/count verification only; no original study reader execution."""
from pathlib import Path
import sys,json,gzip,hashlib,base64,csv,io
archive=Path(sys.argv[1]);out=Path(sys.argv[2]);compressed=archive.read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest();raw=gzip.decompress(compressed);p=json.loads(raw);assert compressed[:3]==b'\x1f\x8b\x08'and not compressed[3]&8 and compressed[4:8]==b'\0'*4
assert json.dumps(p,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()==raw
blobs={}
for h,d in p['objects'].items():
 b=d['content'].encode()if d['encoding']=='utf-8'else base64.b64decode(d['content']);assert len(b)==d['bytes']and sha(b)==h;blobs[h]=b
for path,d in p['pathIndex'].items():assert d['sha256']in blobs and len(blobs[d['sha256']])==d['bytes']
def read(path):return blobs[p['pathIndex'][path]['sha256']]
def load(path):return json.loads(read(path))
F='/workspace/pr449-frontier/';R=F+'whole-process-rss-coldbridge/';V=F+'fresh-host-baseline-calibration-v3-result/final-unpacked/prepared/';idx=p['pathIndex']
rss=[x for x in idx if x.startswith(R+'run-fixed-24/')];assert len(rss)==146
jobs=[x for x in idx if x.startswith(R+'jobs/')and x.endswith('.json')];assert len(jobs)==24
rssres=[x for x in rss if x.endswith('.result.json')];assert len(rssres)==24;rssrows=sum(len(load(x)['calls'])for x in rssres);assert rssrows==1800
for x in rssres:
 d=load(x)
 for c in d['calls']:assert all(k in c for k in ['occurrenceId','svgSha256','receiptSha256','callbackCalls','oracleMatches'])
peaks=list(csv.DictReader(io.StringIO(read(R+'actual-readback/ALL24-PEAKS.csv').decode())));controls=list(csv.DictReader(io.StringIO(read(R+'actual-readback/ALL12-CONTROLS.csv').decode())));assert len(peaks)==24 and len(controls)==12
journals=[x for x in idx if x.startswith(V+'calibration/')and x.endswith('.json.calls.jsonl')];assert len(journals)==24
allcalls=[json.loads(line)for x in journals for line in read(x).splitlines()];assert len(allcalls)==10800
workers=[x for x in idx if x.startswith(V+'calibration/')and x.endswith(('-baseline-A.json','-baseline-B.json'))];assert len(workers)==24
warm=sum(len(load(x)['warmupCalls'])for x in workers);timed=sum(len(load(x)['calls'])for x in workers);assert(warm,timed)==(3600,7200)
a=load(F+'fresh-host-baseline-calibration-v3-result/assessment.final-readback.json');assert len(a['allInputs'])==300 and len(a['allFailures'])==75 and a['qualified']is False
sem=load(F+'fresh-host-baseline-calibration-v3/expected-oracles.semantic.json');assert sum(len(d['occurrences'])for d in sem.values())==300
preflight=0;utf8=0
for name in ['off-baseline','off-baseline-elk','normal-baseline','normal-baseline-elk']:
 d=load(V+'preflight-oracles/'+name+'.json');assert len(d['occurrences'])==75
 for r in d['occurrences']:
  for k in ['svg','receipt','layout','layoutReceipt']:assert isinstance(r[k]['sha256'],str)and len(r[k]['sha256'])==64;utf8+=1
  assert isinstance(r['fullValues']['sha256'],str);preflight+=1
assert preflight==300 and utf8==1200
assert p['qualification']=={'RSS':False,'V3':False,'noPerformanceMemoryOrAdoptionClaim':True}
result={'protocol':'rss-v3-controls-portable-archive-hash-and-complete-row-check@1','passed':True,'archiveSHA256':sha(compressed),'archiveBytes':len(compressed),'originalPaths':len(idx),'uniqueObjects':len(blobs),'uniqueDecodedBytes':sum(map(len,blobs.values())),'RSSActualFiles':146,'RSSJobs':24,'RSSCompleteCallRows':rssrows,'RSSPrimaryPeaks':len(peaks),'RSSControls':len(controls),'V3Workers':24,'V3JournalRows':len(allcalls),'V3WarmupRows':warm,'V3TimedRows':timed,'V3AllInputVectors':300,'V3AllFailureObjects':75,'preflightSemanticOccurrences':300,'preflightUTF8Descriptors':1200,'wholeExcludedObjects':len(p['wholeObjectExclusions']),'studyReadersWorkersRenderersExecuted':False,'standaloneLiveReplayClaim':False}
with out.open('x')as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result))
