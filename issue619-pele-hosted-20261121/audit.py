import pathlib,json,hashlib,importlib.util,sys,xml.etree.ElementTree as ET,collections,itertools,re,html
p=pathlib.Path(__file__).parent;spec=importlib.util.spec_from_file_location('exact','/tmp/issue619-followup-20261121/pipeline/curve-crossings.py');m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
cases=json.loads((p/'cases.json').read_text());out=[]
def display(s):return ' '.join(html.unescape(re.sub(r'<br\s*/?>','\n',s.replace('\\n','\n'))).split())
def text(e):
 # Existing hosted-caption policy: separate independently positioned wrapped lines.
 blocks=[]
 for x in e:
  if m.inp.tag(x)!='text':continue
  lines=[ch for ch in x if m.inp.tag(ch)=='tspan' and ch.get('y') is not None]
  blocks.extend(''.join(line.itertext()) for line in lines) if lines else blocks.append(''.join(x.itertext()))
 return display(' '.join(blocks))
def displayed_lines(e):
 lines=[]
 for child in e:
  if m.inp.tag(child)!='text':continue
  spans=[x for x in child if m.inp.tag(x)=='tspan' and x.get('y') is not None]
  lines.extend(display(''.join(x.itertext())) for x in spans) if spans else lines.append(display(''.join(child.itertext())))
 return lines
def matches_wrapped_display(expected,lines):
 # Compare exact Unicode within each emitted line, allowing a visual wrap to
 # consume source whitespace. Bold tag interpretation is reported separately.
 expected=display(re.sub(r'</?b>','',expected));at=0
 for line in lines:
  while at<len(expected) and expected[at].isspace():at+=1
  if not expected.startswith(line,at):return False
  at+=len(line)
 return expected[at:].strip()==''
for c in cases:
 expected=json.loads((p/'controls'/f'{c["id"]}-am.json').read_text())['layout'];wanted=collections.Counter((e['from'],e['to']) for e in expected['edges']);nodes={n['id']:display(n['label']) for n in expected['nodes']}
 for arm in ['pele-hosted','pele-npm','am','zm']:
  f=p/('renders' if arm=='pele-hosted' else 'controls')/f'{c["id"]}-{arm}.svg'
  if not f.exists():continue
  row={'id':c['id'],'arm':arm,'inputSHA256':hashlib.sha256(c['source'].encode()).hexdigest(),'svgSHA256':hashlib.sha256(f.read_bytes()).hexdigest()}
  try:
   root=ET.fromstring(f.read_text());parents={ch:e for e in root.iter() for ch in e};ispele=arm.startswith('pele');edges=[];labels={};observed=collections.Counter();marker_errors=[];node_labels={}
   if ispele:
    for g in root.iter():
     if 'pele-node' in g.get('class','').split():node_labels[g.get('data-id')]=text(g)
     if g.get('class')=='pele-edge-label':labels[g.get('data-id')]=text(g)
    groups=[g for g in root.iter() if g.get('class')=='pele-edge'];shapes=[(next(ch for ch in g if m.inp.tag(ch)=='path' and ch.get('class') is None),g) for g in groups]
   else:
    shapes=[(e,None) for e in root.iter() if m.inp.tag(e) in ['path','polyline'] and e.get('data-from') is not None]
   for i,(e,g) in enumerate(shapes):
    if ispele:
     key=g.get('data-id');matches=[(s,t) for s,t in wanted if re.fullmatch('L_'+re.escape(s)+'_'+re.escape(t)+r'_\d+',key)];assert len(matches)==1,(key,matches);s,t=matches[0]
     marks=[ch for ch in g if ch.get('class')=='pele-marker'];assert len(marks)==1,(key,len(marks));caption=labels.get(key)
    else:s,t=e.get('data-from'),e.get('data-to');key=e.get('data-id') or f'{s}->{t}#{i}';caption=display(e.get('data-label')) if e.get('data-label') else None
    ancestor=e
    while ancestor is not None:
     assert ancestor.get('transform') is None,('unhandled connector transform',ancestor.attrib);ancestor=parents.get(ancestor)
    groups=m.inp.path_groups(e.get('d')) if m.inp.tag(e)=='path' else m.inp.poly_groups(e.get('points'));segments=m.inp.segs(groups);observed[s,t]+=1
    if ispele:
     nums=re.findall(m.inp.num,marks[0].get('d'));tip=tuple(m.inp.Q(n) for n in nums[:2]);end=segments[-1].controls[-1];previous=next(x for x in reversed(segments[-1].controls[:-1]) if x!=end);forward=m.inp.dot(m.inp.sub(tip,end),m.inp.sub(end,previous))>0
     if not forward:marker_errors.append(key)
    edges.append({'id':key,'source':s,'target':t,'caption':caption,'segments':segments,'end':[float(v) for v in segments[-1].controls[-1]]})
   assert observed==wanted,('occurrences',observed-wanted,wanted-observed)
   expected_captions=collections.Counter((e['from'],e['to'],display(e['label']['text']) if e.get('label') else None) for e in expected['edges']);actual_captions=collections.Counter((e['source'],e['target'],e['caption']) for e in edges);assert expected_captions==actual_captions,('caption associations',expected_captions-actual_captions,actual_captions-expected_captions)
   node_differences=[{'id':k,'amDisplay':nodes.get(k),'peleDisplay':v} for k,v in node_labels.items() if nodes.get(k)!=v]
   if ispele:
    assert set(node_labels)==set(nodes),('node IDs',set(node_labels)^set(nodes))
    node_word_failures=[g.get('data-id') for g in root.iter() if 'pele-node' in g.get('class','').split() and not matches_wrapped_display(nodes[g.get('data-id')],displayed_lines(g))]
    assert not node_word_failures,('node displayed characters',node_word_failures)
   assert not marker_errors,('reverse facing markers',marker_errors)
   locations=[];unknown=[];overlaps=[]
   for a,b in itertools.combinations(edges,2):
    hits=[]
    for v,w in itertools.product(a['segments'],b['segments']):
     if not m.inp.intersects(v.bounds,w.bounds):continue
     candidates,notes=m.pair(v,w)
     for n in notes:
      if 'unresolved' in n:unknown.append({'edges':[a['id'],b['id']],'note':n})
      else:overlaps.append({'edges':[a['id'],b['id']],'note':n})
     for t,u in candidates:
      kind,xy=m.hit(a,v,t,b,w,u)
      if 'unresolved' in kind:unknown.append({'edges':[a['id'],b['id']],'note':kind})
      if kind=='proper' and not any(all(m.common(x,y) is not None for x,y in zip(prior,xy)) for prior in hits):hits.append(xy)
    locations.extend({'edges':[a['id'],b['id']],'point':[[float(v) for v in axis] for axis in xy]} for xy in hits)
   duplicates=[]
   for a,b in itertools.combinations(edges,2):
    if [s.controls for s in a['segments']]==[s.controls for s in b['segments']]:duplicates.append([a['id'],b['id']])
   row.update(ok=True,properCrossings=None if unknown else len(locations),unknown=unknown,overlappingSegmentEvents=len(overlaps),fullyCoincidentDirectedShaftPairs=duplicates,edgeOccurrences=len(edges),captions=sum(e['caption'] is not None for e in edges),nodes=len(nodes),sourceTargetOccurrenceCaptionCorrespondence='pass',nodeDisplayCorrespondence=('same displayed words after inline bold markup interpretation' if node_differences and all(display(re.sub(r'</?b>','',x['amDisplay']))==x['peleDisplay'] for x in node_differences) else 'pass' if not node_differences else 'display differences retained') if ispele else 'existing AM metadata; ZM node display not recertified',nodeDisplayDifferences=node_differences,nodeCharactersAtRenderedLineBoundaries='match after explicit inline bold interpretation' if ispele else 'not newly assessed',markerForwardDirection='all end arrows face forward' if ispele else 'not newly assessed',viewBox=root.get('viewBox'),titlePresent='Cyclic routes' in ''.join(root.itertext()) if c['id']=='nineteen' else None,locations=locations)
   if c['id']=='bm52-wallet':
    upper='TL8TBpubVzBr1UWPXBXU8Pci5ZAip9SwEf';lower='TUaZjKM5ZivTt2XoWdy5QuqxCwrgyetZ8c';row['upperArrivals']=[{'source':e['source'],'end':e['end']} for e in edges if e['target']==upper];row['distinctUpperArrivals']=len({tuple(e['end']) for e in edges if e['target']==upper});row['lowerPayers']=[e['source'] for e in edges if e['target']==lower]
  except Exception as error:row.update(ok=False,error=repr(error))
  out.append(row);(p/'aesthetics.json').write_text(json.dumps(out,indent=2)+'\n');print(c['id'],arm,row.get('properCrossings'),row.get('error'),flush=True)
