// Reporting only: inspect retained artifacts; never import or execute an SDK.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {gunzipSync,gzipSync,brotliCompressSync,constants} from 'node:zlib'
const root=path.dirname(new URL(import.meta.url).pathname), dir=path.join(root,'receipt-performance')
const workers=fs.readFileSync(path.join(dir,'results.jsonl'),'utf8').trim().split('\n').map(JSON.parse)
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'), products=[], unique=new Map()
for(const worker of workers){
 const stem=`cache${worker.cache}-${worker.target}-${worker.backend}-${worker.id.replace(/[^a-z0-9_.-]/gi,'_')}-${worker.replica}`
 for(const row of worker.data.rows){
  if(row.status!=='returned'){products.push({target:worker.target,backend:worker.backend,id:worker.id,replica:worker.replica,phase:row.phase,status:row.status,failure:row.failure});continue}
  const name=row.phase==='cold-render'?'warmup':row.phase
  const svg=gunzipSync(fs.readFileSync(path.join(dir,stem,name+'.svg.gz'))).toString('utf8')
  const receiptText=gunzipSync(fs.readFileSync(path.join(dir,stem,name+'.receipt.json.gz'))).toString('utf8'), receipt=JSON.parse(receiptText)
  const full=Buffer.from('{"svg":'+JSON.stringify(svg)+',"receipt":'+receiptText+'}')
  if(full.length!==row.bytes)throw Error('Whole-response raw-byte mismatch '+stem+'/'+name)
  const fullHash=hash(full)
  if(!unique.has(fullHash))unique.set(fullHash,{bytes:full.length,gzip9:gzipSync(full,{level:9}).length,brotli11:brotliCompressSync(full,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length})
  products.push({target:worker.target,backend:worker.backend,id:worker.id,replica:worker.replica,phase:row.phase,status:row.status,svgSha256:hash(svg),receiptSha256:hash(receiptText),productSha256:fullHash,payload:unique.get(fullHash),proofStatus:receipt.layoutCertification?.status,proofOperations:receipt.layoutCertification?.checks?.operations,proofMaxOperations:receipt.layoutCertification?.checks?.maxOperations,proofCoverage:receipt.layoutCertification?.coverage})
 }
}
const byKey=new Map(products.map(r=>[[r.target,r.backend,r.id,r.replica,r.phase].join('|'),r]))
const paired=[],determinism=[],replicas=[]
for(const r of products){
 if(r.target==='baseline'){
  const c=byKey.get(['candidate',r.backend,r.id,r.replica,r.phase].join('|'));if(!c)throw Error('Missing arm pair')
  paired.push({backend:r.backend,id:r.id,replica:r.replica,phase:r.phase,baselineReturned:r.status==='returned',candidateReturned:c.status==='returned',svgExact:r.svgSha256===c.svgSha256,receiptExact:r.receiptSha256===c.receiptSha256,wholeProductExact:r.productSha256===c.productSha256,baselineProof:r.proofStatus,candidateProof:c.proofStatus})
 }
 const refPhase=r.phase.startsWith('repeat')?'cold-render':r.phase.startsWith('edit')&&r.phase!=='edit1'?'edit1':undefined
 if(refPhase){const ref=byKey.get([r.target,r.backend,r.id,r.replica,refPhase].join('|'));determinism.push({target:r.target,backend:r.backend,id:r.id,replica:r.replica,phase:r.phase,reference:refPhase,wholeProductExact:r.productSha256===ref.productSha256})}
 if(r.replica!==0){const ref=byKey.get([r.target,r.backend,r.id,0,r.phase].join('|'));replicas.push({target:r.target,backend:r.backend,id:r.id,replica:r.replica,phase:r.phase,wholeProductExact:r.productSha256===ref.productSha256})}
}
const count=(a,k)=>a.filter(r=>r[k]).length
const summary={workers:workers.length,calls:products.length,returned:products.filter(r=>r.status==='returned').length,uniqueWholeProducts:unique.size,allRawByteBindingsVerified:true,paired:paired.length,pairedSvgExact:count(paired,'svgExact'),pairedReceiptExact:count(paired,'receiptExact'),pairedWholeProductExact:count(paired,'wholeProductExact'),withinWorkerRepeatedProducts:determinism.length,withinWorkerRepeatedProductsExact:count(determinism,'wholeProductExact'),crossReplicaProducts:replicas.length,crossReplicaProductsExact:count(replicas,'wholeProductExact'),proofCounts:Object.fromEntries([...new Set(products.map(r=>r.proofStatus))].map(s=>[s,products.filter(r=>r.proofStatus===s).length]))}
for(const [name,value] of Object.entries({'PRODUCT-OBSERVATIONS.json':products,'PRODUCT-PAIR-COMPARISON.json':paired,'PRODUCT-DETERMINISM.json':{withinWorker:determinism,crossReplica:replicas},'PRODUCT-SUMMARY.json':summary}))fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n')
console.log(JSON.stringify(summary,null,2))
