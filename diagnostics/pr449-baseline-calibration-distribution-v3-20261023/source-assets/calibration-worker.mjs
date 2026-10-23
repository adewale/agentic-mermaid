// New SVG product workload. No ASCII calls, explicit GC or source-renderer imports.
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,readdirSync,readlinkSync,realpathSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
export const hash = data => createHash('sha256').update(data).digest('hex')
const json = value => JSON.stringify(value)
export function validatePopulation(inputs) {
  if (!Array.isArray(inputs)||inputs.length!==75||new Set(inputs.map(v=>v.occurrenceId)).size!==75
      ||inputs.slice(0,27).some(v=>v.stratum!=='H27')||inputs.slice(27).some(v=>v.stratum!=='D48')) throw Error('Exact H27+D48 population required')
}
export function measuredCall(operation, options={}) {
  const now=options.now??(()=>performance.now()),cpu=options.cpu??(since=>process.cpuUsage(since))
  const before=cpu(),start=now()
  const rendered=operation()
  if(typeof rendered.svg!=='string'||!rendered.receipt||typeof rendered.receipt!=='object')throw Error('Missing complete SVG/receipt')
  const svgBytes=Buffer.from(rendered.svg,'utf8')
  const receiptJson=json(rendered.receipt)
  const receiptBytes=Buffer.from(receiptJson,'utf8')
  const end=now(),delta=cpu(before)
  return {rendered,svgBytes,receiptJson,receiptBytes,wallMs:end-start,cpuUserMicros:delta.user,cpuSystemMicros:delta.system}
}
function frozen(path,digest){const bytes=readFileSync(path);if(hash(bytes)!==digest)throw Error('Frozen file changed:'+path);return bytes}
export function verifyRuntimeLinks(root,expected){
  root=realpathSync(root);const links={}
  const visit=directory=>{for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(entry.name==='.git')continue
    const path=join(directory,entry.name)
    if(entry.isSymbolicLink()){
      const target=relative(root,realpathSync(path))
      if(target==='..'||target.startsWith('..'+sep)||isAbsolute(target))throw Error('Runtime symlink escapes frozen artifact')
      links[relative(root,path)]=readlinkSync(path)
    }else if(entry.isDirectory())visit(path)
  }}
  visit(root)
  if(JSON.stringify(Object.entries(links).sort())!==JSON.stringify(Object.entries(expected).sort()))throw Error('Runtime symlink topology changed')
}
const verifiedPayloads=new Set()
function payload(store,bytes){const digest=hash(bytes),path=join(store,digest);if(!verifiedPayloads.has(path)){if(existsSync(path)){if(hash(readFileSync(path))!==digest)throw Error('Stored payload drift')}else writeFileSync(path,bytes,{flag:'wx'});verifiedPayloads.add(path)}return {sha256:digest,bytes:bytes.length,path}}
export async function runJob(jobPath,resultPath) {
  const job=JSON.parse(readFileSync(jobPath,'utf8'))
  if(job.protocol!=='baseline-repeatability-calibration-worker@1'||job.reps!==4||job.warmupPasses!==2||!['off','normal'].includes(job.policy))throw Error('Wrong new workload protocol')
  const executionEnvironment={AGENTIC_MERMAID_SCENE_ASSERTIONS:process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS??null,NODE_OPTIONS:process.env.NODE_OPTIONS??null}
  if(executionEnvironment.AGENTIC_MERMAID_SCENE_ASSERTIONS!==null||executionEnvironment.NODE_OPTIONS!==''||job.executionEnvironment?.AGENTIC_MERMAID_SCENE_ASSERTIONS!==null||job.executionEnvironment?.NODE_OPTIONS!=='')throw Error('Default execution environment required before renderer imports')
  const rejectedCore=new Set(['4bde7a94a2cb1ea31fdbbb9ce8f96c8477d9eb18f5ee639223be6f0bf07aec54','3c59b7ed7d0f50770925e80b37f8c6282af13c2f2a8bee67666ff08525460040'])
  if(job.candidateSourceBinding!==undefined||!['baseline-A','baseline-B'].includes(job.role))throw Error('Baseline-only calibration required')
  if(!job.baselineSourceBinding||rejectedCore.has(job.baselineSourceBinding.sha256)||job.requiredFiles[job.baselineSourceBinding.path]!==job.baselineSourceBinding.sha256)throw Error('Forbidden or unbound baseline core')
  validatePopulation(job.inputs)
  for(const [path,digest]of Object.entries(job.requiredFiles))frozen(path,digest)
  verifyRuntimeLinks(job.artifactRoot,job.artifactSymlinks)
  const expectedEnvironment=job.policy==='off'?{AGENTIC_MERMAID_ELK_CACHE:'0',AGENTIC_MERMAID_EXPERIMENTS:'text-spans'}:{AGENTIC_MERMAID_ELK_CACHE:'1',AGENTIC_MERMAID_EXPERIMENTS:'text-spans,position-cache'}
  Object.assign(process.env,expectedEnvironment)
  // No security/certification option or renderer environment is disabled here.
  const oracle=JSON.parse(frozen(job.oracle,job.oracleSha256).toString('utf8'))
  if(oracle.scope!=='H27+D48'||oracle.occurrences.length!==75||oracle.policy!==job.policy||oracle.artifactIdentity!==job.artifactIdentity)throw Error('Wrong independent oracle identity')
  if(!['elk','agentic','agentic-with-elk'].includes(job.layoutMode))throw Error('Explicit layoutMode required')
  const byId=new Map(oracle.occurrences.map(v=>[v.occurrenceId,v]))
  for(const input of job.inputs){const expected=byId.get(input.occurrenceId);if(!expected||expected.sourceSha256!==hash(input.source)||expected.independentRequiredChecksPassed!==true||!['passed','unverified','not-applicable'].includes(expected.nativeScenePaintStatus)||!Array.isArray(expected.unverifiedLimitations)||(expected.nativeScenePaintStatus==='unverified'&&!expected.unverifiedLimitations.length))throw Error('Missing independent full proof:'+input.occurrenceId);for(const key of ['svg','receipt','layout','layoutReceipt'])frozen(expected[key].path,expected[key].sha256)}
  const importStart=performance.now(),api=await import(pathToFileURL(job.entry).href)
  const fidelity=await import(pathToFileURL(job.fidelity).href)
  const importMs=performance.now()-importStart
  if(typeof api.renderMermaidSVGWithReceipt!=='function')throw Error('Public receipt API unavailable')
  const paintAdmission=oracle.occurrences.map(v=>({occurrenceId:v.occurrenceId,nativeScenePaintStatus:v.nativeScenePaintStatus,unverifiedLimitations:v.unverifiedLimitations}))
  const directory=dirname(resultPath),store=join(directory,'payloads');mkdirSync(store,{recursive:true})
  const journal=resultPath+'.calls.jsonl';writeFileSync(journal,'',{flag:'wx'})
  const result={protocol:job.protocol,status:'running',node:process.version,execArgv:process.execArgv,executionEnvironment,candidateSourceBinding:job.candidateSourceBinding,baselineSourceBinding:job.baselineSourceBinding,runtimeLinksVerified:{before:true,after:false},policy:job.policy,role:job.role,displayLabel:job.displayLabel,artifactIdentity:job.artifactIdentity,layoutMode:job.layoutMode,oracleSha256:job.oracleSha256,importMs,cacheEnvironment:expectedEnvironment,paintAdmission,warmupCalls:[],calls:[],ok:false}
  const progress=(stage,input,rep)=>writeFileSync(resultPath+'.progress.json',json({stage,occurrenceId:input?.occurrenceId,rep,completedTimedCalls:result.calls.length})+'\n')
  const invoke=input=>{
    let final,finalSource=input.source,callbackCalls=0
    const options={...input.baseOptions,idPrefix:input.idPrefix,...fidelity.layoutRenderOptions(job.layoutMode)}
    const render=source=>{finalSource=source;callbackCalls++;final=api.renderMermaidSVGWithReceipt(source,options);return final.svg}
    const svg=input.workflow?fidelity.renderAgentEdit(api,input.source,options,render):render(input.source)
    if(!final||svg!==final.svg||callbackCalls!==1)throw Error('Declared workflow must retain its one final public SVG call')
    return {...final,finalSource,callbackCalls}
  }
  try{
    for(let rep=-2;rep<4;rep++)for(const input of job.inputs){
      const stage=rep<0?'prewarm':'timed';progress(stage,input,rep)
      // Warmup uses identical full transport materialization, with no retained cost claim.
      const measured=measuredCall(()=>invoke(input)),expected=byId.get(input.occurrenceId)
      const svg=payload(store,measured.svgBytes),receipt=payload(store,measured.receiptBytes)
      const finalSourceSha256=hash(measured.rendered.finalSource)
      const matches=svg.sha256===expected.svg.sha256&&receipt.sha256===expected.receipt.sha256&&finalSourceSha256===expected.finalSourceSha256
      const row={stage,rep,occurrenceId:input.occurrenceId,stratum:input.stratum,originalId:input.id,svg,receipt,finalSourceSha256,callbackCalls:measured.rendered.callbackCalls,oracleMatches:matches,
        wallMs:measured.wallMs,cpuUserMicros:measured.cpuUserMicros,cpuSystemMicros:measured.cpuSystemMicros}
      appendFileSync(journal,json(row)+'\n')
      if(rep<0)result.warmupCalls.push(row);else result.calls.push(row)
      if(!matches)throw Error('Independent full oracle mismatch:'+input.occurrenceId)
    }
    if(result.calls.length!==300||result.warmupCalls.length!==150)throw Error('Incomplete fixed call schedule')
    verifyRuntimeLinks(job.artifactRoot,job.artifactSymlinks);result.runtimeLinksVerified.after=true
    result.status='completed';result.ok=true
  }catch(error){result.status='failed';result.failure={name:error?.name,message:String(error),code:error?.code,stack:error?.stack};throw error}
  finally{writeFileSync(resultPath,json(result)+'\n');progress(result.ok?'completed':'failed')}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await runJob(process.argv[2],process.argv[3])
