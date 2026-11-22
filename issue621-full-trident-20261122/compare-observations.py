from pathlib import Path
import json,collections
p=Path(__file__).parent;names=[x['id'] for x in json.loads((p/'arms.json').read_text())];data={};structure={};rows=[]
for name in names+['peers']:
 r=json.loads((p/name/'layout-observe/results.json').read_text());st=json.loads((p/name/'drawing-structure/results.json').read_text());
 for x in r['rows']:
  label=name if name!='peers' else x['project']; data.setdefault(label,{})[x['caseId']]=x
 for x in st['rows']:
  label=name if name!='peers' else x['project']; structure.setdefault(label,{})[(x['format'],x['caseId'])]=x
metrics=list(next(iter(data['current-default'].values()))['observation']['metrics']);summaries=[];pairs=[]
for name,d in data.items():
 counts={m:collections.Counter(x['observation']['metrics'].get(m,{}).get('status','missing') for x in d.values()) for m in metrics};summaries.append({'configuration':name,'flowchartRows':len(d),'metrics':{k:dict(v) for k,v in counts.items()},'structure':json.loads((p/(name if name in names else 'peers')/'drawing-structure/results.json').read_text())['results']})
for left,right in [('main-default','current-default'),('main-balanced','current-balanced')]+[('current-balanced',x) for x in data if x not in ['current-balanced','current-default','main-default','main-balanced']]+[('current-default','obsidianmd/pele')]:
 a=data[left];b=data[right];by=[]
 for m in metrics:
  ok=lambda d,k:d[k]['observation']['metrics'].get(m,{}).get('status')=='assessed'
  common=sorted(k for k in a.keys()&b.keys() if ok(a,k) and ok(b,k));vals=[(k,a[k]['observation']['metrics'][m]['value'],b[k]['observation']['metrics'][m]['value']) for k in common];by.append({'metric':m,'commonCases':len(common),'commonCaseIds':common,'leftTotal':sum(x for k,x,y in vals),'rightTotal':sum(y for k,x,y in vals),'leftLower':sum(x<y for k,x,y in vals),'rightLower':sum(y<x for k,x,y in vals),'equal':sum(x==y for k,x,y in vals),'different':[{'caseId':k,'left':x,'right':y} for k,x,y in vals if x!=y]})
 deltas=[]
 for key in structure[left].keys()&structure[right].keys():
  a1=structure[left][key];b1=structure[right][key]
  for axis in ['topology','layout']:
   if a1[axis]['status']!=b1[axis]['status']:deltas.append({'format':key[0],'caseId':key[1],'axis':axis,'left':a1[axis]['status'],'right':b1[axis]['status']})
 pairs.append({'left':left,'right':right,'metrics':by,'structureVerdictDeltas':deltas})
out={'scope':'Existing Trident metric values on identical source IDs with both observations fully assessed for that metric. Unknown/capped metrics are excluded from a paired count and retain their raw reasons. No weighted aesthetic score or global winner. Structure comparisons retain status changes per source/format.','configurations':summaries,'pairs':pairs};(p/'geometry-comparison.json').write_text(json.dumps(out,indent=2))
for r in pairs:print(r['left'],r['right'],[{k:v for k,v in x.items() if k not in ['commonCaseIds','different']} for x in r['metrics'] if x['metric'] in ['crossings','edgeNodeIntersections','labelOverlaps','edgeLabelIntersections']],'struct deltas',r['structureVerdictDeltas'][:5])
# Per-callback outcomes, not just total counts.
raw=[]
for arm in ['current-default','main-default','historical-default']:
 q=json.loads((p/arm/'fidelity/results.json').read_text());r=next(x for x in q['results'] if x['project']=='adewale/agentic-mermaid');raw.append((arm,r['cases']))
base=raw[0][1]
keyed=lambda xs:collections.Counter((x['file'],x['name'],x['status'],x.get('unsupportedKind'),x.get('reason','').split('at file:')[0]) for x in xs)
# Source paths/stacks can differ; the status callback fingerprint does not include them.
fp=lambda xs:collections.Counter((x['file'],x['name'],x['status'],x.get('unsupportedKind')) for x in xs)
(p/'fidelity-callback-equality.json').write_text(json.dumps({'method':'Multiset of file, callback name, status and unsupported provenance over every recorded callback; counts preserve repeated titles.','comparisons':[{'left':'current-default','right':arm,'exactStatusFingerprint':fp(base)==fp(xs),'callbacks':len(xs)} for arm,xs in raw[1:]]},indent=2))
