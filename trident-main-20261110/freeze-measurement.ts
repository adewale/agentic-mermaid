import {readFileSync,writeFileSync} from 'node:fs'
const dir=import.meta.dir,raw=JSON.parse(readFileSync(dir+'/CASES.json','utf8'))
function rename(value:any,from:string,to:string):any{
 if(typeof value==='string')return value.replaceAll(from,to)
 if(Array.isArray(value))return value.map(v=>rename(v,from,to))
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k.replaceAll(from,to),rename(v,from,to)]))
 return value
}
const rows=raw.all.map((original:any)=>{
 const c=structuredClone(original)
 if(c.cohort==='family'&&!c.edit){const token=c.expected.labels[0];if(token&&c.source.includes(token))c.edit={source:c.source.replaceAll(token,token+'Edited'),expected:rename(c.expected,token,token+'Edited')};c.editProvenance='Explicit authored source replacement of first existing expected label with LabelEdited, including its declared identities; follows existing Trident source-replacement method. Original seed/expectations retained unchanged.'}
 return c
})
writeFileSync(dir+'/MEASUREMENT-CASES.json',JSON.stringify(rows,null,2)+'\n')
writeFileSync(dir+'/PLAN.json',JSON.stringify({sources:{main:'4260292397d4bca7624a30c34649eb943a5f8e0c',pr:'599bee58db7cb54293866cc8aa86c887ef93e9a4'},trident:'f080278e31e4202ca89d524e4ee9e4cf3cbff038',familyCount:33,caseCount:rows.length,arms:['main-agentic','main-elk','pr-agentic','pr-elk'],cacheRegimes:[0,1],portable:{protocol:'unchanged portable-svg-processes-v3',boundary:'Public renderMermaidSVG + SVG UTF8 byte count; receipt costs excluded',warm:{rounds:1,replicas:['A0','A1','B'],samples:7,minSampleMs:4},cold:{replicas:['A0','A1','B'],preparationConcurrency:3,oneCallPerProcess:true},resources:{memoryAndBaselineReplicas:['A0','A1','B'],observer:'existing GNUtime1.9',scope:'whole process peakRSS/CPU, separate API memory return/afterGC snapshots'}},fullyConsumed:{boundary:'Actual built public renderMermaidSVGWithReceipt + entire receipt and response serialization/byte count, adapted existing product worker; no synthetic public API',cases:'All33 family representatives +3 existing100/300node diagnostics',replicas:3,phases:['repeat1','repeat2','repeat3','repeat4','edit1','edit2','edit3','edit4'],importSeparate:true,profile:false,observers:false},ordering:'No timing overlaps builds/browser/profiling. Alternate/rotate arms and replicas. Cold import preparation may overlap but measured APIs serialize at Trident barrier.',qualification:'Exploratory below standard full calibration5round/31warm/20cold; retain A/A/control spread, failures, unavailable, refusal and unknown. No broad qualified replacement ratio.',unchangedCaps:true,productionChanges:false,automation:false},null,2)+'\n')
console.log(JSON.stringify({cases:rows.length,families:rows.filter((c:any)=>c.cohort==='family').length,familyEdits:rows.filter((c:any)=>c.cohort==='family'&&c.edit).length}))
