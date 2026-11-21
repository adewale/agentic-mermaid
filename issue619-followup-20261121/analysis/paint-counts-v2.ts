import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import {isDeepStrictEqual} from 'node:util'
const root='/workspace/elk-layered-port',out=import.meta.dir
const sha=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex')
const files:Record<string,string>={}
let active:{id:string;projections:any[];contexts:any[];probes:any[]}|undefined
const roster=new WeakMap<object,any>()
const audit=(globalThis as any).__paintCounts={
 project(edges:unknown[],merging:boolean){if(!active)return;const proj={ordinal:active.projections.length+1,merge:merging,audits:0,closes:0};roster.set(edges,proj);active.projections.push(proj)},
 opening(edges:unknown[],nodes:number,handoff:unknown){assert.ok(active);const proj=roster.get(edges);assert.ok(proj);const c={projection:proj.ordinal,mode:handoff==='prepare'?'prepare':handoff?'consume':'fresh',edges:edges.length,nodes,prior:false,bodyRowsReused:0,initial:true,initCalls:0,initRebuilt:0,initReused:0,postCalls:0,postRebuilt:0,postReused:0,completed:false,outputRows:0,initialChanged:[] as number[]};active.contexts.push(c);return c},
 refresh(c:any,what:'Calls'|'Rebuilt'|'Reused',ix?:number){c[(c.initial?'init':'post')+what]++;if(c.initial&&c.mode==='consume'&&what==='Rebuilt')c.initialChanged.push(ix)},
 hitch(edges:unknown[],close:boolean){roster.get(edges)[close?'closes':'audits']++}
}
function once(src:string,needle:string,patch:string){assert.equal(src.split(needle).length,2,needle);return src.replace(needle,patch)}
Bun.plugin({name:'count-protected-paint-on-owned-sources',setup(build){
 build.onLoad({filter:/\/(?:graph-paint-support|layout-engine|route-contracts)\.ts$/},async ({path:p})=>{
  const pc=path.relative(root,p);assert.ok(['src/layout/graph-paint-support.ts','src/layout-engine.ts','src/route-contracts.ts'].includes(pc));let s=fs.readFileSync(p,'utf8');files[pc]=sha(s);const A='globalThis.__paintCounts'
  if(pc==='src/layout-engine.ts')s=once(s,'const edges = createLayoutRouteEdges(style)','const edges = createLayoutRouteEdges(style)\n  '+A+'.project(edges,mergeEdges)')
  else if(pc==='src/route-contracts.ts')s=once(s,"  // Reuse the producer's priority and occupancy rules with the final certified", '  '+A+".hitch(positioned.edges,close)\n  // Reuse the producer's priority and occupancy rules with the final certified")
  else {
   s=once(s,"  const previous = retain && handoff instanceof LabelSeatPaintSupports ? handoff.take() : undefined","  const __d = "+A+".opening(edges,nodes.length,handoff)\n  const previous = retain && handoff instanceof LabelSeatPaintSupports ? handoff.take() : undefined")
   s=once(s,'  const bodies: AxisAlignedBox[] = [], headers: AxisAlignedBox[] = []', '  __d.prior=Boolean(prior)\n  const bodies: AxisAlignedBox[] = [], headers: AxisAlignedBox[] = []')
   s=once(s,'      bodies.push(prior.bodies[index]!)','      __d.bodyRowsReused++\n      bodies.push(prior.bodies[index]!)')
   s=once(s,'    const edge = points === owner.points ? owner : { ...owner, points }','    '+A+'.refresh(__d,"Calls");\n    const edge = points === owner.points ? owner : { ...owner, points }')
   s=once(s,'      measuredShafts.retain(owner, points, saved.ink.shafts)','      '+A+'.refresh(__d,"Reused");\n      measuredShafts.retain(owner, points, saved.ink.shafts)')
   s=once(s,'    const ink = edgeInk(edge, style, () => pay(1), shafts)','    '+A+'.refresh(__d,"Rebuilt",owner.edgeIndex);\n    const ink = edgeInk(edge, style, () => pay(1), shafts)')
   s=once(s,'  for (const edge of edges) if (!refreshRoute(edge)) return undefined','  for (const edge of edges) if (!refreshRoute(edge)) return undefined\n  __d.initial=false; __d.completed=true; __d.outputRows=prepared?.size??0')
  }
  return {loader:'ts',contents:s}
 })
}})
const api=await import('/workspace/elk-layered-port/src/index.ts')
const cases=JSON.parse(fs.readFileSync('/tmp/issue619-implementation-20261120/v13-pipeline/qualification-final/plan.json','utf8')).cases
const ids=['cyclic-labelled-19','cyclic-labelled-9-chains','flowchart-multigraph24']
const result=[]
for(const id of ids){
 const job=cases.find((x:any)=>x.id===id);active={id,projections:[],contexts:[],probes:[]}
 const expected=fs.readFileSync('/tmp/issue619-kink-20261120/renders/'+id+'.svg')
 const p=api.renderMermaidSVGWithReceipt(job.source,job.elkOptions)
 assert.equal(sha(job.source),job.sourceSha256);assert.equal(sha(p.svg),sha(expected),id+' complete SVG')
 assert.equal(p.receipt.layoutCertification?.status,'passed')
 const referenceReceipt=JSON.parse(fs.readFileSync('/tmp/issue619-kink-20261120/renders/'+id+'.receipt.json','utf8'))
 result.push({...active,completeReceiptEqual:isDeepStrictEqual(p.receipt,referenceReceipt),source:job.sourceSha256,svg:sha(p.svg),oldSvgEqual:true,receiptPaint:p.receipt.layoutCertification?.status})
 console.log(JSON.stringify({id,projections:active.projections,contexts:active.contexts}))
}
assert.equal(Object.keys(files).length,3)
fs.writeFileSync(path.join(out,'paint-counts-v2.json'),JSON.stringify({method:'Three complete source public SVG-with-receipt calls with counting-only Bun loader substitutions. No clock samples. Old full SVG byte equality required per returned case. Phase initialization counts count each actual reused or recomputed edge once per admitted projection.',files,result},null,2)+'\n')
