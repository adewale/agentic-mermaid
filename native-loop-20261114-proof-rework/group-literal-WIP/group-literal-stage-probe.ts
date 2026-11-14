// Existing public product observation only; no timing or profiler.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {gzipSync,gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
Bun.plugin({ name: 'record-existing-emission-work', setup(build) {
  build.onLoad({filter:/\/native-paint-emission\.ts$/}, args => {
    let source=readFileSync(args.path,'utf8')
    const original='return textPaintApply(textPaintGet, emissionWork, [inspection])'
    if(source.split(original).length!==2)throw Error('Emission observation owner changed')
    source=source.replace(original, `const result = textPaintApply(textPaintGet, emissionWork, [inspection]); if(result)(globalThis as any).__emissionStats.push({ operations:result.operations, exhausted:result.exhausted, uncertain:result.uncertain, closedMarkerContext:result.closedMarkerContext }); return result`)
    source=source.replace('const work = createNativeXmlWork(maxOperations)', 'const work = createNativeXmlWork(maxOperations); (globalThis as any).__readNativeMeter = () => ({ operations:work.operations(), exhausted:work.exhausted() })')
    return {contents:source,loader:'ts'}
  })
  build.onLoad({filter:/\/native-drawing\.ts$/}, args => {
    let source=readFileSync(args.path,'utf8')
    for(const [anchor,phase] of [
      ['const document: DrawingDocument<Fragment> = withDeferredTerminalProjections(() => producer(factory, context))','after-producer'],
      ["assertFinalSvgByteBudget(svg, 'native drawing output')",'after-composition'],
    ]){
      if(source.split(anchor).length!==2)throw Error('Stage owner changed '+phase)
      source=source.replace(anchor,anchor+`; (globalThis as any).__proofStages.push({phase:'${phase}',...(globalThis as any).__readNativeMeter()})`)
    }
    const anchor='const paint = inspectPaint(paintHeader, parts, emission.observe, documentFont, xml)'
    if(source.split(anchor).length!==2)throw Error('Inspection owner changed')
    source=source.replace(anchor,`(globalThis as any).__proofStages.push({phase:'before-inspection',...(globalThis as any).__readNativeMeter()}); `+anchor)
    return {contents:source,loader:'ts'}
  })
}})
const {renderMermaidSVGWithReceipt}=await import('/workspace/agentic-mermaid/src/index.ts')
const out=import.meta.dir+'/group-literal-stage';mkdirSync(out,{recursive:true})
const cases=JSON.parse(readFileSync('/workspace/pr449-native-loop-20261113/current-main-cost-20261114/compatibility-overlay/MEASUREMENT-CASES.json','utf8'))
const rows=[]
for(const item of cases.filter((c:any)=>['diagnostic:chain100','diagnostic:chain300'].includes(c.id))) for(const backend of ['agentic','elk'] as const){
 ;(globalThis as any).__emissionStats=[]; (globalThis as any).__proofStages=[]
 const options={graphLayout:{backend,fallback:'none' as const}}
 try{
  const product=renderMermaidSVGWithReceipt(item.source,options)
  writeFileSync(out+'/'+item.id.replace(':','_')+'-'+backend+'.product.json.gz',gzipSync(JSON.stringify(product)))
  const baseline=gunzipSync(readFileSync('/workspace/pr449-native-loop-20261113/current-main-cost-20261114/receipt-performance/cache0-candidate-'+backend+'-'+item.id.replace(':','_')+'-0/warmup.svg.gz')).toString()
  rows.push({id:item.id,backend,emissionWork:(globalThis as any).__emissionStats,stages:(globalThis as any).__proofStages,returned:true,sourceSha256:createHash('sha256').update(item.source).digest('hex'),options,svgExact4cdd:product.svg===baseline,proof:product.receipt.layoutCertification})
 }catch(error:any){rows.push({id:item.id,backend,returned:false,error:{name:error.name,message:error.message,stack:error.stack}})}
}
writeFileSync(out+'/RESULTS.json',JSON.stringify(rows,null,2)+'\n')
console.log(JSON.stringify(rows.map(r=>({id:r.id,backend:r.backend,emissionWork:r.emissionWork,returned:r.returned,svgExact4cdd:r.svgExact4cdd,proof:r.proof,error:r.error})),null,2))
