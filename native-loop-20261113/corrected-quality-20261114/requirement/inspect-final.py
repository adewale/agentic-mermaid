import pathlib,gzip,json,xml.etree.ElementTree as E,math,hashlib
r=pathlib.Path(__file__).parent
rows=[];S='{http://www.w3.org/2000/svg}'
expected=[('suite','fast','verifies'),('suite','fast','traces'),('fast','report','derives'),('report','fast','satisfies'),('fast','fast','refines')]
def normal(p,q,c):
 x,y,w,h=[float(c.get(k)) for k in ['x','y','width','height']];a,b=p;dx,dy=q[0]-a,q[1]-b;near=lambda u,v:abs(u-v)<1e-6
 return dy==0 and y<b<y+h and (near(a,x) and dx<0 or near(a,x+w) and dx>0) or dx==0 and x<a<x+w and (near(b,y) and dy<0 or near(b,y+h) and dy>0)
for d in ['TB','BT','LR','RL']:
 for b in ['agentic','elk']:
  p=r/d/b;raw=gzip.decompress((p/'actual.svg.gz').read_bytes());s=E.fromstring(raw)
  cards={g.get('data-id'):g for g in s.iter(S+'g')if 'requirement-node' in g.get('class','').split()};assert sorted(cards)==['fast','report','suite']
  got={k:[''.join(t.itertext())for t in g.iter(S+'text')]for k,g in cards.items()}
  assert got=={'fast':['<<Requirement>>fast','ID: performance-1','Text: Respond quickly with retained measured fields','Risk: High','Verification: Test'],'suite':['<<Element>>suite','Type: test','Doc Ref: bench suite'],'report':['<<Element>>report','Type: artifact']},got
  rel=[x for x in s.iter()if x.get('data-role')=='relationship'];assert[(x.get('data-from'),x.get('data-to'),x.get('data-relationship'))for x in rel]==expected
  captions=[g for g in s.iter(S+'g')if g.get('class')=='requirement-edge-label'];assert[g.get('data-edge-id')for g in captions]==[x.get('data-id')for x in rel]
  assert [''.join(g.find(S+'text').itertext())for g in captions]==['<<'+e[2]+'>>'for e in expected]
  wire=0;bends=0;contacts=0
  for x in rel:
   assert x.tag==S+'polyline';pts=[tuple(map(float,v.split(',')))for v in x.get('points').split()]
   for a,z in zip(pts,pts[1:]): assert a[0]==z[0] or a[1]==z[1];wire+=math.dist(a,z)
   bends+=len(pts)-2
   for a,z,key in [(pts[0],pts[1],'data-from'),(pts[-1],pts[-2],'data-to')]: assert normal(a,z,cards[x.get(key)].find(S+'rect'));contacts+=1
   assert x.get('marker-end')=='url(#requirement-arrow)' and x.get('marker-start')is None
  _,_,w,h=map(float,s.get('viewBox').split());result=json.loads(gzip.decompress((p/'RESULT.json.gz').read_bytes()));c=result['proof']
  rows.append({'direction':d,'backend':b,'head':result['job']['revision'],'svgSHA256':hashlib.sha256(raw).hexdigest(),'delivery':result['status'],'proof':c['status'],'operations':c['checks']['operations'],'authoredCards':3,'authoredRelations':5,'ownedCaptionOccurrences':5,'normalContacts':contacts,'width':w,'height':h,'viewportArea':w*h,'routeWire':wire,'bends':bends,'sizes':result['sizes'],'cost':{'status':'not-measured','scope':'Functional requalification only, no timing clock'},'ink':'unknown-pending-mask-raster','qualityLimit':'viewport area and carrier wire, not glyph readability or optimal placement'})
(r/'FINAL-SVG-VECTORS.json').write_text(json.dumps(rows,indent=2)+'\n')
for d in ['TB','BT','LR','RL']:
 a,e=[x for x in rows if x['direction']==d];print(d,{k:round((a[k]/e[k]-1)*100,4)for k in ['viewportArea','routeWire']},'bends',a['bends'],e['bends'],'proofops',a['operations'],e['operations'])
