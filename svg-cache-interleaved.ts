// Diagnostic companion to the committed multi-process benchmark. Alternating
// individual public calls reduces temporal drift; it is not a replacement for
// the canonical benchmark or an isolated-process startup measurement.
import {execFileSync} from 'node:child_process'
const [leftRoot,rightRoot]=process.argv.slice(2)
const left=await import(leftRoot+'/src/index.ts')
const right=await import(rightRoot+'/src/index.ts')
const {MICRO_WORKLOADS}=await import('/workspace/agentic-selected-followups/eval/benchmark/micro-bench-cases.ts')
const median=(x:number[])=>[...x].sort((a,b)=>a-b)[Math.floor(x.length/2)]!
const result=[]
for(const id of ['state80','hand-drawn']){
 const source=MICRO_WORKLOADS[id==='hand-drawn'?'flow5':'state80']
 const options=id==='hand-drawn'?{style:'hand-drawn',seed:7,security:'strict'}:{}
 const call=[()=>left.renderMermaidSVG(source,options),()=>right.renderMermaidSVG(source,options)]
 for(let i=0;i<120;i++){call[i%2]!()}
 const rounds=[]
 for(let round=0;round<5;round++){
  const ms:number[][]=[[],[]]
  for(let sample=0;sample<100;sample++){
   for(const side of (sample+round)%2?[1,0]:[0,1]){
    const start=performance.now();const svg=call[side]!();ms[side]!.push(performance.now()-start)
    if(!svg.startsWith('<svg'))throw new Error('invalid output')
   }
  }
  rounds.push({leftMs:median(ms[0]!),rightMs:median(ms[1]!),ratio:median(ms[1]!)/median(ms[0]!),samples:ms})
 }
 result.push({id,rounds,ratio:median(rounds.map(x=>x.ratio))})
}
console.log(JSON.stringify({kind:'interleaved public-call diagnostic',runtime:process.versions.bun,roots:[leftRoot,rightRoot],revisions:[leftRoot,rightRoot].map(root=>execFileSync('git',['-C',root!,'rev-parse','HEAD'],{encoding:'utf8'}).trim()),flags:{elkCache:process.env.AGENTIC_MERMAID_ELK_CACHE,sceneAssertions:process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS},result}))
