import { readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,realpathSync } from 'node:fs'
import { join,resolve,dirname } from 'node:path'
import { pathToFileURL,fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fixtures,sourceFor } from './fixtures.mjs'
const here=dirname(fileURLToPath(import.meta.url)), hash=x=>createHash('sha256').update(x).digest('hex')
const median=xs=>{const s=[...xs].sort((a,b)=>a-b);return s.length%2?s[s.length>>1]:(s[(s.length>>1)-1]+s[s.length>>1])/2}
if(process.argv[2]==='--worker') {
  const job=JSON.parse(readFileSync(process.argv[3],'utf8')), startedAt=new Date().toISOString(), beforeImport=performance.now()
  const api=await import(pathToFileURL(join(job.packageRoot,'dist/agent.js')).href), importMs=performance.now()-beforeImport, encode=new TextEncoder(), rows=[]
  let sink=0
  for(const item of job.cases) {
    const fixture=fixtures.find(f=>f.id===item.id), source=sourceFor(fixture,'repeat'), parsed=api.parseRegisteredMermaid(source)
    for(const endpoint of ['analyzeMermaidSource','analyzeMermaid-parsed-once']) {
      const row={id:`${item.id}/${endpoint}`,fixture:item.id,endpoint,batch:item.batch,samples:[]}
      try {
        if(!parsed.ok) {row.status='refusal';row.oracle={sha256:hash(JSON.stringify(parsed)),error:parsed.error};rows.push(row);continue}
        const invoke=()=>endpoint==='analyzeMermaidSource'?api.analyzeMermaidSource(source):api.analyzeMermaid(parsed.value)
        const consume=()=>{const bytes=encode.encode(JSON.stringify(invoke()));sink=(sink+bytes.length+(bytes[bytes.length-1]??0))>>>0;return bytes}
        // Source API retains its Result wrapper. Check facts across APIs independently.
        const sourceFacts=api.analyzeMermaidSource(source)
        if(!sourceFacts.ok||JSON.stringify(sourceFacts.value)!==JSON.stringify(api.analyzeMermaid(parsed.value)))throw Error('Source/parsed public facts differ')
        row.oracle=hash(consume());if(hash(consume())!==row.oracle)throw Error('Initial output is nondeterministic')
        for(let warm=0;warm<job.warmupCalls;warm++)consume()
        row.warmupCalls=job.warmupCalls
        for(let sample=0;sample<job.samples;sample++) {
          let last;const start=performance.now()
          for(let call=0;call<item.batch;call++)last=consume()
          const batchMs=performance.now()-start, outputSha256=hash(last)
          if(outputSha256!==row.oracle)throw Error('Measured final-batch output differs')
          row.samples.push({sample,batchMs,perCallMs:batchMs/item.batch,outputSha256})
        }
        row.finalOracle=hash(consume());if(row.finalOracle!==row.oracle)throw Error('Output changed after batches')
        row.medianMs=median(row.samples.map(s=>s.perCallMs));row.status='ok'
      } catch(error) {row.status='failure';row.error=String(error?.stack??error)}
      rows.push(row)
    }
  }
  writeFileSync(job.out,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),runtime:process.versions,importMs,job,sink,rows},null,2))
  if(rows.some(r=>r.status==='failure'))process.exitCode=1
} else {
  if(process.argv.length!==4)throw Error('Usage: node analysis-probe.mjs CONFIG_JSON NEW_OUTPUT_DIRECTORY')
  const config=JSON.parse(readFileSync(resolve(process.argv[2]),'utf8')),out=resolve(process.argv[3]),acq=JSON.parse(readFileSync(config.acquisitionPath,'utf8'))
  if(existsSync(out))throw Error('Output must be a new directory')
  if(acq.status!=='passed'||!acq.dependencyGraphIdentical||hash(readFileSync(acq.lock.path))!==acq.lock.sha256)throw Error('Acquisition/lock verification failed')
  for(const role of ['baseline','candidate']) {
    const a=acq[role];if(hash(readFileSync(a.archive.path))!==a.archive.sha256)throw Error(`${role} archive changed`)
    for(const file of a.files)if(hash(readFileSync(join(a.root,file.path)))!==file.sha256)throw Error(`${role} acquired file changed: ${file.path}`)
  }
  if(realpathSync(join(acq.baseline.root,'node_modules'))!==realpathSync(join(acq.candidate.root,'node_modules')))throw Error('Different dependency roots')
  const expectedIds=['empty','sparse8','branch-feedback50','chain-feedback150','chain-feedback400']
  if(JSON.stringify(config.cases.map(c=>c.id))!==JSON.stringify(expectedIds)||JSON.stringify(config.cases.map(c=>c.batch))!==JSON.stringify([1000,200,50,20,10])||config.warmupCalls!==20||config.samples!==5)throw Error('Unexpected frozen cases/batches/warmup/sample configuration')
  if(JSON.stringify(Object.keys(config.runtimes??{}).sort())!==JSON.stringify(['bun','node']))throw Error('Exactly Node and Bun runtimes are required')
  for(const [runtime,command]of Object.entries(config.runtimes)) {const check=spawnSync(command,['--version'],{encoding:'utf8'});if(check.status!==0||check.stdout.trim()!==(runtime==='node'?'v24.20.0':'1.4.2'))throw Error(`Unexpected ${runtime} version`)}
  mkdirSync(out,{recursive:true});for(const file of ['analysis-probe.mjs','fixtures.mjs','analysis-protocol.md'])writeFileSync(join(out,file),readFileSync(join(here,file)))
  writeFileSync(join(out,'config.json'),JSON.stringify(config,null,2));writeFileSync(join(out,'acquisition.json'),JSON.stringify(acq,null,2))
  writeFileSync(join(out,'manifest.json'),JSON.stringify({startedAt:new Date().toISOString(),config,identities:{baseline:acq.baseline,candidate:acq.candidate},lock:acq.lock,inputs:config.cases.map(c=>({...c,source:sourceFor(fixtures.find(f=>f.id===c.id),'repeat')})),policy:{features:'production defaults',elkCache:'0; analysis does not invoke ELK',assertions:'0'}},null,2))
  const schedule=[],pairs=[];let aa=0
  for(let round=0;round<7;round++){schedule.push({comparison:'candidate',round});if([1,3,5].includes(round))schedule.push({comparison:'AA',round:aa++})}
  for(const[runtime,command]of Object.entries(config.runtimes))for(const{comparison,round}of schedule) {
    const pairId=`${runtime}-${comparison}-${round+1}`,pair={runtime,comparison,round:round+1,pairId,runs:{}}
    for(const side of round%2?['right','left']:['left','right']) {
      const role=side==='right'&&comparison==='candidate'?'candidate':'baseline',runId=`${pairId}-${side}`,job={...config,runtime,role,packageRoot:acq[role].root,out:join(out,`${runId}.json`)},jobPath=join(out,`${runId}.job.json`)
      writeFileSync(jobPath,JSON.stringify(job,null,2));const env={...process.env,AGENTIC_MERMAID_ELK_CACHE:'0',AGENTIC_MERMAID_SCENE_ASSERTIONS:'0'};delete env.AGENTIC_MERMAID_EXPERIMENTS
      const result=spawnSync(command,[join(here,'analysis-probe.mjs'),'--worker',jobPath],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024,env})
      writeFileSync(join(out,`${runId}.stderr.log`),result.stderr??'');writeFileSync(join(out,`${runId}.stdout.log`),result.stdout??'')
      pair.runs[side]={exitCode:result.status,error:result.error?.message,data:existsSync(job.out)?JSON.parse(readFileSync(job.out,'utf8')):null}
      appendFileSync(join(out,'processes.jsonl'),JSON.stringify({runId,exitCode:result.status,signal:result.signal,error:result.error?.message})+'\n');process.stdout.write(`${runId} exit=${result.status}\n`)
    }pairs.push(pair)
  }
  const issues=[],groups=new Map(),ids=config.cases.flatMap(c=>['analyzeMermaidSource','analyzeMermaid-parsed-once'].map(e=>`${c.id}/${e}`))
  for(const pair of pairs) {
    const a=pair.runs.left,b=pair.runs.right
    if(a.exitCode!==0||b.exitCode!==0||!a.data||!b.data){issues.push({pairId:pair.pairId,error:'Process failed'});continue}
    if([a,b].some(r=>JSON.stringify(r.data.rows.map(x=>x.id))!==JSON.stringify(ids))){issues.push({pairId:pair.pairId,error:'Required row inventory differs'});continue}
    for(let i=0;i<ids.length;i++) {
      const x=a.data.rows[i],y=b.data.rows[i]
      if(x.status!=='ok'||y.status!=='ok'||x.oracle!==y.oracle||x.finalOracle!==y.finalOracle||x.samples.length!==5||y.samples.length!==5||x.samples.some((s,j)=>s.outputSha256!==y.samples[j].outputSha256)||![x.medianMs,y.medianMs].every(n=>Number.isFinite(n)&&n>0)){issues.push({pairId:pair.pairId,id:x.id,error:'Incomplete measurement or output mismatch/refusal'});continue}
      const id=`${pair.runtime}/${pair.comparison}/${x.id}`;if(!groups.has(id))groups.set(id,[]);groups.get(id).push({round:pair.round,baselineMs:x.medianMs,candidateMs:y.medianMs,ratio:y.medianMs/x.medianMs,deltaMs:y.medianMs-x.medianMs})
    }
  }
  const rows=[...groups].map(([id,rounds])=>({id,rounds,ratio:median(rounds.map(r=>r.ratio)),deltaMs:median(rounds.map(r=>r.deltaMs)),slower:rounds.filter(r=>r.ratio>1).length,maxAbsRatioDisplacement:Math.max(...rounds.map(r=>Math.abs(r.ratio-1))),maxAbsDeltaMs:Math.max(...rounds.map(r=>Math.abs(r.deltaMs)))}))
  for(const r of rows.filter(r=>r.id.includes('/candidate/'))){const aa=rows.find(a=>a.id===r.id.replace('/candidate/','/AA/'));r.adverseDiagnostic=r.rounds.length===7&&aa?.rounds.length===3&&r.ratio>1.05&&r.slower>=6&&r.ratio-1>aa.maxAbsRatioDisplacement&&r.deltaMs>aa.maxAbsDeltaMs}
  writeFileSync(join(out,'summary.json'),JSON.stringify({complete:issues.length===0,finishedAt:new Date().toISOString(),issues,rows},null,2))
  writeFileSync(join(out,'summary.md'),['# Packed public analysis supplement','','| Runtime / endpoint / fixture | Ratio | Δ µs per call | Slower |','|---|---:|---:|---:|',...rows.map(r=>`| ${r.id} | ${r.ratio.toFixed(4)} | ${(r.deltaMs*1000).toFixed(3)} | ${r.slower}/${r.rounds.length} |`),'','Separate public analysis evidence; no SVG or allocation claim.'].join('\n')+'\n');if(issues.length)process.exitCode=1
}
