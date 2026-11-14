// Scratch workload using existing Trident observers; no new metric/framework.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {createMeaningAdapter} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/adapters.ts'
import {assessMeaning} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/meaning.ts'
import {inspectFidelityPaint,plannedPaintCriteria} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/paint.ts'
import {inspectQuantitativePaint} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/paint-values.ts'
import {inspectSvgRouteMetrics,linearSvgMetrics} from '/workspace/pr449-native-loop-20261113/implementation/fidelity/svg-metrics.ts'
import {parseMermaid} from '/workspace/agentic-mermaid/src/parser.ts'
import {layoutGraphSync} from '/workspace/agentic-mermaid/src/layout-engine.ts'
import {assessLayout,hardViolations} from '/workspace/agentic-mermaid/src/layout-rubric.ts'

const out=process.env.AUDIT_OUT??import.meta.dir+'/compound-permutation',root=process.env.AUDIT_ROOT??'/workspace/pr449-native-loop-20261113/implementation/node-baseline-689',controls=process.env.AUDIT_CONTROLS==='1'
const selectedStems=process.env.AUDIT_SELECTED_STEMS?new Set<string>(JSON.parse(readFileSync(process.env.AUDIT_SELECTED_STEMS,'utf8'))):undefined
mkdirSync(out,{recursive:true});process.env.AGENTIC_MERMAID_ELK_CACHE='0'
const cases=JSON.parse(readFileSync('/workspace/pr449-native-loop-20261113/requirement-history-20261114/forest-current-4cdd/CASES.json','utf8'))
writeFileSync(out+'/CASES.json',JSON.stringify(cases,null,2)+'\n')
writeFileSync(out+'/PLAN.json',JSON.stringify(cases.map(c=>({id:c.id,expected:c.expected,paint:plannedPaintCriteria(c),strict:'Existing SVG-route observer only; exact contacts remain unavailable.'})),null,2)+'\n')
const api=await import(root+'/dist/index.js'),adapter=await createMeaningAdapter({tool:'agentic',packageRoot:root})
const require=createRequire('/workspace/agentic-mermaid/package.json'),{chromium}=require('playwright')
const fonts=[['Inter-Regular.ttf','400','1b08e7fc267a5c7e1d614100f604b83e7e8a0be241f0f288faa2b3ac93a683ba'],['Inter-Medium.ttf','500','8c883f63b2c4157d997319f2c8bc6995ed4357ef371940d31ca159004a4aae63'],['Inter-SemiBold.ttf','600','e7a1aaf7eda9f2fad4131725fa556265ec75ca7b2d756260173a040363e8d4f7'],['Inter-Bold.ttf','700','b37284b5701b6b168dfc770aa1a4ac492106422fd3ba76bc7641e37434e8019c']].map(([file,weight,sha256])=>{const data=readFileSync('/workspace/agentic-mermaid/assets/fonts/'+file);if(createHash('sha256').update(data).digest('hex')!==sha256)throw Error('Font mismatch');return{file,weight,sha256,data:data.toString('base64')}})
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1400,height:1000},serviceWorkers:'block'}),page=await context.newPage(),blocked:string[]=[],rows:any[]=[]
await context.route('**/*',(route:any)=>route.request().url().startsWith('data:')?route.continue():(blocked.push(route.request().url()),route.abort()))
try{
 await page.goto('about:blank');await page.evaluate(async(faces:any[])=>{const all=[];for(const f of faces){const face=new FontFace('Inter',`url(data:font/ttf;base64,${f.data})`,{weight:f.weight});await face.load();all.push(face)};(globalThis as any).__ownedFonts=all},fonts)
 for(const c of cases)for(const backend of process.env.AUDIT_NATIVE_ONLY==='1'?['agentic']:['agentic','elk']){
  const stem=c.expected.facts.direction+(controls?'-'+c.variant:'')+'-'+backend,options={embedFontImport:false,graphLayout:{backend,fallback:'none'},...(process.env.AUDIT_WIDE==='1'?{style:{formatVersion:1,name:'compound-wide-interaction',stroke:'crisp',strokeWidth:4}}:{})};let row:any={id:c.id,variant:c.variant,backend,source:c.source,options}
  if(selectedStems&&!selectedStems.has(stem))continue
  writeFileSync(out+'/'+stem+'.mmd',c.source+'\n')
  try{
   const acquired=await adapter.parse(c.source,c.family);row.meaning=assessMeaning(c,acquired.meaning)
   if(process.env.AUDIT_PRODUCTS&&backend!=='agentic')throw Error('Imported Native products require AUDIT_NATIVE_ONLY=1')
   const productFile=process.env.AUDIT_BUILT_PRODUCTS?process.env.AUDIT_BUILT_PRODUCTS+'/'+stem+'.product.json':process.env.AUDIT_PRODUCTS?process.env.AUDIT_PRODUCTS+'/'+c.expected.facts.direction+(controls?'-'+c.variant:'')+'.product.json':undefined
   const product=productFile?JSON.parse(readFileSync(productFile,'utf8')):api.renderMermaidSVGWithReceipt(c.source,options),whole=JSON.stringify(product);Buffer.byteLength(whole)
   row.productSource=productFile??root+'/dist/index.js'
   writeFileSync(out+'/'+stem+'.product.json',whole+'\n');writeFileSync(out+'/'+stem+'.svg',product.svg)
   row.returned=true;row.svgHash=createHash('sha256').update(product.svg).digest('hex');row.receipt=product.receipt
   if(process.env.AUDIT_SOURCE_GEOMETRY!=='0'){
    const graph=parseMermaid(c.source),positioned=layoutGraphSync(graph,options as any),rubric=assessLayout(graph,positioned)
    row.positioned={width:positioned.width,height:positioned.height,nodes:positioned.nodes,groups:positioned.groups,edges:positioned.edges};row.rubric=rubric;row.hardViolations=hardViolations(rubric)
   }
   await page.setContent(product.svg,{waitUntil:'domcontentloaded'});await page.evaluate(()=>{document.body.style.margin='0';document.body.style.background='#fff';for(const f of(globalThis as any).__ownedFonts??[])document.fonts.add(f)})
   row.paint=await page.evaluate(inspectFidelityPaint,{family:c.family,expected:c.expected});row.quantitative=await page.evaluate(inspectQuantitativePaint,{family:c.family,expected:c.expected,source:c.source,nodes:row.paint.nodes})
   const painted=new Map(row.paint.nodes.map((node:any)=>[node.id,node.box])),direction=c.expected.facts.direction
   row.actualFlow=c.expected.edges.map(edge=>{const a:any=painted.get(edge.source),b:any=painted.get(edge.target);return{source:edge.source,target:edge.target,status:!a||!b?'unavailable':(direction==='LR'?a.x+a.width<=b.x+.01:direction==='RL'?a.x>=b.x+b.width-.01:direction==='BT'?a.y>=b.y+b.height-.01:a.y+a.height<=b.y+.01)?'passed':'failed',scope:'Expected directed leaf bounds advance along authored direction, derived from existing actual Chromium painted-node boxes; not a monotone-route or exact-contact claim.'}})
   row.svgObserved=await page.evaluate(inspectSvgRouteMetrics);row.quality=linearSvgMetrics(row.svgObserved,c.expected)
   await page.screenshot({path:out+'/'+stem+'.png',fullPage:true})
   if(process.env.AUDIT_SVG_ELEMENT_SCREENSHOT==='1')await page.locator('svg').screenshot({path:out+'/'+stem+'.svg-element.png'})
  }catch(e:any){row.error={name:e.name,message:e.message,code:e.code,details:e.details,stack:e.stack};row.returned??=false}
  rows.push(row);writeFileSync(out+'/'+stem+'.json',JSON.stringify(row,null,2)+'\n');writeFileSync(out+'/RESULTS.json',JSON.stringify(rows,null,2)+'\n')
  console.log(JSON.stringify({id:c.id,backend,returned:row.returned,meaning:{passed:row.meaning?.passed,complete:row.meaning?.complete},proof:row.receipt?.layoutCertification?.status,paint:{passed:row.paint?.passed,complete:row.paint?.complete,failed:row.paint?.checks.filter((x:any)=>x.status==='failed')},flow:row.actualFlow?.filter((x:any)=>x.status!=='passed'),quality:row.quality?.linear,error:row.error?.message}))
 }
}finally{await context.close();await browser.close();writeFileSync(out+'/CLOSED.json',JSON.stringify({closed:true,rows:rows.length,selectedStems:selectedStems?[...selectedStems]:undefined,artifact:root,preRenderedProducts:process.env.AUDIT_BUILT_PRODUCTS??process.env.AUDIT_PRODUCTS,observerRuntime:typeof Bun==='undefined'?process.version:'Bun '+Bun.version,browser:browser.version(),blockedRequests:blocked,fontHashes:fonts.map(({data,...f})=>f),sourceGeometry:process.env.AUDIT_SOURCE_GEOMETRY!=='0',scope:'Functional whole products using existing Trident observers; actual direction derived from their painted-node boxes. Imported products, when present, remain attributed to their source directory rather than this artifact root. No timing or peer-performance claim.'},null,2)+'\n')}
