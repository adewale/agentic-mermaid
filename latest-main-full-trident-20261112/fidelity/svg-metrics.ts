// Same strict linear-route domain and counters as the existing
// trinity-class-scopes-20261109/metrics.ts observer. No acceptance gate.
import {countPolylineCrossings} from '/tmp/pr449-main-integration-20261029-762/src/shared/edge-crossings.ts'
import {countOpposingRouteOverlaps,countParallelRouteOverlaps} from '/tmp/pr449-main-integration-20261029-762/src/layout-rubric.ts'
export function inspectSvgRouteMetrics(){
 const svg=document.querySelector('svg');if(!svg)return {status:'unavailable',reason:'No actual SVG'}
 const v=(svg.getAttribute('viewBox')??'').trim().split(/[ ,]+/).map(Number),number=(s:string|null)=>s!==null&&/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?(?:px)?$/i.test(s)?Number.parseFloat(s):undefined
 const width=v.length===4&&v.every(Number.isFinite)&&v[2]!>0?v[2]:number(svg.getAttribute('width')),height=v.length===4&&v.every(Number.isFinite)&&v[3]!>0?v[3]:number(svg.getAttribute('height'))
 const routes:any[]=[]
 for(const el of svg.querySelectorAll('line,polyline,path')){
  if(el.closest('defs,marker,clipPath,mask,symbol'))continue
  const role=el.getAttribute('data-role'),klass=el.getAttribute('class')??''
  if(role!=='edge'&&klass!=='class-relationship')continue
  let hidden=false,transformed=false,lengthPreserving=true
  for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)hidden=true;if(s.transform&&s.transform!=='none'){transformed=true;try{const m=new DOMMatrix(s.transform);if(!m.is2D||Math.abs(m.a*m.a+m.b*m.b-1)>1e-8||Math.abs(m.c*m.c+m.d*m.d-1)>1e-8||Math.abs(m.a*m.c+m.b*m.d)>1e-8)lengthPreserving=false}catch{lengthPreserving=false}}if(p===svg)break}
  const s=getComputedStyle(el);if(hidden||s.stroke==='none'||Number(s.strokeOpacity)===0||!(Number.parseFloat(s.strokeWidth)>0))continue
  let browserLength:number|undefined;try{const n=(el as SVGGeometryElement).getTotalLength();if(Number.isFinite(n)&&lengthPreserving)browserLength=n}catch{}
  routes.push({tag:el.localName,source:el.getAttribute('data-from'),target:el.getAttribute('data-to'),points:el.getAttribute('points'),d:el.getAttribute('d'),x1:el.getAttribute('x1'),y1:el.getAttribute('y1'),x2:el.getAttribute('x2'),y2:el.getAttribute('y2'),transformed,lengthPreserving,browserLength})
 }
 return {status:'observed',width:width??null,height:height??null,area:width!==undefined&&height!==undefined?width*height:null,viewportScope:v.length===4?'actual viewBox SVG units':'positive numeric SVG width/height',routes}
}
export function linearSvgMetrics(observed:any,expected:any){
 if(observed?.status!=='observed')return {status:'unavailable',reason:observed?.reason??'Observer unavailable'}
 const out:any={width:observed.width,height:observed.height,area:observed.area,viewportScope:observed.viewportScope,ownedCarriers:observed.routes.length,contactCounts:{status:'unavailable',reason:'No enrolled exact SVG node-boundary contact observer'},browserCenterline:{status:'unavailable'}}
 if(observed.routes.length&&observed.routes.every((r:any)=>r.source&&r.target&&r.browserLength!==undefined))out.browserCenterline={status:'measured',value:observed.routes.reduce((sum:number,r:any)=>sum+r.browserLength,0),scope:'Browser getTotalLength sum in local SVG units, only length-preserving ancestor transforms; curve length is browser approximation, excludes markers/labels'}
 if(!observed.routes.length){out.linear={status:'unavailable',reason:expected.edges?.length?'Authored relationships have no enrolled owned SVG carriers':'No enrolled owned SVG edge carriers; not a zero-crossing assertion'};return out}
 const edges:any[]=[];let wire=0,bends=0
 for(const r of observed.routes){
  if(!r.source||!r.target||r.transformed){out.linear={status:'unavailable',reason:!r.source||!r.target?'Missing explicit edge endpoint ownership':'Transforms outside existing strict linear observer'};return out}
  let xy:number[]
  if(r.tag==='line')xy=[r.x1,r.y1,r.x2,r.y2].map((v:any)=>v===null?NaN:Number(v))
  else {const text=r.points??r.d;if(!text||r.d&&(/[^ML\s,0-9.eE+\-]/.test(text)||/[a-df-z]/.test(text)||(text.match(/M/g)??[]).length!==1)){out.linear={status:'unavailable',reason:'Curved, relative, or unsupported path command'};return out}xy=(text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)??[]).map(Number)}
  if(xy.length<4||xy.length%2||!xy.every(Number.isFinite)){out.linear={status:'unavailable',reason:'Unsupported/malformed linear coordinates'};return out}
  const points=Array.from({length:xy.length/2},(_,i)=>({x:xy[i*2]!,y:xy[i*2+1]!}));let last=''
  for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,n=Math.hypot(b.x-a.x,b.y-a.y);if(!n)continue;wire+=n;const axis=a.x===b.x?'v':a.y===b.y?'h':'diagonal';if(axis==='diagonal'){out.linear={status:'unavailable',reason:'Nonorthogonal route outside existing observer'};return out}if(last&&axis!==last)bends++;last=axis}
  edges.push({source:r.source,target:r.target,style:'solid',points})
 }
 out.linear={status:'measured',edges:edges.length,wire,bends,crossings:countPolylineCrossings(edges),parallelOverlaps:countParallelRouteOverlaps(edges),opposingOverlaps:countOpposingRouteOverlaps(edges),scope:'Existing strict untransformed orthogonal absolute M/L, polyline, or line SVG observer; authored-endpoint crossing exclusions retained'};return out
}
