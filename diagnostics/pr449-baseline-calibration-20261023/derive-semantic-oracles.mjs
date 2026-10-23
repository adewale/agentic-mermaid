// Local OFFLINE original-V8 readback only; no renderer/application import.
import{readFileSync,writeFileSync}from'node:fs';import{deserialize}from'node:v8';
import{createHash}from'node:crypto';import{structuralDigest}from'./structural-digest.mjs';
const root=import.meta.dirname,expected=JSON.parse(readFileSync(root+'/expected-oracles.json')),
 originalRoot='/workspace/pr449-frontier/interval-median-subtraction/baseline-oracles',records=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const[slot,data]of Object.entries(expected)){
 const originalBytes=readFileSync(originalRoot+'/'+slot+'.json');if(hash(originalBytes)!==data.historicalOracleSHA256)throw Error('Original oracle drift');
 const original=JSON.parse(originalBytes);if(original.occurrences.length!==75)throw Error('Original population drift');
 for(let i=0;i<75;i++){
  const ref=original.occurrences[i],row=data.occurrences[i],descriptor=ref.fullValues,bytes=readFileSync(descriptor.path);
  if(hash(bytes)!==descriptor.sha256||bytes.length!==descriptor.bytes||row.occurrenceId!==ref.occurrenceId)throw Error('Original fullvalue drift');
  const value=deserialize(bytes),digest=structuralDigest(value);
  if(Reflect.ownKeys(value).join(',')!=='finalSource,svg,receipt,debugLayout,metrics,missingLabels')throw Error('Full public fields missing/reordered unexpectedly');
  row.fullValues={structural:digest,historicalV8EncodingOnly:{sha256:descriptor.sha256,bytes:descriptor.bytes},
                  admission:'Tagged structural digest, NOT V8 serialization bytes; exact original4UTF8 payload checks remain separate.'};
  records.push({slot,occurrenceId:row.occurrenceId,...digest});
 }
}
writeFileSync(root+'/expected-oracles.semantic.json',JSON.stringify(expected,null,2)+'\n',{flag:'wx'});
writeFileSync(root+'/semantic-derivation.json',JSON.stringify({protocol:'original300-offline-tagged-structural-derivation@1',
 rendererImported:false,rows:records.length,allFullValueFieldsCovered:true,records},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({rows:records.length,rendererImported:false,maxCanonicalBytes:Math.max(...records.map(x=>x.canonicalBytes)),
 maxDepthBudget:256,statistics:records.reduce((a,r)=>{for(const[k,n]of Object.entries(r.statistics))a[k]=(a[k]??0)+n;return a},{})}));
