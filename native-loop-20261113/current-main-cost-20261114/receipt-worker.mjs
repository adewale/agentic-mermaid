import fs from 'node:fs';
import path from 'node:path';
import inspector from 'node:inspector';
import {promisify} from 'node:util';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
const out=process.argv[2],job=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),root=job.root;
fs.mkdirSync(out,{recursive:true});
const maps={};
const gz=(name,value)=>fs.writeFileSync(out+'/'+name+'.gz',gzipSync(typeof value==='string'?value:JSON.stringify(value)));
const importStart=performance.now();
const api=await import(pathToFileURL(root+'/dist/index.js'));
const withRenderStageObserver=(_observe,run)=>run();
const withPerformanceObserver=(_observe,run)=>run();
const importMs=performance.now()-importStart;
const session=job.profile!==false?new inspector.Session():undefined;session?.connect();const post=session?promisify(session.post).bind(session):async()=>({});
if(session){await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:200});}
const products=[];const rows=[];
function consume(source){const product=api.renderMermaidSVGWithReceipt(source,job.options);const svg=product.svg;const bytes=Buffer.byteLength(JSON.stringify(product));return{svg,receipt:product.receipt,bytes};}
// First render in this fresh Node process; module import is recorded separately.
let warmup,coldFailure;const coldBefore=process.memoryUsage(),coldStart=performance.now(),coldCPU=process.cpuUsage();
try{warmup=consume(job.source);}catch(e){coldFailure={name:e.name,message:e.message,stack:e.stack,certification:e.certification};}
const coldWallMs=performance.now()-coldStart,coldUsed=process.cpuUsage(coldCPU),coldAfter=process.memoryUsage();
if(warmup)warmup.receiptJSON=JSON.stringify(warmup.receipt); // Retained evidence encoding outside the API clock.
const coldRow={phase:'cold-render',status:warmup?'returned':'error',wallMs:coldWallMs,cpuMs:(coldUsed.user+coldUsed.system)/1000,before:coldBefore,after:coldAfter,peakRssKiB:process.resourceUsage().maxRSS,bytes:warmup?.bytes,proof:warmup?JSON.parse(warmup?.receiptJSON).layoutCertification:undefined,failure:coldFailure};
rows.push(coldRow);gz('cold-render.row.json',coldRow);
if(warmup){gz('warmup.svg',warmup?.svg);gz('warmup.receipt.json',warmup?.receiptJSON);}else gz('warmup-error.json',coldFailure);
for(const phase of (job.phases ?? ['repeat1','repeat2','edit'])){
 global.gc?.();const stages=[],events=[];const before=process.memoryUsage();if (job.profile !== false) await post('Profiler.start');const start=performance.now(),cpu=process.cpuUsage();let product,failure;
 try{product=job.observers === false ? consume(phase.startsWith('edit')?job.edit:job.source) : withPerformanceObserver(e=>events.push(e),()=>withRenderStageObserver(s=>stages.push(s),()=>consume(phase.startsWith('edit')?job.edit:job.source)));}catch(e){failure={name:e.name,message:e.message,stack:e.stack,certification:e.certification};}
 const wallMs=performance.now()-start,cpuTime=process.cpuUsage(cpu),atReturn=process.memoryUsage();if(product)product.receiptJSON=JSON.stringify(product.receipt);const {profile}=job.profile === false ? {profile:{startTime:0,endTime:0}} : await post('Profiler.stop');const after=atReturn;
 if(job.profile!==false)gz(phase+'.cpuprofile',profile);
 if(product){gz(phase+'.svg',product.svg);gz(phase+'.receipt.json',product.receiptJSON);}
 const row={phase,status:product?'returned':'error',wallMs,cpuMs:(cpuTime.user+cpuTime.system)/1000,before,after,peakRssKiB:process.resourceUsage().maxRSS,bytes:product?.bytes,wholeSvgExactWarmup:!phase.startsWith('edit')&&product&&warmup?product.svg===warmup.svg:undefined,entireReceiptExactWarmup:!phase.startsWith('edit')&&product&&warmup?product.receiptJSON===warmup.receiptJSON:undefined,editChanged:phase.startsWith('edit')&&product&&warmup?product.svg!==warmup.svg:undefined,proof:product?JSON.parse(product.receiptJSON).layoutCertification:undefined,failure,stages,events,profileStart:profile.startTime,profileEnd:profile.endTime,samples:profile.samples?.length};
 rows.push(row);gz(phase+'.row.json',row);console.log(JSON.stringify({case:job.case,backend:job.backend,phase,status:row.status,wallMs,cpuMs:row.cpuMs,samples:row.samples}));
}
const cacheAudit={status:'not-selected',reason:'No diagnostic observer/render after measured phases'};
gz('cache-audit.json',cacheAudit);
gz('source-maps.json',maps);gz('RESULT.json',{runtime:process.version,importMs,cacheAudit,job,cache:process.env.AGENTIC_MERMAID_ELK_CACHE,samplingIntervalUs:job.profile!==false?200:null,scope:'Fresh Node built public API: module import separate from first render; full SVG+entire receipt serialized once. Sampling and timed observers disabled for this benchmark. Compression/artifact writes/explicit GC/retained receipt evidence encoding outside measured render windows; warmup product retained for determinism. RSS includes harness/import/compression; not browser/package memory.',rows});session?.disconnect();
