import pathlib,importlib.util,sys,itertools,json,xml.etree.ElementTree as ET,math,collections
p=pathlib.Path(__file__).parent;spec=importlib.util.spec_from_file_location('exact','/tmp/issue619-followup-20261121/pipeline/curve-crossings.py');m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m);rows=[]
for arm in ['ts-control','ts-final']:
 root=ET.fromstring((p/f'{arm}.svg').read_text());edges=[];wire=0;bends=0
 for e in root.iter():
  if e.get('data-from') is None or m.inp.tag(e) not in ['path','polyline']:continue
  groups=m.inp.path_groups(e.get('d')) if m.inp.tag(e)=='path' else m.inp.poly_groups(e.get('points'))
  edges.append({'id':e.get('data-id'),'source':e.get('data-from'),'target':e.get('data-to'),'segments':m.inp.segs(groups)})
  if m.inp.tag(e)=='polyline':
   pts=[tuple(map(float,s.split(','))) for s in e.get('points').split()];wire+=sum(math.dist(a,b) for a,b in zip(pts,pts[1:]));bends+=max(0,len(pts)-2)
 hits=[];unknown=[]
 for e,h in itertools.combinations(edges,2):
  locations=[]
  for a,b in itertools.product(e['segments'],h['segments']):
   if not m.inp.intersects(a.bounds,b.bounds):continue
   cs,notes=m.pair(a,b);unknown.extend(n for n in notes if 'unresolved' in n)
   for t,u in cs:
    kind,xy=m.hit(e,a,t,h,b,u)
    if 'unresolved' in kind:unknown.append(kind)
    if kind=='proper' and not any(all(m.common(c,d) is not None for c,d in zip(q,xy)) for q in locations):locations.append(xy)
  hits.extend([e['id'],h['id']] for _ in locations)
 rows.append({'arm':arm,'crossings':len(hits),'unknown':unknown,'wirePx':wire,'geometricBends':bends,'canvas':root.get('viewBox'),'edgeOccurrences':len(edges),'captions':sum(bool(e.get('data-label')) for e in root.iter() if e.get('data-from') and m.inp.tag(e) in ['path','polyline']),'crossingPairs':hits});print({k:v for k,v in rows[-1].items() if k!='crossingPairs'},flush=True)
(p/'quality.json').write_text(json.dumps(rows,indent=2))
