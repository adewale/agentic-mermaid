// Hosted offline readback after an untimed preflight, no renderer import.
import{readFileSync}from'node:fs';import{deserialize}from'node:v8';import{createHash}from'node:crypto';
import{structuralDigest}from'./structural-digest.mjs';
const[expectedPath,resultPath,slot]=process.argv.slice(2),expected=JSON.parse(readFileSync(expectedPath))[slot],actual=JSON.parse(readFileSync(resultPath));
if(expected.occurrences.length!==75||actual.occurrences.length!==75)throw Error('Exact75 fullvalues required');
for(let i=0;i<75;i++){
 const ref=expected.occurrences[i],row=actual.occurrences[i],d=row.fullValues,bytes=readFileSync(d.path);
 if(ref.occurrenceId!==row.occurrenceId||createHash('sha256').update(bytes).digest('hex')!==d.sha256||bytes.length!==d.bytes)throw Error('Actual fullvalue CAS/ordinal mismatch');
 const digest=structuralDigest(deserialize(bytes)),want=ref.fullValues.structural;
 if(digest.protocol!==want.protocol||digest.sha256!==want.sha256||digest.canonicalBytes!==want.canonicalBytes)throw Error('Full public value structural mismatch:'+row.occurrenceId);
}
console.log(JSON.stringify({fullValueRows:75,allFieldsCovered:true,method:'tagged-own-data-structure-SHA256@1',v8EncodingCanonical:false}));
