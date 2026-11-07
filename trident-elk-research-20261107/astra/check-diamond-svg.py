from pathlib import Path
import xml.etree.ElementTree as E
import json
p=Path(__file__).parent
expected=[('n0','n1'),('n0','n2'),('n1','n3'),('n2','n3')]
report={}
for v in ['baseline','compact-clearance']:
 r=json.loads((p/f'diamond-{v}/result.json').read_text())
 root=E.parse(p/f'diamond-{v}/actual.svg').getroot()
 shapes={e.attrib['data-id'][11:]:e for e in root.iter() if e.tag.endswith('rect') and e.attrib.get('data-id','').startswith('node-shape:')}
 assert sorted(shapes)==['n0','n1','n2','n3']
 boxes={k:tuple(float(e.attrib[a]) for a in ['x','y','width','height']) for k,e in shapes.items()}
 assert all(w==60 and h==40 for x,y,w,h in boxes.values())
 edges=[e for e in root.iter() if e.tag.endswith('polyline') and e.attrib.get('data-role')=='edge']
 assert sorted((e.attrib['data-from'],e.attrib['data-to']) for e in edges)==expected
 assert len({e.attrib['data-id'] for e in edges})==4
 public={(e['from'],e['to']):e for e in r['layout']['layout']['edges']}
 routes=[]
 for e in edges:
  src,dst=e.attrib['data-from'],e.attrib['data-to']
  pts=[tuple(map(float,t.split(','))) for t in e.attrib['points'].split()]
  assert [list(pt) for pt in pts]==public[src,dst]['path']
  sx,sy,sw,sh=boxes[src];tx,ty,tw,th=boxes[dst]
  assert pts[0][1]==sy+sh and sx<=pts[0][0]<=sx+sw
  assert pts[-1][1]==ty and tx<=pts[-1][0]<=tx+tw
  assert pts[1][0]==pts[0][0] and pts[1][1]>pts[0][1]
  assert pts[-2][0]==pts[-1][0] and pts[-2][1]<pts[-1][1]
  assert e.attrib['data-arrow-end']=='true' and e.attrib['marker-end']=='url(#arrowhead)'
  assert any(m.tag.endswith('marker') and m.attrib.get('id')=='arrowhead' for m in root.iter())
  for a,b in zip(pts,pts[1:]):
   assert a!=b and (a[0]==b[0] or a[1]==b[1])
   for other,(x,y,w,h) in boxes.items():
    if other in (src,dst):continue
    through=(a[0]==b[0] and x<a[0]<x+w and max(min(a[1],b[1]),y)<min(max(a[1],b[1]),y+h)) or (a[1]==b[1] and y<a[1]<y+h and max(min(a[0],b[0]),x)<min(max(a[0],b[0]),x+w))
    assert not through
  routes.append({'from':src,'to':dst,'points':pts})
 assert r['checks']['paintProof']['status']=='passed' and not r['checks']['paintProof']['issues']
 labels={e.attrib.get('data-id'):e.attrib.get('data-label') for e in root.iter() if e.attrib.get('class')=='node'}
 assert labels=={k:k for k in boxes}
 gaps=[boxes[b][1]-boxes[a][1]-boxes[a][3] for a,b in expected]
 assert all(g>=48 for g in gaps)
 report[v]={'passed':True,'literalBoxes':boxes,'literalRoutes':routes,'realNodeGaps':gaps,'bends':sum(len(e['points'])-2 for e in routes),'svgWidth':root.attrib['width'],'svgHeight':root.attrib['height'],'viewBox':root.attrib['viewBox'],'paintProofStatus':r['checks']['paintProof']['status'],'backendAttempts':r['product']['receipt']['layoutDecisions'][0]['attempts']}
(p/'diamond-literal-checks.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
