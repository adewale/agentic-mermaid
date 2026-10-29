import {readFileSync,writeFileSync}from'node:fs'
import {pathToFileURL,fileURLToPath}from'node:url'
import{dirname}from'node:path'
const [entry,output]=process.argv.slice(2),api=await import(pathToFileURL(entry).href),root=dirname(fileURLToPath(import.meta.url)),rows=[]
for(const name of ['strict-class128-agentic','strict-er128-elk','strict-er128-agentic']){
 const family=name.includes('class')?'class':'er',source=readFileSync(`${root}/${family==='class'?'strict-class128-agentic':'strict-er128'}.mmd`,'utf8'),options=JSON.parse(readFileSync(`${root}/${name}-options.json`,'utf8'))
 try{
  const r=api.renderMermaidSVGWithReceipt(source,options),receipt=JSON.parse(JSON.stringify(r.receipt)),tag=family==='class'?'class-node':'entity'
  const ids=[...r.svg.matchAll(new RegExp(`<g class="${tag}" data-id="([^"]+)"`,'g'))].map(x=>x[1]),expected=Array.from({length:128},(_,i)=>'N'+i)
  const rels=[...r.svg.matchAll(new RegExp(`class="${family==='class'?'class-relationship':'er-relationship'}"[^>]*data-from="([^"]+)"[^>]*data-to="([^"]+)"`,'g'))].map(x=>[x[1],x[2]])
  const passed=JSON.stringify(ids.toSorted())===JSON.stringify(expected.toSorted())&&rels.length===127&&rels.every(([a,b],i)=>a==='N'+i&&b==='N'+(i+1))&&receipt.layoutCertification?.status==='passed'&&receipt.layoutDecisions.every(d=>d.selected===options.graphLayout.backend&&d.fallback==='none')
  rows.push({name,passed,nodes:ids.length,relationships:rels.length,checks:receipt.layoutCertification?.checks,receipt,svgBytes:Buffer.byteLength(r.svg)})
 }catch(e){rows.push({name,passed:false,error:String(e)})}
}
writeFileSync(output,JSON.stringify({runtime:process.version,rows},null,2)+'\n');console.log(rows.map(({receipt,...r})=>r))

if(rows.some(row=>!row.passed))process.exitCode=1;
