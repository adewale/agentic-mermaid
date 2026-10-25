import {mock} from 'bun:test'
const root=process.env.AGENTIC_REVIEW_ROOT ?? '/workspace/agentic-mermaid-fixes'
if(process.argv.includes('--disabled')){
 const actual=await import(root+'/src/shared/svg-number.ts')
 mock.module(root+'/src/shared/svg-number.ts',()=>({...actual,formatSvgNumber:String,formatSvgNumericAttribute:(_name:string,value:string)=>value}))
 const post=await import(root+'/src/svg-postprocess.ts')
 mock.module(root+'/src/svg-postprocess.ts',()=>({...post,formatSvgNumbers:(value:string)=>value}))
}
const {renderMermaidSVG}=await import(root+'/src/index.ts')
const {MICRO_WORKLOADS}=await import(root+'/eval/benchmark/micro-bench-cases.ts')
const caseName=process.argv.find(x=>x==='state80'||x==='hand-drawn')??'state80'
const source=MICRO_WORKLOADS[caseName==='hand-drawn'?'flow5':'state80']
const opts=caseName==='hand-drawn'?{style:'hand-drawn',seed:7,security:'strict'}:{}
for(let i=0;i<100;i++)renderMermaidSVG(source,opts)
let sink='';const iterations=caseName==='hand-drawn'?500:150
const start=performance.now()
for(let i=0;i<iterations;i++)sink=renderMermaidSVG(source,opts)
console.log(JSON.stringify({caseName,numeric:!process.argv.includes('--disabled'),ms:(performance.now()-start)/iterations,bytes:sink.length}))
