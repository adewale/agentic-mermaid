import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {renderMermaidSVGWithReceipt} from '/workspace/elk-layered-port/dist/index.js'
import {layoutMermaidWithReceipt,measureQuality} from '/workspace/elk-layered-port/dist/agent-core.js'
const dir='/workspace/elk-layered-tools/issue619-intent-repair-20261121/'
const cases=JSON.parse(readFileSync('/workspace/elk-layered-tools/issue619-bm-zm-examples-20261121/cases.json','utf8'))
mkdirSync(dir+'candidate',{recursive:true})
for(const c of cases)for(const mode of ['default','balanced']){const row={id:c.id,mode,options:{graphLayout:{backend:'elk',...(mode==='balanced'?{quality:'balanced'}:{})}}};try{const rendered=renderMermaidSVGWithReceipt(c.source,row.options);writeFileSync(dir+'candidate/'+c.id+'-'+mode+'.svg',rendered.svg);const p=layoutMermaidWithReceipt(c.source,{...row.options,debug:true});Object.assign(row,{ok:true,receipt:rendered.receipt,layout:p.layout,metrics:measureQuality(p.layout)});console.log(JSON.stringify({id:c.id,mode,proof:rendered.receipt.layoutCertification,crossings:row.metrics.edgeCrossings,conflicts:row.metrics.labelConflicts,area:p.layout.width*p.layout.height}))}catch(e){row.ok=false;row.error=String(e);console.log(JSON.stringify({id:c.id,mode,error:row.error}))}writeFileSync(dir+'candidate/'+c.id+'-'+mode+'.json',JSON.stringify(row,null,2))}
