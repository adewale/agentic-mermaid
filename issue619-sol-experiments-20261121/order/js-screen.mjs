import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {countPolylineCrossings} from '/workspace/elk-layered-port/src/shared/edge-crossings.ts'
const out=path.dirname(fileURLToPath(import.meta.url)),root='/workspace/elk-layered-port'
const req=createRequire(root+'/package.json'),wk=root+'/node_modules/elkjs/lib/elk-worker.js'
const hash=s=>createHash('sha256').update(s).digest('hex')
assert.equal(hash(fs.readFileSync(wk)),'c93ae799ceb15b94b19272307b5bfde46e7dde6f274a2fb78afeba2ac0393f77')
const old=Object.getOwnPropertyDescriptor(globalThis,'document');let Worker
try{Object.defineProperty(globalThis,'document',{configurable:true,value:{}});Worker=req(wk).Worker}finally{if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document')}
const worker=new Worker();let id=0
function dispatch(data){let value;worker.onmessage=e=>{value=e.data};worker.dispatcher.saveDispatch({data:{...data,id:id++}});assert.ok(value);if('error' in value)throw value.error;return value}
dispatch({cmd:'register',algorithms:['layered','stress','mrtree','radial','force','disco','sporeOverlap','sporeCompaction','rectpacking']})
const models={sdk:JSON.parse(fs.readFileSync(path.join(out,'captured-input.json'),'utf8')),peer:JSON.parse(fs.readFileSync('/workspace/elk-layered-tools/issue619-zm-stack-20261121/zombie-actual-input.json','utf8'))}
const rows=[]
for(const [model,baseline]of Object.entries(models))for(const cycle of ['MODEL_ORDER','DEPTH_FIRST'])for(const force of ['true','false']){
 const arm=`${model}-${cycle}-${force}`,input=structuredClone(baseline)
 input.layoutOptions['elk.layered.cycleBreaking.strategy']=cycle
 input.layoutOptions['elk.layered.crossingMinimization.forceNodeModelOrder']=force
 const restored=structuredClone(input);restored.layoutOptions=baseline.layoutOptions;assert.deepStrictEqual(restored,baseline)
 try{
  const raw=dispatch({cmd:'layout',graph:structuredClone(input)}).data;assert.ok(raw)
  const owner=new Map(raw.children.flatMap(n=>[[n.id,n.id],...(n.ports??[]).map(p=>[p.id,n.id])])),nodes=new Map(raw.children.map(n=>[n.id,n]))
  const lines=raw.edges.flatMap(e=>(e.sections??[]).map(s=>({points:[s.startPoint,...s.bendPoints??[],s.endPoint]})))
  const upward=raw.edges.filter(e=>{const s=nodes.get(owner.get(e.sources[0])),t=nodes.get(owner.get(e.targets[0]));return t.y+t.height<s.y}).map(e=>e.id)
  const row={arm,model,cycle,force,ok:true,crossings:countPolylineCrossings(lines),size:[raw.width,raw.height],upwardRectRelations:upward,feedback:'Unassessed: no original-JS processor trace; upward rectangle relations are physical observations, not exact reversed flags.',nodes:raw.children.length,edges:raw.edges.length,labels:raw.edges.flatMap(e=>e.labels??[]).length,inputSHA256:hash(JSON.stringify(input))}
  fs.writeFileSync(path.join(out,'js-screen-'+arm+'.json'),JSON.stringify({row,input,raw},null,2)+'\n');rows.push(row)
 }catch(error){rows.push({arm,model,cycle,force,ok:false,error:String(error),stack:error?.stack})}
 fs.writeFileSync(path.join(out,'js-screen-summary.json'),JSON.stringify({scope:'Original ELK.js 0.11.1 development oracle. Reciprocal SDK/peer model controlled 2x2 breaker×force matrix. Raw only; no public-pipeline, paint, role-consumer or balanced qualification. No runtime fallback.',workerSHA256:hash(fs.readFileSync(wk)),rows},null,2)+'\n')
 console.log(JSON.stringify(rows.at(-1)))
}
