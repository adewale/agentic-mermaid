// Adapted from the existing trident-native-elk-df133-20261108/fidelity.ts.
// Observers/criteria are unchanged; this collector adds the frozen Main arm,
// complete products, explicit unavailable denominators, and existing SVG metrics.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {gzipSync} from 'node:zlib'
import {assertMermaidOracle} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/portable/mermaid-oracle.ts'
import {createMeaningAdapter} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/adapters.ts'
import {assessMeaning} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/meaning.ts'
import {inspectFidelityPaint,plannedPaintCriteria} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/paint.ts'
import {inspectQuantitativePaint,plannedQuantitativeCriteria} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/paint-values.ts'
import {inspectSvgRouteMetrics,linearSvgMetrics} from './fidelity/svg-metrics.ts'
const out=import.meta.dir,directory=join(out,'fidelity'),roots={pr:'/dev/shm/pr449-four-final-20261111/full-trident-689-sdk/package'}
process.env.MERMAID_REFERENCE_DIR='/tmp/pr449-main-integration-20261029-762';process.env.AGENTIC_MERMAID_ELK_CACHE='0';assertMermaidOracle()
const input=JSON.parse(readFileSync(join(out,'FIDELITY-CASES.json'),'utf8')),cases=input.selected,supplemental=new Set(input.supplemental.map((c:any)=>c.id))
mkdirSync(directory,{recursive:true});for(const d of ['products','screenshots'])mkdirSync(join(directory,d),{recursive:true})
writeFileSync(join(directory,'CRITERIA-PLAN.json'),JSON.stringify({scope:'Frozen authored expectations before any observations; no cross-renderer agreement as oracle',cases:cases.map((c:any)=>({id:c.id,family:c.family,expected:c.expected,expectationDepth:supplemental.has(c.id)?'family/labels only; deeper meaning unavailable':'reviewed declared authored fields',paint:plannedPaintCriteria(c),quantitative:plannedQuantitativeCriteria(c)})),arms:Object.keys(roots).flatMap(target=>['agentic','elk'].map(backend=>({target,backend,fallback:'none'})))},null,2)+'\n')
const require=createRequire(roots.pr+'/package.json'),{chromium}=require('playwright'),apis:any={},adapters:any={}
for(const [target,root]of Object.entries(roots)){apis[target]=await import(root+'/dist/index.js');adapters[target]=await createMeaningAdapter({tool:'agentic',packageRoot:root})}
const fontRows=[['Inter-Regular.ttf','400','1b08e7fc267a5c7e1d614100f604b83e7e8a0be241f0f288faa2b3ac93a683ba'],['Inter-Medium.ttf','500','8c883f63b2c4157d997319f2c8bc6995ed4357ef371940d31ca159004a4aae63'],['Inter-SemiBold.ttf','600','e7a1aaf7eda9f2fad4131725fa556265ec75ca7b2d756260173a040363e8d4f7'],['Inter-Bold.ttf','700','b37284b5701b6b168dfc770aa1a4ac492106422fd3ba76bc7641e37434e8019c']].map(([file,weight,sha256])=>{let data='';for(const root of Object.values(roots)){const b=readFileSync(join(root,'assets/fonts',file!));if(createHash('sha256').update(b).digest('hex')!==sha256)throw Error('Font mismatch '+root+'/'+file);data=b.toString('base64')}return{file,weight,sha256,data}})
writeFileSync(join(directory,'FONTS.json'),JSON.stringify(fontRows.map(({data,...x})=>x),null,2)+'\n')
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1400,height:1000},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(30000)
const blockedRequests:string[]=[];await context.route('**/*',(route:any)=>route.request().url().startsWith('data:')?route.continue():(blockedRequests.push(route.request().url()),route.abort()))
await page.goto('about:blank');await page.evaluate(async(faces:any[])=>{const all=[];for(const f of faces){const face=new FontFace('Inter',`url(data:font/ttf;base64,${f.data})`,{weight:f.weight});await face.load();all.push(face)};(globalThis as any).__ownedFonts=all},fontRows)
const rows:any[]=[];let closed=false
try{
 for(const[index,c]of cases.entries())for(const target of ['pr'])for(const backend of index%2?['elk','agentic']:['agentic','elk']){
  const stem=index+'-'+c.id.replace(/[^a-zA-Z0-9_.-]/g,'_')+'-'+target+'-'+backend;let acquired:any,meaning:any,rendered:any,paint:any,quantitative:any,quality:any,preludes:any[]=[]
  try{
   for(const prelude of c.prelude??[]){try{apis[target].renderMermaidSVG(prelude.source);preludes.push({accepted:true,expected:prelude.accept})}catch(e){preludes.push({accepted:false,expected:prelude.accept,error:String(e)})};await adapters[target].parse(prelude.source,c.family)}
   acquired=await adapters[target].parse(c.source,c.family);meaning=assessMeaning(c,acquired.meaning)
   try{const product=apis[target].renderMermaidSVGWithReceipt(c.source,{...c.renderOptions,graphLayout:{backend,fallback:'none'}});const whole=JSON.stringify(product),receipt=JSON.stringify(product.receipt);Buffer.byteLength(whole);rendered={accepted:true,svg:product.svg,receipt:product.receipt,wholeBytes:Buffer.byteLength(whole),receiptBytes:Buffer.byteLength(receipt)};writeFileSync(join(directory,'products',stem+'.product.json.gz'),gzipSync(whole));writeFileSync(join(directory,'products',stem+'.svg.gz'),gzipSync(product.svg));writeFileSync(join(directory,'products',stem+'.receipt.json.gz'),gzipSync(receipt))}catch(e:any){rendered={accepted:false,error:String(e),name:e.name,code:e.code,details:e.details}}
   if(rendered.accepted){
    await page.setContent(rendered.svg,{waitUntil:'domcontentloaded',timeout:30000});await page.evaluate(()=>{document.body.style.margin='0';document.body.style.background='#fff';for(const f of(globalThis as any).__ownedFonts??[])document.fonts.add(f)})
    paint=await page.evaluate(inspectFidelityPaint,{family:c.family,expected:c.expected,paint:c.paint});quantitative=await page.evaluate(inspectQuantitativePaint,{family:c.family,expected:c.expected,source:c.source,nodes:paint.nodes});quality=linearSvgMetrics(await page.evaluate(inspectSvgRouteMetrics),c.expected)
    if(paint.checks.some((x:any)=>x.status==='failed')||quantitative.some((x:any)=>x.status==='failed'))await page.screenshot({path:join(directory,'screenshots',stem+'.png'),fullPage:false})
   }
  }catch(e){rendered??={accepted:false};rendered.observerError=String(e)}
  const row={id:c.id,family:c.family,target,backend,stem,expectationDepth:supplemental.has(c.id)?'family/labels only; deeper authored meaning unavailable':'reviewed declared authored fields only',preludes,acquired,meaning,rendered,paint,quantitative,quality,scope:'Unmodified Trident meaning + actual Chromium paint/quantitative observers on full Node SVG/receipt; exact strict linear metrics only where enrolled ownership/geometry allow. No browser renderer execution or speed claim.'};rows.push(row);writeFileSync(join(directory,stem+'.json'),JSON.stringify(row,null,2)+'\n');writeFileSync(join(directory,'RESULTS.json'),JSON.stringify(rows,null,2)+'\n')
  console.log(JSON.stringify({completed:rows.length,total:cases.length*2,id:c.id,target,backend,returned:rendered?.accepted,meaningPassed:meaning?.passed,meaningComplete:meaning?.complete,limitedMeaning:supplemental.has(c.id),paintFailed:paint?.checks.filter((x:any)=>x.status==='failed').map((x:any)=>x.criterion),observerError:rendered?.observerError}))
 }
 writeFileSync(join(directory,'BROWSER.json'),JSON.stringify({version:browser.version(),blockedRequests,fonts:'Four manifest-verified Inter faces; other fallback fonts unqualified.',scope:'Actual SVG DOM metrics and1400x1000 failed-case viewport screenshots; not whole-diagram screenshot qualification.'},null,2)+'\n')
}finally{await context.close();await browser.close();closed=true;writeFileSync(join(directory,'CLOSED.json'),JSON.stringify({browserClosed:closed,rows:rows.length,total:cases.length*2})+'\n')}
