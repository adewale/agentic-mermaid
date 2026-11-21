"""Independent double-precision cross-check of the exact written-curve results."""
import importlib.metadata, importlib.util, sys
from itertools import combinations, product
from pathlib import Path
import json,math, re, gzip
from xml.etree import ElementTree as ET
from svgpathtools import CubicBezier,QuadraticBezier,Line
root=Path(__file__).parent
spec=importlib.util.spec_from_file_location('curve_inputs',root/'curve-inputs.py')
src=importlib.util.module_from_spec(spec);sys.modules['curve_inputs']=src;spec.loader.exec_module(src)
summary=json.loads((root/'curve-crossings.json').read_text());result={}
def g(s):return {2:Line,3:QuadraticBezier,4:CubicBezier}[len(s.controls)](*(complex(float(x),float(y)) for x,y in s.controls))
for arm in ['zombie','pele']:
    sha,edges=src.read(arm);assert summary[arm]['svgSha256']==sha
    found={};maxResidual=0;rawSeeds=0;rawMax=0
    for e,h in combinations(edges,2):
        seen=[];name=(e['id'],h['id'])
        for a,b in product(e['segments'],h['segments']):
            if not src.intersects(a.bounds,b.bounds):continue
            x=g(a);y=g(b)
            for t,u in x.intersect(y,tol=1e-12):
                rawSeeds+=1;rawMax=max(rawMax,abs(x.point(t)-y.point(u)))
                for _ in range(5):
                    d=x.derivative(t);v=y.derivative(u);z=y.point(u)-x.point(t);det=(d.conjugate()*(-v)).imag
                    assert det!=0
                    t+=(z.conjugate()*(-v)).imag/det
                    u+=(d.conjugate()*z).imag/det
                p=x.point(t);q=y.point(u)
                maxResidual=max(maxResidual,abs(p-q))
                assert t>1e-7 and u>1e-7 and t<1-1e-7 and u<1-1e-7,(name,t,u)
                d=x.derivative(t);v=y.derivative(u)
                assert abs((d.conjugate()*v).imag)>1e-6
                assert min(abs(p-complex(float(c[0]),float(c[1]))) for route in (e,h) for c in (route['segments'][0].controls[0],route['segments'][-1].controls[-1]))>0.01
                if not any(abs(k-p)<1e-6 for k in seen):seen.append(p)
        if seen:found[name]=seen
    retained={tuple(r['edges']) for r in summary[arm]['locations']}
    assert retained==set(found)
    maxDiff=0
    for pair,pts in found.items():
        expected=[complex(r['point'][0][0],r['point'][1][0]) for r in summary[arm]['locations'] if tuple(r['edges'])==pair];assert len(pts)==len(expected),(arm,pair,pts,expected,maxResidual)
        for p in pts:
            diff=min(abs(p-q) for q in expected);assert diff<0.001,(arm,pair,diff);maxDiff=max(maxDiff,diff)
    result[arm]=dict(sha256=sha,incidences=sum(map(len,found.values())),pairs=len(found),maximumCoordinateDisagreement=maxDiff,maximumPointResidual=maxResidual,rawSubdivisionSeeds=rawSeeds,maximumRawResidual=rawMax)
p=src.files['pele'];x=ET.fromstring(gzip.open(p,'rb').read());ends=[]
for n in x.iter():
    if n.get('class')!='pele-edge':continue
    last=src.path_groups(n[0].get('d'))[-1][-1];nums=re.findall(src.num,n[1].get('d'));tip=(float(nums[0]),float(nums[1]));ends.append(math.dist([float(r) for r in last],tip))
result['pele']['shaftEndpointToSeparateMarkerFirstVertexRange']=[min(ends),max(ends)]
result['libraryVersion']=importlib.metadata.version('svgpathtools')
(root/'curve-independent-check.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
