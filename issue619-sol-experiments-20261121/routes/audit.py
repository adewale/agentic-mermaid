import json,xml.etree.ElementTree as ET,hashlib,os
p=os.path.dirname(__file__)+'/admission-guarded/'
rows={}
for mode in ['incumbent','admitted']:
 d=json.load(open(p+'duplicate-opposing-'+mode+'.json'));svg=open(p+'duplicate-opposing-'+mode+'.svg').read();root=ET.fromstring(svg)
 ink=[]
 for e in root.iter():
  if e.get('data-role')=='edge':
   ink.append({k:e.get(k) for k in ['data-id','data-from','data-to','data-arrow-start','data-arrow-end','data-marker-end','points','marker-end']})
 def spans(a,b):
  total=0
  for u,v in zip(a,a[1:]):
   for w,z in zip(b,b[1:]):
    for m,c in [(0,1),(1,0)]:
     if abs(u[c]-v[c])<.01 and abs(w[c]-z[c])<.01 and abs(u[c]-w[c])<.01:
      total+=max(0,min(max(u[m],v[m]),max(w[m],z[m]))-max(min(u[m],v[m]),min(w[m],z[m])))
  return total
 edges=d['layout']['edges'];pairs=[]
 for i,e in enumerate(edges):
  for f in edges[:i]:
   n=spans(e['path'],f['path'])
   if n>.01:pairs.append([e['id'],f['id'],n])
 rows[mode]={'svgSha256':hashlib.sha256(svg.encode()).hexdigest(),'nodeLabels':[[n['id'],n['label']] for n in d['layout']['nodes']],'edges':[[e['id'],e['from'],e['to'],e['path'],e['route']] for e in edges],'svgOwnedInk':ink,'sharedSpans':pairs,'paint':d['svgReceipt']['layoutCertification'],'meaning':{'ok':d['verify']['ok'],'checks':d['verify']['checks'],'warnings':d['verify']['warnings']}}
assert rows['incumbent']['nodeLabels']==rows['admitted']['nodeLabels']
assert [r[:3] for r in rows['incumbent']['edges']]==[r[:3] for r in rows['admitted']['edges']]
assert rows['admitted']['sharedSpans']==[]
assert len(rows['admitted']['svgOwnedInk'])==4
assert all(e['data-arrow-end']=='true' and e['marker-end'] for e in rows['admitted']['svgOwnedInk'])
rows['scope']='Independent read of completed public paths and actual SVG relationship ink. Every authored occurrence is a separate path and arrow marker reference. Stroke/marker nonocclusion uses complete public paint certification.'
open(p+'winner-ownership-audit.json','w').write(json.dumps(rows,indent=2)+'\n')
print(json.dumps({m:{'sha':r['svgSha256'],'spans':r['sharedSpans'],'edges':len(r['svgOwnedInk']),'markers':r['paint']['checks']['markers'],'paint':r['paint']['status']} for m,r in rows.items() if isinstance(r,dict)}))
