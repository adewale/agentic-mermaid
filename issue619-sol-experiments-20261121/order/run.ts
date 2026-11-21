import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {deserialize} from 'node:v8'
const root='/workspace/elk-layered-port', out=import.meta.dir
const arm=process.argv[2]??'forced'
assert.ok(['forced','unforced','declared-forced','declared-unforced','spacing-forced','spacing-unforced','highdegree-forced','highdegree-unforced','compaction-forced','compaction-unforced','plain-forced','plain-unforced'].includes(arm))
const hash=(s:any)=>createHash('sha256').update(typeof s==='string'?s:JSON.stringify(s)).digest('hex')
const changes:any[]=[]; let active:any
const packets:any[]=[]
const captured={input:JSON.parse(fs.readFileSync(path.join(out,'captured-input.json'),'utf8'))}
const A=(globalThis as any).__orderExperiment={
 input(graph:any){
  const before=structuredClone(graph), after=structuredClone(graph)
  after.layoutOptions['elk.layered.crossingMinimization.forceNodeModelOrder']=arm.endsWith('unforced')?'false':'true'
  if(arm.startsWith('declared-')) after.children.sort((a:any,b:any)=>active.source.indexOf('\n'+a.id)-active.source.indexOf('\n'+b.id))
  if(arm.startsWith('highdegree-')||arm.startsWith('plain-')) after.layoutOptions['elk.layered.highDegreeNodes.treatment']='false'
  if(arm.startsWith('compaction-')||arm.startsWith('plain-')) after.layoutOptions['elk.layered.compaction.postCompaction.strategy']='NONE'
  if(arm.startsWith('spacing-')) for(const k of ['elk.spacing.nodeNode','elk.layered.spacing.nodeNodeBetweenLayers']) after.layoutOptions[k]=String(Number(after.layoutOptions[k])*1.25)
  const control=structuredClone(after);control.layoutOptions=before.layoutOptions;control.children=before.children
  assert.deepStrictEqual(control,before,'boxes, labels, endpoints, occurrences and ports fixed')
  if(!arm.startsWith('declared-'))assert.deepStrictEqual(after.children,before.children,'child array fixed')
  const row={id:active.id,ordinal:packets.length,baselineInputHash:hash(before),actualInputHash:hash(after),archivedInputExact:active.id==='cyclic19'?JSON.stringify(before)===JSON.stringify(captured.input):undefined,children:after.children.map((n:any)=>n.id),input:after}
  packets.push(row);active.inputs.push(row);return after
 },
 cycle(nodes:any[]){active.trace.push({feedback:nodes.flatMap(n=>n.ports.flatMap((p:any)=>p.outgoing.filter((e:any)=>e.reversed).map((e:any)=>e.data.id))).sort()})},
 snap(stage:string,layers:any[]){const trace=active.trace.at(-1);trace[stage]=layers.map(layer=>layer.filter((n:any)=>n.type==='NORMAL').map((n:any)=>n.id))},
 result(result:any){active.rawResults.push(result);return result},
}
function once(s:string,a:string,b:string){assert.equal(s.split(a).length,2,a);return s.replace(a,b)}
Bun.plugin({name:'controlled-order-public-pipeline',setup(build){build.onLoad({filter:/\/(layout-engine|elk-layered\/kernel\/layout)\.ts$/},({path:p})=>{
 let s=fs.readFileSync(p,'utf8');changes.push({file:p,sha256:hash(s)})
 if(p.endsWith('/src/layout-engine.ts'))s=once(s,'  return elkGraph','  return globalThis.__orderExperiment.input(elkGraph)')
 else{
  s=once(s,'  const centerLabels = nodes.some(','  globalThis.__orderExperiment.cycle(nodes)\n  const centerLabels = nodes.some(')
  s=once(s,'  splitLongEdges(layers)','  globalThis.__orderExperiment.snap("ranks",layers)\n  splitLongEdges(layers)')
  s=once(s,'  return data','  return globalThis.__orderExperiment.result(data)')
  s=once(s,'  return finishLayout(prepared)','  globalThis.__orderExperiment.snap("finalOrder",prepared.layers)\n  return finishLayout(prepared)')
 }
 return {loader:'ts',contents:s}
})}})
const {snapshotSample}=await import(root+'/eval/layout-compare/run.ts')
const {countPolylineCrossings}=await import(root+'/src/shared/edge-crossings.ts')
const {countParallelRouteOverlaps}=await import(root+'/src/layout-rubric.ts')
const {countOpposingRouteOverlaps}=await import(root+'/src/shared/edge-overlaps.ts')
const plan=JSON.parse(fs.readFileSync('/tmp/issue619-implementation-20261120/v13-pipeline/qualification-final/plan.json','utf8'))
const source=fs.readFileSync('/tmp/issue619-followup-20261121/evidence-checkout/issue619-followup-20261121/crossings/input.mmd','utf8')
const auth=fs.readFileSync(root+'/src/__tests__/agent-auth-flow.test.ts','utf8').match(/const EXPECTED_AUTH_FLOW_SOURCE = `([\s\S]*?)`/)![1]
const cases=[{id:'cyclic19',source},{id:'cyclic19-label-edit',source:source.replace('edge 12 xxxxxxxxxxxxxxx','edge 12 xxxxxxxxxxxxxxxx')},{id:'cyclic9',source:plan.cases.find((c:any)=>c.id==='cyclic-labelled-9-chains').source},{id:'auth',source:auth}]
const results:any[]=[]
for(const c of cases.filter(c=>!process.env.ORDER_CASES||process.env.ORDER_CASES.split(',').includes(c.id))){
 active={...c,inputs:[],trace:[],rawResults:[]}
 const sample=snapshotSample({...c,family:'flowchart'},'order-', {graphLayout:{backend:'elk'}}, {includeAscii:false})
 const l=sample.layout, edges=l?.edges.map((e:any)=>({...e,source:e.from,target:e.to,points:e.path.map(([x,y]:number[])=>({x,y})),visible:e.visible!==false,style:e.visible===false?'invisible':e.style}))??[]
 const pairs:any[]=[]
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
  const crossing=countPolylineCrossings([edges[i],edges[j]]), parallel=countParallelRouteOverlaps([edges[i],edges[j]]), opposing=countOpposingRouteOverlaps([edges[i],edges[j]])
  if(crossing||parallel||opposing)pairs.push({a:edges[i].id,b:edges[j].id,i,j,crossing,parallel,opposing})
 }
 const raw=active.rawResults.map((r:any)=>({size:[r.width,r.height],crossings:countPolylineCrossings(r.edges.flatMap((e:any)=>(e.sections??[]).map((s:any)=>({points:[s.startPoint,...s.bendPoints??[],s.endPoint]}))))}))
 const meaning=l?{nodes:l.nodes.map((n:any)=>({id:n.id,label:n.label})),edges:l.edges.map((e:any)=>({id:e.id,from:e.from,to:e.to,label:e.label,startMarker:e.startMarker,endMarker:e.endMarker})),authPrimary:c.id==='auth'?['A','B','C','D','E','F','G','H'].map(id=>({id,x:l.nodes.find((n:any)=>n.id===id)?.x})):undefined,authReturns:c.id==='auth'?l.edges.filter((e:any)=>['C->B','F->E'].includes(e.id)).map((e:any)=>({id:e.id,start:e.path[0],end:e.path.at(-1)})):undefined}:undefined
 const summary={id:c.id,arm,ok:sample.ok,sourceHash:hash(c.source),svgHash:sample.svg?hash(sample.svg):undefined,size:l?[l.bounds.w,l.bounds.h]:undefined,metrics:sample.metrics,paint:sample.svgReceipt?.layoutCertification,error:sample.error,raw,trace:active.trace,meaning,pairs,inputs:active.inputs.map(({input,...r}:any)=>r)}
 fs.writeFileSync(path.join(out,arm+'-'+c.id+'.json'),JSON.stringify({summary,sample},null,2)+'\n')
 if(sample.svg)fs.writeFileSync(path.join(out,arm+'-'+c.id+'.svg'),sample.svg)
 results.push(summary);fs.writeFileSync(path.join(out,arm+'-summary.json'),JSON.stringify({scope:'Full public snapshotSample with source-loader switch only. Instrumented diagnostic, no performance claim. Every failure retained. Actual SVG and layout receipts retained; public quality crossings measure projected public polylines.',arm,changes,results},null,2)+'\n')
 console.log(JSON.stringify({id:c.id,arm,ok:sample.ok,crossings:sample.metrics?.edgeCrossings,overlaps:sample.metrics?.routeOverlaps,route:sample.metrics?.routeGeometry,size:summary.size,paint:summary.paint?.status,raw,error:sample.error}))
}
fs.writeFileSync(path.join(out,arm+'-inputs.json'),JSON.stringify(packets,null,2)+'\n')
