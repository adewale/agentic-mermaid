import fs from 'node:fs'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
const out=import.meta.dir, arm=process.argv[2]??'kept'
assert.ok(['control','unguarded','kept'].includes(arm))
if(arm!=='kept')Bun.plugin({name:'controlled-ablation',setup(build){build.onLoad({filter:/\/src\/layout-engine\.ts$/},({path})=>{
 let source=fs.readFileSync(path,'utf8')
 const needle=arm==='control'?'&& !options.preserveSubgraphChildOrder && !options.layoutHints?.adjacent?.length) {':'&& (!hasParallelPair(graph.edges) || optimization.orderAlternativeInkClear(selected, result.certified.positioned, style, result.certified.score.labelConflicts))'
 assert.equal(source.split(needle).length,2)
 source=source.replace(needle,arm==='control'?'&& !options.preserveSubgraphChildOrder && !options.layoutHints?.adjacent?.length && !hasParallelPair(graph.edges)) {':'')
 return{loader:'ts',contents:source}
})}})
const {snapshotSample,collectSamples}=await import('/workspace/elk-layered-port/eval/layout-compare/run.ts')
const {generatedFlowchartSamples}=await import('/workspace/elk-layered-port/eval/layout-compare/generated.ts')
const crossing='flowchart TD\nA[One]\nB[Two]\nC[Three]\nD[Four]\nA --> D\nB --> C'
const source=fs.readFileSync('/tmp/issue619-followup-20261121/evidence-checkout/issue619-followup-20261121/crossings/input.mmd','utf8')
const special=[{id:'cyclic19',family:'flowchart',source},{id:'winning-duplicate-return',family:'flowchart',source:crossing+'\nA --> D\nD --> A'},{id:'duplicate-width-rejection',family:'flowchart',source:crossing+'\nA --> D'}]
const fixtures=collectSamples().filter(c=>c.id.startsWith('fixture/')&&['flowchart','state'].includes(c.family))
const cases=[...special,...fixtures,...generatedFlowchartSamples({start:128,count:16}),...generatedFlowchartSamples({start:32,count:16},'sha256-counter-v1')]
const results=[];fs.mkdirSync(out+'/qualification',{recursive:true})
for(const c of cases)for(const mode of ['default','balanced']){
 const sample=snapshotSample(c,'qualified-', {graphLayout:{backend:'elk',...(mode==='balanced'?{quality:'balanced' as const}:{})}},{includeAscii:false})
 const hash=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
 const row={id:c.id,mode,sourceSHA256:hash(c.source),ok:sample.ok,error:sample.error,svgSHA256:hash(sample.svg),layout:sample.layout,metrics:sample.metrics,paint:sample.svgReceipt?.layoutCertification,optimization:sample.svgReceipt?.layoutOptimization,preference:sample.layoutReceipt?.layoutCertification}
 results.push(row)
 fs.writeFileSync(out+'/qualification/'+arm+'-'+results.length+'.json.gz',gzipSync(JSON.stringify(sample)))
 fs.writeFileSync(out+'/qualification/'+arm+'-summary.json',JSON.stringify({arm,cases:cases.length,results},null,2))
 console.log(JSON.stringify({id:c.id,mode,ok:row.ok,crossings:sample.metrics?.edgeCrossings,paint:row.paint?.status,selected:row.optimization?.selected,calls:row.optimization?.additionalProducerCalls,error:row.error}))
}
