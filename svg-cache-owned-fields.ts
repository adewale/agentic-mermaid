import {mock} from 'bun:test'
const root='/workspace/agentic-selected-followups'
const modulePath=root+'/src/shared/svg-number.ts'
const current=await import(modulePath)
const number=current.formatSvgNumber, attribute=current.formatSvgNumericAttribute
const old=await import('/workspace/agentic-review-evidence/selected-followups-no-cache/src/shared/svg-number.ts')
type Field={kind:'number',value:number}|{kind:'attribute',name:string,value:string}
let capture:Field[]|undefined
mock.module(modulePath,()=>({...current,
 formatSvgNumber:(value:number)=>{capture?.push({kind:'number',value});return number(value)},
 formatSvgNumericAttribute:(name:string,value:string)=>{capture?.push({kind:'attribute',name,value});return attribute(name,value)},
}))
const {renderMermaidSVG}=await import(root+'/src/index.ts')
const {MICRO_WORKLOADS}=await import(root+'/eval/benchmark/micro-bench-cases.ts')
const median=(xs:number[])=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)]!
const results=[]
for(const id of ['state80','hand-drawn']){
 const source=MICRO_WORKLOADS[id==='hand-drawn'?'flow5':'state80']
 const options=id==='hand-drawn'?{style:'hand-drawn',seed:7,security:'strict'}:{}
 renderMermaidSVG(source,options)
 capture=[];renderMermaidSVG(source,options);const fields=capture;capture=undefined
 const run=(formatNumber:typeof number,formatAttribute:typeof attribute)=>{
  let bytes=0
  for(let repeat=0;repeat<50;repeat++)for(const field of fields)bytes+=(field.kind==='number'?formatNumber(field.value):formatAttribute(field.name,field.value)).length
  return bytes
 }
 for(let i=0;i<10;i++){run(number,attribute);run(old.formatSvgNumber,old.formatSvgNumericAttribute)}
 const rounds=[]
 for(let round=0;round<5;round++){
  const ms:number[][]=[[],[]];const sums:number[][]=[[],[]]
  for(let sample=0;sample<21;sample++)for(const side of (sample+round)%2?[1,0]:[0,1]){
   const start=performance.now()
   const bytes=side?run(number,attribute):run(old.formatSvgNumber,old.formatSvgNumericAttribute)
   ms[side]!.push((performance.now()-start)/50);sums[side]!.push(bytes)
  }
  if(sums[0]!.some((value,index)=>value!==sums[1]![index]))throw new Error('lengths differ')
  rounds.push({baseMs:median(ms[0]!),headMs:median(ms[1]!),ratio:median(ms[1]!)/median(ms[0]!),samples:ms})
 }
 results.push({id,fieldCalls:fields.length,numberCalls:fields.filter(f=>f.kind==='number').length,attributeCalls:fields.filter(f=>f.kind==='attribute').length,rounds,ratio:median(rounds.map(r=>r.ratio))})
}
console.log(JSON.stringify({kind:'isolated formatter cost on captured public-render calls; excludes all other render stages',base:'fd9ed706334d61ae22a68a2f65b4426b9249966d',head:'2eb645f93b67aed95a9546df122ca29a1636f90d',iterations:50,samples:21,rounds:5,results}))
