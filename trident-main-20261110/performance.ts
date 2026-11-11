import {readFileSync,writeFileSync,mkdirSync,appendFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {runSerialJob,runFirstUseBatch} from './kit/execution.mjs'
import {environmentIdentity} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/portable/environment.ts'
process.env.MERMAID_REFERENCE_DIR='/tmp/pr449-main-integration-20261029-762'
const out=import.meta.dir
if(!existsSync(join(out,'BROWSER-CLOSED.json')))throw Error('Close fidelity and delivery browsers before Node clocks')
const identity=JSON.parse(readFileSync(join(out,'IDENTITY.json'),'utf8')),cases=JSON.parse(readFileSync(join(out,'MEASUREMENT-CASES.json'),'utf8'))
const directory=join(out,'performance'),observer='/tmp/pr449-week-comparison-20261101/trident-native-elk-df133-20261108/gnu-time/usr/bin/time'
for(const d of ['jobs','results','failures','svg'])mkdirSync(join(directory,d),{recursive:true})
writeFileSync(join(directory,'ENVIRONMENT.json'),JSON.stringify(environmentIdentity('node'),null,2)+'\n')
const arms=[{target:'main',backend:'agentic'},{target:'pr',backend:'agentic'},{target:'main',backend:'elk'},{target:'pr',backend:'elk'}],replicas=['A0','A1','B'];let completed=0,errors=0
function jobFor(c:any,arm:any,cache:number,mode:string,replica:string){const stem=`cache${cache}-${arm.target}-${arm.backend}-${c.id.replace(/[^a-z0-9_.-]/gi,'_')}-${mode}-${replica}`,options={...c.renderOptions,graphLayout:{backend:arm.backend,fallback:'none'}},testCase={...c,renderOptions:options,...(c.edit?{edit:{...c.edit,renderOptions:{...(c.edit.renderOptions??c.renderOptions),graphLayout:{backend:arm.backend,fallback:'none'}}}}:{})};const job={artifact:identity.artifacts[arm.target].artifact,testCase,mode,samples:7,minSampleMs:4,workerTimeoutMs:120000,round:1,replica,sample:0,fullEvidence:mode==='warm'&&replica==='B',diagnosticFile:join(directory,'failures',stem+'.json'),...(mode==='warm'&&replica==='B'?{svgFile:join(directory,'svg',stem+'.svg')}:{})};writeFileSync(join(directory,'jobs',stem+'.json'),JSON.stringify(job)+'\n');return{stem,job,...arm,cache}}
function retain(result:any,m:any){writeFileSync(join(directory,'results',m.stem+'.json'),JSON.stringify(result)+'\n');appendFileSync(join(directory,'results.jsonl'),JSON.stringify({target:m.target,backend:m.backend,cache:m.cache,stem:m.stem,result})+'\n');completed++;if(completed%24===0)console.log(JSON.stringify({completed,errors,case:result.caseId,mode:result.mode,target:m.target,backend:m.backend,cache:m.cache}))}
async function serial(c:any,arm:any,cache:number,mode:string,replica:string){const m=jobFor(c,arm,cache,mode,replica);try{retain(await runSerialJob(m.job,'node',['memory','baseline'].includes(mode)?observer:undefined),m)}catch(e){errors++;appendFileSync(join(directory,'lifecycle-errors.jsonl'),JSON.stringify({...m,error:String(e)})+'\n');if(completed===0)throw Error('First worker could not start: '+String(e))}}
for(const cache of [0,1]){
 process.env.AGENTIC_MERMAID_ELK_CACHE=String(cache)
 for(const mode of ['warm','cold','resources']){
  for(let index=0;index<cases.length;index++){
   const c=cases[index],offset=(index+cache+(mode==='cold'?1:0))%4,ordered=[...arms.slice(offset),...arms.slice(0,offset)]
   if(mode==='cold')for(const arm of ordered){const metas=replicas.map(r=>jobFor(c,arm,cache,'cold',r));try{await runFirstUseBatch(metas.map(m=>m.job),'node',3,(result:any)=>retain(result,metas.find(m=>m.job.replica===result.replica)))}catch(e){errors++;appendFileSync(join(directory,'lifecycle-errors.jsonl'),JSON.stringify({cache,arm,id:c.id,mode,error:String(e)})+'\n')}}
   else for(const replica of replicas)for(const arm of ordered)for(const phase of mode==='warm'?['warm']:replica==='A1'?['memory','baseline']:['baseline','memory'])await serial(c,arm,cache,phase,replica)
  }
  writeFileSync(join(out,'PERFORMANCE-PROGRESS.json'),JSON.stringify({mode,cache,completed,errors})+'\n');console.log(JSON.stringify({phaseComplete:mode,cache,completed,errors}))
 }
}
writeFileSync(join(out,'PERFORMANCE-COMPLETED.json'),JSON.stringify({completed,errors,scope:'Unchanged pinned Trident SVG-only protocol;1round,3replicas,7adaptive warm means,3fresh first-use workers; exploratory, not full calibration.'},null,2)+'\n')
