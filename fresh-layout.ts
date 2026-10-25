import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const root=process.argv[2]!
const {renderMermaidSVG}=await import(root+'/src/index.ts')
const {MICRO_WORKLOADS}=await import('/workspace/agentic-mermaid-fixes/eval/benchmark/micro-bench-cases.ts')
const results=[]
for(const id of ['state80','hand-drawn']){
 const count=id==='state80'?32:64
 const source=MICRO_WORKLOADS[id==='hand-drawn'?'flow5':'state80']
 const options=(index:number)=>({padding:40+index/97,...(id==='hand-drawn'?{style:'hand-drawn',seed:7,security:'strict'}:{})})
 for(let i=-16;i<0;i++)renderMermaidSVG(source,options(i))
 const times:number[]=[],outputs:string[]=[]
 for(let i=0;i<count;i++){
  const start=performance.now()
  const svg=renderMermaidSVG(source,options(i))
  times.push(performance.now()-start)
  outputs.push(svg)
 }
 results.push({id,count,times,medianMs:[...times].sort((a,b)=>a-b)[Math.floor(count/2)],outputSha256:outputs.map(svg=>createHash('sha256').update(svg).digest('hex'))})
}
console.log(JSON.stringify({revision:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),elkCache:'off',variation:'padding = 40 + index/97; new layout per request; 16 separate warmup layouts',results}))
