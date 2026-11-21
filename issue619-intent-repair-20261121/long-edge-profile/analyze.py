import pathlib,json,collections,statistics,hashlib
p=pathlib.Path(__file__).parent;report=[]
phase_names={'splitLongEdges':'splitting','splitEdge':'splitting','minimizeCrossings':'crossing minimization','placeNodes':'node placement','routeOrthogonal2':'orthogonal routing','routeOrthogonal':'orthogonal routing','joinLongEdges':'joining','joinAt':'joining'}
def category(stack):
 if any(name.startswith('globalThis.__phase') or name.startswith('globalThis.__split') for name in stack):return 'diagnostic observers'
 if '(garbage collector)' in stack:return 'garbage collection'
 for name in reversed(stack):
  if name in phase_names:return phase_names[name]
 return 'other setup/solver/harness'
for span in [2,8,24]:
 timing=json.loads((p/f'timing-span{span}.json').read_text());diag=json.loads((p/f'profile-span{span}.json').read_text());cpu=json.loads((p/f'span{span}.cpuprofile').read_text());heap=json.loads((p/f'span{span}.heapprofile').read_text());expected=hashlib.sha256((p/f'qualified-span{span}.json').read_bytes()).hexdigest()
 assert all(r['outputSHA256']==expected for r in timing['rows']);assert all(h==expected for h in diag['outputHashes'])
 nodes={n['id']:n for n in cpu['nodes']};parents={c:n['id'] for n in cpu['nodes'] for c in n.get('children',[])}
 def stack(i):
  result=[]
  while i in nodes:
   result.append(nodes[i]['callFrame']['functionName']);i=parents.get(i)
  return result[::-1]
 totals=collections.Counter()
 for i,micros in zip(cpu['samples'],cpu['timeDeltas']):totals[category(stack(i))]+=micros/1000
 allocation=collections.Counter();by_function=collections.Counter()
 def visit(n,names):
  names=names+[n['callFrame']['functionName']];allocation[category(names)]+=n.get('selfSize',0);by_function[names[-1]]+=n.get('selfSize',0)
  for child in n['children']:visit(child,names)
 visit(heap['head'],[])
 phases=collections.defaultdict(list)
 for row in diag['phases']:phases[row['name']].append(row)
 summary={'span':span,'authoredEdges':timing['authoredEdges'],'generatedDummiesPerLayout':diag['splits']/9,'copiedOptionEntriesPerLayout':diag['copiedEntries']/9,'copiedOptionMapHistogramAcross9':diag['optionSizeHistogram'],'median9LayoutMs':statistics.median(r['layoutMs'] for r in timing['rows']),'coldLayoutMs':timing['rows'][0]['layoutMs'],'warm8LayoutMedianMs':statistics.median(r['layoutMs'] for r in timing['rows'][1:]),'median9ConsumedJsonMs':statistics.median(r['consumedMs'] for r in timing['rows']),'peakWholeProcessRssMiB':timing['peakRssKiB']/1024,'lastHeapMiB':timing['rows'][-1]['heap']/1048576,'qualifiedOutputHash':expected,'all18TimingAndProfileHashesMatchQualified':True,'cpuSampledMs':dict(totals),'cpuFractionPercent':{k:v/sum(totals.values())*100 for k,v in totals.items()},'sampledAllocationBytes':dict(allocation),'sampledAllocationTotalBytes':sum(allocation.values()),'largestSampledAllocatingFunctions':by_function.most_common(12),'phaseCounters':{k:{field:statistics.median(x[field] for x in v) for field in ['nodes','dummies','ports','edges','rankDelta','maximumLayerWidth','heapUsed']} for k,v in phases.items()}}
 report.append(summary)
(p/'summary.json').write_text(json.dumps(report,indent=2)+'\n')
for row in report:print(row['span'],'D',row['generatedDummiesPerLayout'],'CPU%',{k:round(v,1) for k,v in row['cpuFractionPercent'].items()},'allocMiB',{k:round(v/1048576,2) for k,v in row['sampledAllocationBytes'].items()},'totalMiB',round(row['sampledAllocationTotalBytes']/1048576,2))
