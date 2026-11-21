"""Load only saved connector geometry. No renderer or sampler is invoked."""
from collections import Counter
from dataclasses import dataclass
from fractions import Fraction as Q
from pathlib import Path
from xml.etree import ElementTree as ET
import gzip, hashlib, itertools, json, re
history=Path('/workspace/elk-layered-tools/pr616-native-history-20261117')
source=(history/'inputs/cyclic-labelled-19.mmd').read_bytes()
memory=Path('/tmp/issue619-implementation-20261120/memory-svg/results/cache0-pele-public-cyclic-labelled-19-0')
assert json.loads(memory.with_suffix('.job.json').read_text())['source'].encode()==source
ROOT=Path(__file__).parent
files={name:history/'renders'/f'cyclic-labelled-19-{name}.svg' for name in ['native','elkjs-current','elkts','zombie']}
files['pele']=memory/'warmup.svg.gz'
files['c790']=Path('/tmp/issue619-kink-20261120/renders/cyclic-labelled-19.svg')
files['f491-elkjs']=Path('/tmp/issue619-followup-20261121/astra-algorithms/same-wrapper-js.svg')
files['f491-elkts']=Path('/tmp/issue619-followup-20261121/astra-algorithms/same-wrapper-ts.svg')
assert files['c790'].read_bytes()==files['f491-elkjs'].read_bytes()==files['f491-elkts'].read_bytes()
def h(data): return hashlib.sha256(data).hexdigest()
def tag(e):return e.tag.split('}')[-1]
def sub(p,q):return(p[0]-q[0],p[1]-q[1])
def dot(p,q):return p[0]*q[0]+p[1]*q[1]
def cross(p,q):return p[0]*q[1]-p[1]*q[0]
def intersects(a,b):return all(a[k]<=b[k+2] and b[k]<=a[k+2] for k in (0,1))
@dataclass
class Seg:
    controls:tuple
    bounds:tuple
    line:bool
    i:int
    def revs(self):return self.controls[::-1]
def segs(groups):
    result=[]
    for controls in groups:
        if all_equal(controls):continue
        d=sub(controls[-1],controls[0]);steps=[sub(b,a) for a,b in zip(controls,controls[1:])]
        collinear=d!=(0,0) and all(cross(d,s)==0 for s in steps)
        if collinear and not all(dot(d,s)>=0 for s in steps):raise ValueError(('retrace',controls))
        coords=list(zip(*controls))
        bounds=(min(coords[0]),min(coords[1]),max(coords[0]),max(coords[1]))
        result.append(Seg(tuple(controls),bounds,collinear,len(result)))
    return result
all_equal=lambda x:all(v==x[0] for v in x)
num=r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?'
scan=re.compile(r'[A-Za-z]|'+num)
def path_groups(s):
    assert not re.sub(r'[\s,]','',scan.sub('',s))
    parts=scan.findall(s);at=0;p=None;out=[]
    while at<len(parts):
        op=parts[at];at+=1;size={'M':1,'L':1,'Q':2,'C':3}[op]
        ctrl=[]
        for i in range(size):
            ctrl.append((Q(parts[at]),Q(parts[at+1])));at+=2
        if op=='M':assert p is None
        else:out.append((p,*ctrl))
        p=ctrl[-1]
    return out
def poly_groups(s):
    p=[tuple(Q(n) for n in item.split(',')) for item in s.split()]
    return list(zip(p,p[1:]))
def read(name):
    p=files[name];svg=gzip.open(p,'rb').read() if p.suffix=='.gz' else p.read_bytes()
    r=ET.fromstring(svg);parents={c:n for n in r.iter() for c in n}
    sr=list(re.finditer(r'^(n\d+) -->\s*(?:\|([^|]*)\|\s*)?(n\d+)$',source.decode(),re.M));assert len(sr)==44
    output=[];occ=Counter()
    if name=='pele':
        groups=[e for e in r.iter() if tag(e)=='g' and e.get('class')=='pele-edge'];assert len(groups)==44
        shapes=[next(e for e in g if tag(e)=='path' and e.get('class') is None) for g in groups]
        assert all(sum(1 for e in g if e.get('class')=='pele-marker')==1 for g in groups)
    else:
        shapes=[e for e in r.iter() if tag(e) in ('path','polyline') and e.get('marker-end') and e.get('data-from') is not None]
    assert len(shapes)==len(sr),(name,len(shapes))
    pele_labels={elem.get('data-id'):''.join(elem.itertext()).strip() for elem in r.iter() if elem.get('class')=='pele-edge-label'}
    seen_ids=set()
    for ix,(e,row) in enumerate(zip(shapes,sr)):
        a,label,b=row.groups(); k=(a,b);n=occ[k];occ[k]+=1
        if name=='pele':
            key=parents[e].get('data-id')
            assert re.fullmatch(f'L_{a}_{b}_[0-9]+',key) and key not in seen_ids,(name,ix,key,k)
            assert pele_labels.get(key)==label,(ix,pele_labels.get(key),label)
            seen_ids.add(key)
        else:assert (e.get('data-from'),e.get('data-to'),e.get('data-label'))==(a,b,label),(name,ix)
        attrs=[];v=e
        while v is not None:
            attrs.append(v.attrib)
            assert v.get('transform') is None,(name,'transform')
            assert v.get('display')!='none' and v.get('visibility')!='hidden'
            v=parents.get(v)
        groups=path_groups(e.get('d')) if tag(e)=='path' else poly_groups(e.get('points'))
        output.append({'id':f'{a}->{b}'+(f'#{n}' if n else ''),'segments':segs(groups),'label':label,'authoredIndex':ix})
    return h(svg),output
if __name__=='__main__':
    print('source',h(source))
    for name in files:
        sha,es=read(name);print(name,sha)
        counts=Counter(); types=Counter()
        for e in es:types.update((len(s.controls)-1,s.line) for s in e['segments'])
        for a,b in itertools.combinations(es,2):
            for p,q in itertools.product(a['segments'],b['segments']):
                if intersects(p.bounds,q.bounds):counts[(p.line,q.line)]+=1
        print(types,counts)
