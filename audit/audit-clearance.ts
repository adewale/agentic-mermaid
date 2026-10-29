import { join } from 'node:path'
const rendererRoot=process.env.RENDERER_ROOT??process.cwd()
await import(join(rendererRoot,'src/index.ts'))
const {allConformanceSources,FAMILY_CONFORMANCE_PROFILES} = await import(join(rendererRoot,'src/__tests__/helpers/family-conformance-profiles.ts'))
const {resolveRenderRequestForExecution} = await import(join(rendererRoot,'src/render-contract.ts'))
const {positionFamilyForNativeRender} = await import(join(rendererRoot,'src/positioning.ts'))
const {renderPositionedMermaidSVG} = await import(join(rendererRoot,'src/graphical-render.ts'))
const {createScenePartCapture} = await import(join(rendererRoot,'src/scene/part-capture.ts'))
const {connectorMarkerPaintRegions} = await import(join(rendererRoot,'src/scene/bounds.ts'))
const {connectorSubpaths} = await import(join(rendererRoot,'src/scene/connector-geometry.ts'))
import {writeFileSync,mkdirSync} from 'node:fs'
const phase=process.argv[2]??'base';const out=process.env.OUTPUT_DIR??'/tmp/arrowhead-audit'; const results:any[]=[];mkdirSync(out,{recursive:true})
let sources=allConformanceSources().filter(x=>phase==='corpus'?x.stratum==='corpus-outlier':x.stratum!=='corpus-outlier')
if(phase!=='corpus')for(const [family,p] of Object.entries(FAMILY_CONFORMANCE_PROFILES))sources.push({family,id:family+':citizenship',source:p.citizenship.source,options:p.citizenship.options} as any)
if(phase==='docs')sources=(await Bun.file(join(rendererRoot,'eval/mermaid-docs-corpus/corpus.json')).json()).map((x:any)=>({...x,id:'docs-'+x.family+'-'+x.index,options:{}}))
if((phase==='elk'||phase==='agentic'))for(let i=sources.length-1;i>=0;i--)if(!['flowchart','state','class','architecture','c4','requirement'].includes(sources[i]!.family))sources.splice(i,1)
const styles=[{id:'default',style:undefined},{id:'publication',style:'publication-figure'},{id:'large-markers',style:{roles:{edge:{lineWidth:3,bendRadius:20}}}}]
function visit(node:any,fn:any){if(node.kind==='connector')fn(node);if(node.kind==='group')for(const child of node.children)visit(child.node,fn)}
for(const fixture of sources){for(const look of (phase==='docs'?styles.slice(0,2):styles)){const row:any={id:fixture.id, family:fixture.family,look:(phase==='elk'||phase==='agentic')?phase+'-'+look.id:look.id,marked:0,arrows:0,curved:0,short:[]};try{
const options:any={...fixture.options, ...(look.style?{style:look.style}:{}),embedFontImport:false,...((phase==='elk'||phase==='agentic')?{graphLayout:{backend:phase,fallback:'none'}}:{}),...(fixture.family==='gantt'?{gantt:{dependencyArrows:true}}:{})}
const request=resolveRenderRequestForExecution(fixture.source,options,'svg');const layout=positionFamilyForNativeRender(request);const capture=createScenePartCapture();const rendered=renderPositionedMermaidSVG(request,layout,[],capture)
if(!capture.scene)throw Error('No Scene capture')
for(const part of capture.scene.parts)visit(part,(mark:any)=>{
 if(mark.relationship?.kind==='marker-carrier')return
 const geometry=mark.route.geometry;const subpaths=connectorSubpaths(geometry);const region=connectorMarkerPaintRegions(mark)
 for(const pos of ['start','end'] as const){const marker=mark.markers[pos];if(!marker)continue;row.marked++
 if(!['arrow','open-arrow','triangle'].includes(marker.shape))continue;row.arrows++
 for(const subpath of subpaths){let points=subpath.points;if(pos==='end')points=[...points].reverse();const anchor=points[0];if(!anchor||points.length<2)continue
 const tangent=pos==='start'?mark.route.contours?.[0]?.startTangent:mark.route.contours?.at(-1)?.endTangent
 const raw=tangent?{x:tangent.x*(pos==='start'?1:-1),y:tangent.y*(pos==='start'?1:-1)}:{x:points[1].x-anchor.x,y:points[1].y-anchor.y};const len=Math.hypot(raw.x,raw.y);const ray={x:raw.x/len,y:raw.y/len}
 let straight=0;for(const p of points.slice(1)){const dx=p.x-anchor.x,dy=p.y-anchor.y,along=dx*ray.x+dy*ray.y;if(Math.abs(dx*ray.y-dy*ray.x)>1e-6||along<straight-1e-6)break;straight=along}
 const support=region.find((r:any)=>r.position===pos)?.bounds;if(!support)continue
 const depth=Math.max(...[support.x0,support.x1].flatMap(x=>[support.y0,support.y1].map(y=>(x-anchor.x)*ray.x+(y-anchor.y)*ray.y)))
 const curve=geometry.kind==='path'&&/[QCqc]/.test(geometry.d);if(curve)row.curved++
 if(straight+1e-5<depth+4 && subpath.points.length>2){row.short.push({connector:mark.id,position:pos,shape:marker.shape,marker:marker.id,straight,depth,deficit:depth-straight,curve,geometry,points:subpath.points,stroke:mark.stroke,markerResource:marker})}
 }
 }
})
if(row.short.length){const name=(phase+'-'+fixture.id+'-'+look.id).replace(/[^\w.-]/g,'_');writeFileSync(out+'/'+name+'.svg',rendered.svg);row.source=fixture.source;row.options=options;row.svg=name+'.svg'}
}catch(e){row.error=String(e)}results.push(row)}
console.log('done',fixture.id)}
writeFileSync(out+'/results-'+phase+'.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({id:r.id,look:r.look,marked:r.marked,arrows:r.arrows,short:r.short.length,error:r.error})),null,2))
