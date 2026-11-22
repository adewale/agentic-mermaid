// Existing Trident native probe, batched for the same corpus used in prior view reviews.
import {readFileSync,writeFileSync} from 'node:fs';
import {serialize} from 'node:v8';
import {createHash} from 'node:crypto';
const [jobFile,out]=process.argv.slice(2);process.env.TRIDENT_FIDELITY_JOB=jobFile;
const job=JSON.parse(readFileSync(jobFile,'utf8')),root=import.meta.dirname;
const runtime=await import('./harness/unified/mermaid-fidelity/runtime.ts');
const corpusBytes=readFileSync(root+'/harness/corpus/community-corpus.json');const corpus=JSON.parse(corpusBytes.toString());
const sources=Object.values(corpus).filter(Array.isArray).flat().filter((x:any)=>typeof x.source==='string'&&typeof x.family==='string') as any[];
const rows=[];for(const family of new Set(sources.map(x=>x.family))){await runtime.initialize(job.files.find((x:any)=>x.family===family)?.absolute);try{for(const item of sources.filter(x=>x.family===family)){let observation;try{observation={model:runtime.probeNative(family,item.source)}}catch(e:any){observation={exception:{name:e.name,message:e.message}}}rows.push({id:item.id,family,source:item.source,observation});}}finally{runtime.shutdown()}}
const bytes=serialize(rows);writeFileSync(out+'.v8',bytes);writeFileSync(out+'.json',JSON.stringify({project:job.target.project,version:job.target.version,revision:job.target.peer?.artifact?.revision,observations:rows.length,corpusSha256:createHash('sha256').update(corpusBytes).digest('hex'),outputSha256:createHash('sha256').update(bytes).digest('hex'),returnedModels:rows.filter(x=>x.observation.model!==undefined).length,exceptions:rows.filter(x=>x.observation.exception).length,method:'Existing Trident runtime.probeNative with each family initialized. No schema projection, expected model, score or performance measurement.'},null,2));console.log(out,rows.length);
