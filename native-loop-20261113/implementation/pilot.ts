import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {gzipSync} from 'node:zlib'
import {qualifyPortable} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/portable/fidelity.ts'
const out=import.meta.dir,cases=JSON.parse(readFileSync(join(out,'CASES.json'),'utf8')).all,roots={main:'/tmp/pr449-bench-main-4260-20261110',pr:'/tmp/pr449-bench-pr-599b-20261110'}
process.env.AGENTIC_MERMAID_ELK_CACHE='0'
const apis=Object.fromEntries(await Promise.all(Object.entries(roots).map(async([key,root])=>[key,await import(root+'/dist/index.js')]))),rows=[]
mkdirSync(join(out,'pilot'),{recursive:true})
for(const [index,c]of cases.entries())for(const target of index%2?['pr','main']:['main','pr'])for(const backend of index%2?['elk','agentic']:['agentic','elk']){
 const options={...c.renderOptions,graphLayout:{backend,fallback:'none'}},stem=target+'-'+backend+'-'+c.id.replace(/[^a-z0-9_.-]/gi,'_');let row:any
 try{for(const p of c.prelude??[])try{apis[target].renderMermaidSVG(p.source)}catch{};const value=apis[target].renderMermaidSVGWithReceipt(c.source,options),receipt=JSON.stringify(value.receipt);Buffer.byteLength(JSON.stringify(value));const qualification=qualifyPortable(c,{svg:value.svg,adapter:'agentic'});row={target,backend,id:c.id,family:c.family,delivery:'returned',proof:value.receipt.layoutCertification?.status,selected:value.receipt.graphLayouts,qualification,svgBytes:Buffer.byteLength(value.svg),receiptBytes:Buffer.byteLength(receipt)};writeFileSync(join(out,'pilot',stem+'.svg.gz'),gzipSync(value.svg));writeFileSync(join(out,'pilot',stem+'.receipt.json.gz'),gzipSync(receipt))}
 catch(e:any){row={target,backend,id:c.id,family:c.family,delivery:e.code==='GRAPH_LAYOUT_UNSUPPORTED'?'unsupported':'error',code:e.code,error:String(e),qualification:qualifyPortable(c,{error:String(e),adapter:'agentic'})}}
 rows.push(row);writeFileSync(join(out,'PILOT.json'),JSON.stringify(rows,null,2)+'\n');if(rows.length%24===0)console.log(JSON.stringify({completed:rows.length,total:cases.length*4,last:{target,backend,id:c.id,delivery:row.delivery}}))
}
console.log(JSON.stringify({done:true,rows:rows.length,returned:rows.filter(r=>r.delivery==='returned').length}))
