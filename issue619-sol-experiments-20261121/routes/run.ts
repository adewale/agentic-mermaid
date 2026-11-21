import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const root='/workspace/elk-layered-port',out=import.meta.dir,mode=process.env.ROUTE_MODE??'channel'
const once=(s:string,n:string,r:string)=>{assert.equal(s.split(n).length,2,n);return s.replace(n,r)}
Bun.plugin({name:'scratch-atomic-feedback',setup(build){build.onLoad({filter:/\/src\/route-contracts\.ts$/},({path:p})=>{let s=fs.readFileSync(p,'utf8');s="import { transaction as __transaction } from '/workspace/elk-layered-tools/issue619-sol-experiments-20261121/routes/transaction.ts'\n"+s;s=once(s,'  const certificates: RouteCertificate[] = []','  __transaction(ctx)\n  const certificates: RouteCertificate[] = []');return{contents:s,loader:'ts'}})}})
const { snapshotSample }=await import('/workspace/elk-layered-port/eval/layout-compare/run.ts')
const { verifyMermaid }=await import('/workspace/elk-layered-port/src/agent/index.ts')
const jobs=JSON.parse(fs.readFileSync('/tmp/issue619-implementation-20261120/v13-pipeline/qualification-final/plan.json','utf8')).cases
const ids=(process.env.ROUTE_CASES??'cyclic-labelled-19').split(',')
const rows=[]
for(const id of ids){const job=jobs.find((x:any)=>x.id===id);assert.ok(job,id);(globalThis as any).__routeLog=[];const source=job.source,options={...job.elkOptions,graphLayout:{backend:'elk'}};const start=performance.now();const result=snapshotSample({id,family:'flowchart',source},'route-exp-',options,{includeAscii:false});const elapsed=performance.now()-start;const verify=verifyMermaid(source,{renderOptions:options});const trace=(globalThis as any).__routeLog;const dir=path.join(out,mode);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({...result,svg:undefined,elapsed,verify,trace},null,2));if(result.svg)fs.writeFileSync(path.join(dir,id+'.svg'),result.svg);rows.push({id,ok:result.ok,elapsed,metrics:result.metrics,paint:result.svgReceipt?.layoutCertification,trace,svgSha:result.svg&&createHash('sha256').update(result.svg).digest('hex')});console.log(JSON.stringify(rows.at(-1)))}
fs.writeFileSync(path.join(out,mode+'.json'),JSON.stringify(rows,null,2)+'\n')
