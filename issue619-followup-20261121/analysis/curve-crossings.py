"""Exact decimal/interval diagnostic for these archived centerlines, separately from Trident."""
import functools, importlib.util, sys
from collections import Counter
from dataclasses import dataclass
from fractions import Fraction as Q
from itertools import combinations, product
from math import atan2, comb, hypot, pi
import json
from pathlib import Path
import sympy as sp
root=Path(__file__).parent
spec=importlib.util.spec_from_file_location('curve_inputs',root/'curve-inputs.py')
inp=importlib.util.module_from_spec(spec);sys.modules['curve_inputs']=inp;spec.loader.exec_module(inp)
T,U=sp.symbols('t u')
tol=sp.Rational(1,10**22)
def exact(x):return (Q(x),Q(x))
def f(x):return Q(int(x.p),int(x.q))
def sf(v):return sp.Rational(v.numerator,v.denominator)
def add(x,y):return(x[0]+y[0],x[1]+y[1])
def neg(x):return(-x[1],-x[0])
def mul(x,y):
    z=[i*j for i in x for j in y];return(min(z),max(z))
def div(x,y):
    if y[0]<=0<=y[1]:return None
    return mul(x,(1/y[1],1/y[0]))
def sub(x,y):return add(x,neg(y))
def mid(x):return(x[0]+x[1])/2
def common(x,y):
    v=(max(x[0],y[0]),min(x[1],y[1]));return v if v[0]<=v[1] else None
def sq(x):return(Q(0) if x[0]<=0<=x[1] else min(v*v for v in x),max(v*v for v in x))
def horner(coeff,v):
    out=exact(0)
    for c in reversed(coeff):out=add(mul(out,v),exact(c))
    return out
def axes(c):
    n=len(c)-1
    return tuple(tuple(comb(n,k)*sum((-1)**(k-j)*comb(k,j)*c[j][d] for j in range(k+1)) for k in range(n+1)) for d in range(2))
def deriv(c):return tuple(k*v for k,v in enumerate(c) if k)
@functools.cache
def curve(c):return axes(c)
def point(c,v):return tuple(horner(a,v) for a in curve(c))
def vel(c,v):return tuple(horner(deriv(a),v) for a in curve(c))
def expr(c,var):return sum(sf(a)*var**k for k,a in enumerate(c))
def polynomial(c,var):return sp.Poly(expr(c,var),var,domain=sp.QQ)
def roots(poly):
    return [((f(l),f(r)),int(n)) for ((l,r),n) in poly.intervals(inf=0,sup=1,eps=tol)]
def test_param(z):
    if z is None:return 'unknown'
    if z[1]<0 or z[0]>1:return 'outside'
    if z[0]>=0 and z[1]<=1:return 'inside'
    return 'unknown'
def coord_if_endpoint(s,p):
    if p==exact(0):return s.controls[0]
    if p==exact(1):return s.controls[-1]
def line_line(a,b): 
    p,q=a.controls[0],a.controls[-1];r,s=b.controls[0],b.controls[-1]
    A=inp.sub(q,p);B=inp.sub(s,r);D=inp.sub(r,p);det=inp.cross(A,B)
    if det:
        t=inp.cross(D,B)/det;u=inp.cross(D,A)/det
        return ([(exact(t),exact(u))] if 0<=t<=1 and 0<=u<=1 else []),[]
    if inp.cross(D,A):return [],[]
    k=0 if A[0] else 1
    v=sorted([(r[k]-p[k])/A[k],(s[k]-p[k])/A[k]])
    v=(max(Q(0),v[0]),min(Q(1),v[1]))
    if v[0]>v[1]:return [],[]
    if v[0]<v[1]:return [],['collinear span']
    t=v[0];u=(p[k]+t*A[k]-r[k])/B[k]
    return [(exact(t),exact(u))],[]
def curve_line(a,b):
    p,q=b.controls[0],b.controls[-1];B=inp.sub(q,p);k=0 if B[0] else 1
    x,y=curve(a.controls)
    coeff=[z*B[1]-w*B[0] for z,w in zip(x,y)]
    coeff[0]-=p[0]*B[1]-p[1]*B[0]
    H=polynomial(coeff,T);assert not H.is_zero
    result=[];notes=[]
    for t,n in roots(H):
        cv=point(a.controls,t);u=div(sub(cv[k],exact(p[k])),exact(B[k]))
        kind=test_param(u)
        if kind=='inside':result.append((t,u))
        elif kind=='unknown':notes.append('line boundary unresolved')
    return result,notes
def curve_curve(a,b):
    A=curve(a.controls);B=curve(b.controls)
    P=expr(A[0],T)-expr(B[0],U);R=expr(A[1],T)-expr(B[1],U)
    ss=sp.subresultants(P,R,U)
    if not ss or sp.degree(ss[-1],U)!=0:
        if a.controls in (b.controls,b.controls[::-1]):return [],['identical curved span']
        return [],['same algebraic carrier unresolved']
    H=sp.Poly(ss[-1],T,domain=sp.QQ)
    result=[];notes=[]
    for t,n in roots(H):
        if t[0]==t[1]:
            G=sp.gcd(sp.Poly(P.subs(T,sf(t[0])),U,domain=sp.QQ),sp.Poly(R.subs(T,sf(t[0])),U,domain=sp.QQ))
            result.extend((t,u) for u,m in roots(G) if G.degree()>0);continue
        if len(ss)<2 or sp.degree(ss[-2],U)!=1:
            notes.append('exceptional algebraic degree unresolved');continue
        L=sp.Poly(ss[-2],U)
        def cv(i):
            pol=sp.Poly(L.nth(i),T,domain=sp.QQ)
            return tuple(f(z) for z in reversed(pol.all_coeffs()))
        u=div(neg(horner(cv(0),t)),horner(cv(1),t))
        kind=test_param(u)
        if kind=='inside':result.append((t,u))
        elif kind=='unknown':notes.append('exceptional rational parameter unresolved')
    return result,notes
def pair(a,b):
    if a.line and b.line:return line_line(a,b)
    if not a.line and b.line:return curve_line(a,b)
    if a.line and not b.line:
        vals,notes=curve_line(b,a);return [(t,u) for u,t in vals],notes
    return curve_curve(a,b)
def rays(e,s,t):
    C=s.controls;v=s.i if t==exact(0) else s.i+1 if t==exact(1) else None
    if v is None:
        d=vel(C,t);return [tuple(neg(z) for z in d),d]
    if v==0 or v==len(e['segments']):return None
    prev=e['segments'][v-1].controls;next_=e['segments'][v].controls
    def ray(seq):return tuple(exact(v) for v in inp.sub(next(q for q in seq[1:] if q!=seq[0]),seq[0]))
    return [ray(prev[::-1]),ray(next_)]
def det(x,y):return sub(mul(x[0],y[1]),mul(x[1],y[0]))
def dot(x,y):return add(mul(x[0],y[0]),mul(x[1],y[1]))
def endpoint_check(x,p):return add(*[sq(sub(v,exact(w))) for v,w in zip(x,p)])
def hit(e,v,t,h,w,u):
    va=point(v.controls,t);vb=point(w.controls,u);p=tuple(common(x,y) for x,y in zip(va,vb));assert all(x is not None for x in p),(va,vb)
    for r in (e,h):
        for end in [r['segments'][0].controls[0],r['segments'][-1].controls[-1]]:
            dist=endpoint_check(p,end)
            if dist[1]<=Q(1,10000):return 'physical endpoint',p
            if dist[0]<=Q(1,10000):return 'endpoint tolerance unresolved',p
    rs=rays(e,v,t);ss=rays(h,w,u);assert rs is not None and ss is not None
    interior=all(z!=exact(i) for z in [t,u] for i in (0,1))
    if interior:
        cross=det(rs[1],ss[1])
        if cross[0]>0 or cross[1]<0:return 'proper',p
        if cross==exact(0):return 'tangent',p
        return 'tangency unresolved',p
    gs=[(r,tag) for tag,rays_ in [(0,rs),(1,ss)] for r in rays_]
    gs.sort(key=lambda g:atan2(float(mid(g[0][1])),float(mid(g[0][0]))))
    # The approximate angle only proposes a cyclic order. Exact signs of adjacent
    # cross products certify the orientation, and a normalized lower separation
    # excludes the owner's 1e-9 rad indistinguishable-ray threshold.
    for i,(a,ai) in enumerate(gs):
        b,bi=gs[(i+1)%4];z=det(a,b);d=dot(a,b)
        if d[0]>0:
            if z==exact(0):return 'tangent at join',p
            if z[0]<=0:return 'angular order unresolved',p
            if z[0]<=max(abs(d[0]),abs(d[1]))*Q(11,10**10):return 'angular separation unresolved',p
        elif d[1]>=0 and z[0]<=0:return 'orientation unresolved',p
    if any(gs[i][1]==gs[(i+1)%4][1] for i in range(4)):return 'same-side touch',p
    return 'proper',p
def outward(q,up):
    scale=10**14
    i=-((-q.numerator*scale)//q.denominator) if up else (q.numerator*scale)//q.denominator
    sign='-' if i<0 else ''
    n=abs(i)
    return f'{sign}{n//scale}.{n%scale:014d}'
def main():
    arms={}
    for name in inp.files:
        sha,edges=inp.read(name);count=Counter();locs=[];overlaps=[];unknown=[];min_margin=None
        for e,h in combinations(edges,2):
            hits=[]
            for a,b in product(e['segments'],h['segments']):
                if not inp.intersects(a.bounds,b.bounds):continue
                c,n=pair(a,b);count[f'control boxes {int(a.line)+int(b.line)} linear']+=1
                for note in n:
                    count[note]+=1
                    if 'unresolved' in note:unknown.append([e['id'],h['id'],a.i,b.i,note])
                    else:overlaps.append([e['id'],h['id'],a.i,b.i,note])
                for t,u in c:
                    kind,p=hit(e,a,t,h,b,u);count[kind+' segment events']+=1
                    if 'unresolved' in kind:unknown.append([e['id'],h['id'],a.i,b.i,kind])
                    if kind!='proper':continue
                    old=next((k for k,xy in enumerate(hits) if all(common(c,d) is not None for c,d in zip(xy,p))),None)
                    if old is None:hits.append(p)
                    elif not all(a==b and a[0]==a[1] for a,b in zip(hits[old],p)):unknown.append([e['id'],h['id'],a.i,b.i,'coincidence unresolved'])
            for xy in hits:locs.append({'edges':[e['id'],h['id']],'indices':[e['authoredIndex'],h['authoredIndex']],'point':[[float(z) for z in v] for v in xy],'certifiedCoordinateBounds':[[outward(v[0],False),outward(v[1],True)] for v in xy],'maxIsolationBoxWidth':max(float(v[1]-v[0]) for v in xy)})
        arms[name]=dict(svg=str(inp.files[name]),svgSha256=sha,sourceSha256=inp.h(inp.source),edgeCount=len(edges),authoredLabels=sum(e['label'] is not None for e in edges),segments=sum(len(e['segments']) for e in edges),properIncidences=len(locs),distinctPairs=len(set(tuple(x['edges']) for x in locs)),unresolved=unknown,overlappingSegments=overlaps,counts=count,locations=locs)
        print(name,'proper',len(locs),'unresolved',unknown,'overlapping spans',len(overlaps),flush=True)
    (root/'curve-crossings.json').write_text(json.dumps(arms,indent=2)+'\n')
if __name__=='__main__':main()
