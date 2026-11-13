import {readFileSync,writeFileSync,mkdirSync,appendFileSync,existsSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {gunzipSync} from 'node:zlib'
const out=import.meta.dir
if(!existsSync(join(out,'PERFORMANCE-COMPLETED.json')))throw Error('Finish serial Trident timings before receipt timings')
const cases=JSON.parse(readFileSync(join(out,'compatibility-overlay/MEASUREMENT-CASES.json'),'utf8')).filter((c:any)=>c.cohort==='family'||c.id.startsWith('diagnostic:'))
const roots={"baseline": "/workspace/pr449-native-loop-20261113/implementation/node-baseline-689", "candidate": "/workspace/pr449-native-loop-20261113/implementation/node-candidate-axis"},arms=[{target:'baseline',backend:'agentic'},{target:'candidate',backend:'agentic'},{target:'baseline',backend:'elk'},{target:'candidate',backend:'elk'}]
const dir=join(out,'receipt-performance');mkdirSync(dir,{recursive:true});let completed=0,failed=0
for(const cache of [0])for(let index=0;index<cases.length;index++)for(const replica of [0,1,2]){
 const c=cases[index],offset=(index+replica+cache)%arms.length,ordered=[...arms.slice(offset),...arms.slice(0,offset)]
 for(const arm of ordered){
  const stem=`cache${cache}-${arm.target}-${arm.backend}-${c.id.replace(/[^a-z0-9_.-]/gi,'_')}-${replica}`,destination=join(dir,stem),file=join(dir,stem+'.job.json')
  const job={root:roots[arm.target],case:c.id,backend:arm.backend,source:c.source,edit:c.edit?.source??c.source,options:{...c.renderOptions,graphLayout:{backend:arm.backend,fallback:'none'}},profile:false,observers:false,phases:['repeat1','repeat2','repeat3','repeat4','edit1','edit2','edit3','edit4']}
  writeFileSync(file,JSON.stringify(job)+'\n')
  const result=spawnSync('node',['--expose-gc',join(out,'receipt-worker.mjs'),destination,file],{env:{...process.env,AGENTIC_MERMAID_ELK_CACHE:String(cache),AGENTIC_MERMAID_SCENE_ASSERTIONS:'0'},timeout:120000,encoding:'utf8',maxBuffer:4*1024*1024})
  writeFileSync(join(dir,stem+'.log'),result.stdout+result.stderr)
  let data:any;try{data=JSON.parse(gunzipSync(readFileSync(join(destination,'RESULT.json.gz'))).toString())}catch(e){failed++;data={status:'lifecycle-error',error:String(e),exitCode:result.status,signal:result.signal}}
  appendFileSync(join(dir,'results.jsonl'),JSON.stringify({target:arm.target,backend:arm.backend,cache,replica,id:c.id,data})+'\n');completed++;if(completed%24===0)console.log(JSON.stringify({completed,failed,cache,id:c.id,target:arm.target,backend:arm.backend}))
 }
}
writeFileSync(join(out,'RECEIPT-PERFORMANCE-COMPLETED.json'),JSON.stringify({completed,failed,boundary:'Actual built public receipt API, entire SVG+receipt serialized once and UTF8-counted. First source render/import separate. edit1 is first edited source; edit2-4 are repeats of edited source, never treated as fresh-edit cost. Existing product worker adapted for built entry, one-response serialization, no diagnostic cache-audit render, disabled source observers and no sampling session. Retained receipt evidence encoding outside API clocks. No empty profile files emitted.'},null,2)+'\n')
