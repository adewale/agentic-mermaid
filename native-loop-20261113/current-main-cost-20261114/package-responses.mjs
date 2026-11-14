// Encode only already-retained measured public responses. No SDK import/calls.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {gunzipSync,gzipSync} from 'node:zlib'
const root=path.dirname(new URL(import.meta.url).pathname), products=JSON.parse(fs.readFileSync(path.join(root,'PRODUCT-OBSERVATIONS.json'))), seen=new Set(), responses=[]
for(const r of products){
 if(r.status!=='returned'||seen.has(r.productSha256))continue
 const stem=`cache0-${r.target}-${r.backend}-${r.id.replace(/[^a-z0-9_.-]/gi,'_')}-${r.replica}`, name=r.phase==='cold-render'?'warmup':r.phase
 const svg=gunzipSync(fs.readFileSync(path.join(root,'receipt-performance',stem,name+'.svg.gz'))).toString(), receipt=gunzipSync(fs.readFileSync(path.join(root,'receipt-performance',stem,name+'.receipt.json.gz'))).toString()
 const serialized='{"svg":'+JSON.stringify(svg)+',"receipt":'+receipt+'}'
 if(crypto.createHash('sha256').update(serialized).digest('hex')!==r.productSha256)throw Error('Response binding mismatch')
 responses.push({sha256:r.productSha256,serializedProduct:serialized});seen.add(r.productSha256)
}
if(responses.length!==32)throw Error('Unexpected unique response count')
fs.writeFileSync(path.join(root,'WHOLE-RESPONSES.json.gz'),gzipSync(JSON.stringify({scope:'32 unique retained full public responses; PRODUCT-OBSERVATIONS.json binds all432 calls by hash. No SDK render or performance clock.',responses}),{level:9}))
console.log('Unique retained whole responses',responses.length)
