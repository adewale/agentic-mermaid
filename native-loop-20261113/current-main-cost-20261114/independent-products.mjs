import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname);
const rows=fs.readFileSync(path.join(root,'receipt-performance/results.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const read=(p)=>gunzipSync(fs.readFileSync(p)).toString('utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const products=new Map(), bindings=[], counts={calls:0,serializedBytesExact:0,svgExactAcrossVersions:0,entireReceiptExactAcrossVersions:0,nonCertificationReceiptExactAcrossVersions:0,paired:0};
for(const worker of rows){
 const stem=`cache0-${worker.target}-${worker.backend}-${worker.id.replace(/[^a-z0-9_.-]/gi,'_')}-${worker.replica}`;
 const dir=path.join(root,'receipt-performance',stem);
 for(const row of worker.data.rows){
  const phase=row.phase==='cold-render'?'warmup':row.phase;
  const svg=read(path.join(dir,phase+'.svg.gz'));
  const receiptText=read(path.join(dir,phase+'.receipt.json.gz')),receipt=JSON.parse(receiptText);
  const serialized=JSON.stringify({svg,receipt});
  if(Buffer.byteLength(serialized)!==row.bytes)throw Error('Entire response byte count mismatch '+stem+'/'+phase);
  if(JSON.stringify(receipt.layoutCertification)!==JSON.stringify(row.proof))throw Error('Proof mismatch '+stem+'/'+phase);
  counts.calls++;counts.serializedBytesExact++;
  products.set(JSON.stringify([worker.target,worker.backend,worker.id,worker.replica,row.phase]),{svg,receipt,receiptText,serialized,bytes:row.bytes});
  bindings.push({target:worker.target,backend:worker.backend,id:worker.id,replica:worker.replica,phase:row.phase,bytes:row.bytes,svgSha256:sha(svg),receiptSha256:sha(receiptText),wholeProductSha256:sha(serialized),proof:receipt.layoutCertification.status});
 }
}
const pairs=[];
for(const [key,a] of products){
 const parts=JSON.parse(key);if(parts[0]!=='baseline')continue;
 parts[0]='candidate';const b=products.get(JSON.stringify(parts));if(!b)throw Error('Missing pair');
 const sameSvg=a.svg===b.svg,sameReceipt=a.receiptText===b.receiptText;
 const strip=o=>Object.fromEntries(Object.entries(o).filter(([k])=>k!=='layoutCertification'));
 const sameOtherReceipt=JSON.stringify(strip(a.receipt))===JSON.stringify(strip(b.receipt));
 counts.paired++;counts.svgExactAcrossVersions+=Number(sameSvg);counts.entireReceiptExactAcrossVersions+=Number(sameReceipt);counts.nonCertificationReceiptExactAcrossVersions+=Number(sameOtherReceipt);
 pairs.push({backend:parts[1],id:parts[2],replica:parts[3],phase:parts[4],svgExact:sameSvg,entireReceiptExact:sameReceipt,nonCertificationReceiptExact:sameOtherReceipt,MainProof:a.receipt.layoutCertification.status,currentProof:b.receipt.layoutCertification.status});
}
fs.writeFileSync(path.join(root,'INDEPENDENT-PRODUCT-CHECK.json'),JSON.stringify({counts,bindings,pairs,scope:'Retained actual measured SVG and entire receipt reconstructed with Node JSON.stringify; every serialized UTF8 byte count equals the worker measured full-product bytes. No new rendering. Cross-version differences retained, not normalized.'},null,2)+'\n');
console.log(JSON.stringify(counts));
for(const backend of ['agentic','elk']){
 for(const target of ['baseline','candidate']){
  const w=rows.find(r=>r.backend===backend&&r.target===target&&r.id==='diagnostic:chain300'&&r.replica===0);
  console.log(JSON.stringify({target,backend,proof:w.data.rows[0].proof}));
 }
}

