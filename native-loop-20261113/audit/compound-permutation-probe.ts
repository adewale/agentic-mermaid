// Scratch workload using existing Trident observers; no new metric/framework.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {createMeaningAdapter} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/adapters.ts'
import {assessMeaning} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/meaning.ts'
import {inspectFidelityPaint,plannedPaintCriteria} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/paint.ts'
import {inspectQuantitativePaint} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/paint-values.ts'
import {inspectSvgRouteMetrics,linearSvgMetrics} from '../implementation/fidelity/svg-metrics.ts'
import {parseMermaid} from '/workspace/agentic-mermaid/src/parser.ts'
import {layoutGraphSync} from '/workspace/agentic-mermaid/src/layout-engine.ts'
import {assessLayout,hardViolations} from '/workspace/agentic-mermaid/src/layout-rubric.ts'

const out=import.meta.dir+'/compound-permutation',root='/workspace/pr449-native-loop-20261113/implementation/node-baseline-689'
mkdirSync(out,{recursive:true});process.env.AGENTIC_MERMAID_ELK_CACHE='0'
const cases=['TB','LR','BT','RL'].map(direction=>{
 const nodes=['A','B','C'].flatMap(g=>Array.from({length:5},(_,i)=>({id:g+i,label:g+i})))
 const groups=['A','B','C'].map(g=>({id:'Group'+g,label:'Group '+g,members:nodes.filter(n=>n.id.startsWith(g)).map(n=>n.id)}))
 const edges=[...[4,2,0,3,1].map((j,i)=>({source:'A'+i,target:'B'+j,label:'',directed:true,startMarker:'none',endMarker:'arrow'})),...[1,3,0,4,2].map((j,i)=>({source:'B'+i,target:'C'+j,label:'',directed:true,startMarker:'none',endMarker:'arrow'}))]
 const source=['flowchart '+direction,...groups.flatMap(g=>['subgraph '+g.id+'['+g.label+']',...g.members.map(id=>id+'['+id+']'),'end']),...edges.map(e=>e.source+' --> '+e.target)].join('\n')
 return{id:'audit:compound-three-group-permutation:'+direction,family:'flowchart',source,expected:{nodes,groups,edges,labels:[...nodes.map(n=>n.label),...groups.map(g=>g.label)],facts:{direction}},provenance:'Authored 3x5 same-direction group permutation translated from Pele1.9 compound.test.ts:621; zero crossings is a feasibility target, not an assumed engine result.'}
})
writeFileSync(out+'/CASES.json',JSON.stringify(cases,null,2)+'\n')
writeFileSync(out+'/PLAN.json',JSON.stringify(cases.map(c=>({id:c.id,expected:c.expected,paint:plannedPaintCriteria(c),strict:'Existing SVG-route observer only; exact contacts remain unavailable.'})),null,2)+'\n')
const api=await import(root+'/dist/index.js'),adapter=await createMeaningAdapter({tool:'agentic',packageRoot:root})
const require=createRequire('/workspace/agentic-mermaid/package.json'),{chromium}=require('playwright')
const fonts=[['Inter-Regular.ttf','400','1b08e7fc267a5c7e1d614100f604b83e7e8a0be241f0f288faa2b3ac93a683ba'],['Inter-Medium.ttf','500','8c883f63b2c4157d997319f2c8bc6995ed4357ef371940d31ca159004a4aae63'],['Inter-SemiBold.ttf','600','e7a1aaf7eda9f2fad4131725fa556265ec75ca7b2d756260173a040363e8d4f7'],['Inter-Bold.ttf','700','b37284b5701b6b168dfc770aa1a4ac492106422fd3ba76bc7641e37434e8019c']].map(([file,weight,sha256])=>{const data=readFileSync('/workspace/agentic-mermaid/assets/fonts/'+file);if(createHash('sha256').update(data).digest('hex')!==sha256)throw Error('Font mismatch');return{file,weight,sha256,data:data.toString('base64')}})
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1400,height:1000},serviceWorkers:'block'}),page=await context.newPage(),blocked:string[]=[],rows:any[]=[]
await context.route('**/*',(route:any)=>route.request().url().startsWith('data:')?route.continue():(blocked.push(route.request().url()),route.abort()))
try{
 await page.goto('about:blank');await page.evaluate(async(faces:any[])=>{const all=[];for(const f of faces){const face=new FontFace('Inter',`url(data:font/ttf;base64,${f.data})`,{weight:f.weight});await face.load();all.push(face)};(globalThis as any).__ownedFonts=all},fonts)
 for(const c of cases)for(const backend of ['agentic','elk']){
  const stem=c.expected.facts.direction+'-'+backend,options={graphLayout:{backend,fallback:'none'}};let row:any={id:c.id,backend,source:c.source}
  writeFileSync(out+'/'+stem+'.mmd',c.source+'\n')
  try{
   const acquired=await adapter.parse(c.source,c.family);row.meaning=assessMeaning(c,acquired.meaning)
   const product=api.renderMermaidSVGWithReceipt(c.source,options),whole=JSON.stringify(product);Buffer.byteLength(whole)
   writeFileSync(out+'/'+stem+'.product.json',whole+'\n');writeFileSync(out+'/'+stem+'.svg',product.svg)
   row.returned=true;row.svgHash=createHash('sha256').update(product.svg).digest('hex');row.receipt=product.receipt
   const graph=parseMermaid(c.source),positioned=layoutGraphSync(graph,options as any),rubric=assessLayout(graph,positioned)
   row.positioned={width:positioned.width,height:positioned.height,nodes:positioned.nodes,groups:positioned.groups,edges:positioned.edges};row.rubric=rubric;row.hardViolations=hardViolations(rubric)
   await page.setContent(product.svg,{waitUntil:'domcontentloaded'});await page.evaluate(()=>{document.body.style.margin='0';document.body.style.background='#fff';for(const f of(globalThis as any).__ownedFonts??[])document.fonts.add(f)})
   row.paint=await page.evaluate(inspectFidelityPaint,{family:c.family,expected:c.expected});row.quantitative=await page.evaluate(inspectQuantitativePaint,{family:c.family,expected:c.expected,source:c.source,nodes:row.paint.nodes})
   row.svgObserved=await page.evaluate(inspectSvgRouteMetrics);row.quality=linearSvgMetrics(row.svgObserved,c.expected)
   await page.screenshot({path:out+'/'+stem+'.png',fullPage:true})
  }catch(e:any){row.error={name:e.name,message:e.message,code:e.code,details:e.details,stack:e.stack};row.returned??=false}
  rows.push(row);writeFileSync(out+'/'+stem+'.json',JSON.stringify(row,null,2)+'\n');writeFileSync(out+'/RESULTS.json',JSON.stringify(rows,null,2)+'\n')
  console.log(JSON.stringify({id:c.id,backend,returned:row.returned,meaning:row.meaning,proof:row.receipt?.layoutCertification?.status,paint:{passed:row.paint?.passed,complete:row.paint?.complete,failed:row.paint?.checks.filter((x:any)=>x.status==='failed')},quality:row.quality,hardViolations:row.hardViolations,error:row.error}))
 }
}finally{await context.close();await browser.close();writeFileSync(out+'/CLOSED.json',JSON.stringify({closed:true,rows:rows.length,browser:browser.version(),blockedRequests:blocked,fontHashes:fonts.map(({data,...f})=>f),scope:'8 functional products, existing Trident observers; no timing or peer-performance claim; public frozen baseline artifact plus source geometry observer at689.'},null,2)+'\n')}
