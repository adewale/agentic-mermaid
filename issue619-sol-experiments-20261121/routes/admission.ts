import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const root='/workspace/elk-layered-port',out=path.join(import.meta.dir,process.env.ADMISSION_GUARD==='1'?'admission-guarded':'admission')
fs.mkdirSync(out,{recursive:true})
const once=(s:string,n:string,r:string)=>{assert.equal(s.split(n).length,2,n);return s.replace(n,r)}
Bun.plugin({name:'scratch-remove-blanket-duplicate-veto',setup(build){build.onLoad({filter:/\/(?:layout-engine|non-regressing-alternative)\.ts$/},({path:p})=>{let s=fs.readFileSync(p,'utf8');if(p.endsWith('/layout-engine.ts')){s=once(s,'&& !hasParallelPair(graph.edges)) {','&& (globalThis.__admitParallel || !hasParallelPair(graph.edges))) {');if(process.env.ADMISSION_GUARD==='1'){s="import { alternativeAdmission } from '/workspace/elk-layered-tools/issue619-sol-experiments-20261121/routes/admission-guard.ts'\n"+s;s=once(s,'result.certified && optimization.nonRegressingAlternative(selected, result.certified.positioned)','result.certified && alternativeAdmission(selected, result.certified.positioned, style) && optimization.nonRegressingAlternative(selected, result.certified.positioned)')}}else s=once(s,'  const a = vector(first, firstMetrics), b = vector(other, otherMetrics)','  const a = vector(first, firstMetrics), b = vector(other, otherMetrics)\n  globalThis.__candidateVectors?.push({a,b,first,other})');return {contents:s,loader:'ts'}})}})
const {snapshotSample}=await import('/workspace/elk-layered-port/eval/layout-compare/run.ts')
const {verifyMermaid}=await import('/workspace/elk-layered-port/src/agent/index.ts')
const CROSSING='flowchart TD\nA[One]\nB[Two]\nC[Three]\nD[Four]\nA --> D\nB --> C'
const cases=[
{id:'duplicate-unlabelled',source:CROSSING+'\nA --> D'},
{id:'duplicate-mixed',source:CROSSING+'\nA -->|second| D'},
{id:'duplicate-labelled',source:CROSSING.replace('A --> D','A -->|first| D')+'\nA -->|second| D'},
{id:'duplicate-opposing',source:CROSSING+'\nA --> D\nD --> A'},
{id:'explicit-adjacency',source:CROSSING+'\nA --> D',options:{layoutHints:{adjacent:[['A','B','C','D']]}}},
{id:'unicode-edit',source:(CROSSING+'\nA --> D\nD --> A').replace('One','登录 Ω').replace('Four','保存 é')},
{id:'caption-marker-edit',source:(CROSSING+'\nA --> D\nD --> A').replace('B --> C','B -->|audit| C').replace('D --> A','D -.-> A')},
{id:'clear-duplicate',source:'flowchart TD\nA[One] --> D[Four]\nA --> D'},
]
const wanted=process.env.ADMISSION_CASES?.split(',')
const rows=[]
for(const item of cases.filter(c=>!wanted||wanted.includes(c.id))){
 const results:any={}
 for(const mode of [process.env.ADMISSION_MODE??'incumbent']){
  ;(globalThis as any).__admitParallel=mode==='admitted';(globalThis as any).__candidateVectors=[];(globalThis as any).__admissionGuard=[]
  const options={...item.options,graphLayout:{backend:'elk',quality:'balanced'}}
  const result=snapshotSample({id:item.id,family:'flowchart',source:item.source},'admission-exp-',options as any,{includeAscii:false})
  const vectors=(globalThis as any).__candidateVectors
  const trace=vectors.map((v:any)=>({before:v.a,after:v.b,rejectedBy:v.a.map((a:number,k:number)=>v.b[k]>a+Math.max(1,Math.abs(a))*1e-8?k:null).filter((k:any)=>k!==null),beforeGraph:v.first,afterGraph:v.other}))
  const verify=verifyMermaid(item.source,{renderOptions:options as any})
  const guard=(globalThis as any).__admissionGuard;const artifact={...result,svg:undefined,verify,trace,guard};fs.writeFileSync(path.join(out,item.id+'-'+mode+'.json'),JSON.stringify(artifact,null,2)+'\n');if(result.svg)fs.writeFileSync(path.join(out,item.id+'-'+mode+'.svg'),result.svg)
  results[mode]={guard,ok:result.ok,metric:result.metrics,paint:result.svgReceipt?.layoutCertification,optimization:result.svgReceipt?.layoutOptimization,sha:result.svg&&createHash('sha256').update(result.svg).digest('hex'),trace:trace.map(({beforeGraph,afterGraph,...t}:any)=>t)}
 }
 rows.push({id:item.id,source:item.source,...results});console.log(JSON.stringify(rows.at(-1)))
}
fs.writeFileSync(path.join(out,(process.env.ADMISSION_MODE??'incumbent')+'-summary.json'),JSON.stringify(rows,null,2)+'\n')
