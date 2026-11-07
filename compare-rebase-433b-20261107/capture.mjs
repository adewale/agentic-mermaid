import fs from 'node:fs';
import path from 'node:path';


import {pathToFileURL,fileURLToPath} from 'node:url';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const out=process.argv[2],job=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),root=job.root;
fs.mkdirSync(out,{recursive:true});
const maps={};
registerHooks({
 resolve(specifier,context,next){
  if(specifier.startsWith('.')&&(context.parentURL?.startsWith(pathToFileURL(root+'/').href)||context.parentURL?.includes('/node_modules/roughjs/bin/'))){
   const p=new URL(specifier,context.parentURL);
   if(!path.extname(p.pathname)&&fs.existsSync(fileURLToPath(p)+'.ts'))return next(p.href+'.ts',context);
   if(!path.extname(p.pathname)&&fs.existsSync(fileURLToPath(p)+'.js'))return next(p.href+'.js',context);
  }
  if(specifier.startsWith('roughjs/bin/')&&!path.extname(specifier))return next(specifier+'.js',context);
  return next(specifier,context);
 },
 load(url,context,next){
  if(url.startsWith(pathToFileURL(root+'/').href)&&url.endsWith('.json'))return{format:'json',shortCircuit:true,source:fs.readFileSync(fileURLToPath(url),'utf8')};
  if(url.startsWith(pathToFileURL(root+'/').href)&&url.endsWith('.ts')){
   const original=fs.readFileSync(fileURLToPath(url),'utf8');
   const source=stripTypeScriptTypes(original,{mode:'transform',sourceMap:true,sourceUrl:url});
   const m=source.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
   if(m)maps[url]=JSON.parse(Buffer.from(m[1],'base64').toString());
   return{format:'module',shortCircuit:true,source};
  }
  return next(url,context);
 }
});
const gz=(name,value)=>fs.writeFileSync(out+'/'+name+'.gz',gzipSync(typeof value==='string'?value:JSON.stringify(value)));
// Public entry only: private observer modules are not prerequisites of this comparison.
let api;
try { api=await import(pathToFileURL(root+'/src/index.ts')); if(typeof api.renderMermaidSVGWithReceipt!=='function')throw new Error('Public SVG-with-receipt export unavailable'); }
catch(error){gz('RESULT.json',{status:'tool-unavailable',actualPublicCalls:0,runtime:process.version,stage:'module-loading',failure:{name:error.name,message:error.message,stack:error.stack},job});console.log(JSON.stringify({status:'tool-unavailable',actualPublicCalls:0,message:error.message}));process.exit(2);}
const start=performance.now(),cpu=process.cpuUsage();let product;
const describeError=(e,depth=0)=>e&&depth<5?{name:e.name,message:e.message,stack:e.stack,code:e.code,diagnostics:e.diagnostics,certification:e.certification,cause:e.cause?describeError(e.cause,depth+1):undefined}:undefined;
try{
 product=api.renderMermaidSVGWithReceipt(job.source,job.options);
 const consumed=JSON.stringify(product),wallMs=performance.now()-start,usedCPU=process.cpuUsage(cpu);
 const rawSVG=Buffer.from(product.svg),rawReceipt=Buffer.from(JSON.stringify(product.receipt));
 gz('actual.svg',product.svg);gz('actual.receipt.json',rawReceipt.toString());gz('actual.product.json',consumed);
 const sizes={svgRawBytes:rawSVG.length,svgGzipBytes:gzipSync(rawSVG).length,svgBrotliBytes:brotliCompressSync(rawSVG).length,entireReceiptRawBytes:rawReceipt.length,wholeProductRawBytes:Buffer.byteLength(consumed)};
 let bindingValidation;
 if(job.bindingReference){let reference=job.bindingReference;try{const {gunzipSync}=await import('node:zlib');bindingValidation={wholeSVGExact:product.svg===gunzipSync(fs.readFileSync(reference.svgReference)).toString(),entireReceiptExact:JSON.stringify(product.receipt)===gunzipSync(fs.readFileSync(reference.receiptReference)).toString(),referenceHead:reference.sourceHead};}catch(error){bindingValidation={status:'reference-unavailable',message:error.message};}}
 gz('RESULT.json',{status:'returned',actualPublicCalls:1,runtime:process.version,bytes:Buffer.byteLength(consumed),wallMs,cpu:usedCPU,peakRssKiB:process.resourceUsage().maxRSS,sizes,bindingValidation,proof:product.receipt.layoutCertification,layoutDecisions:product.receipt.layoutDecisions,job});
 console.log(JSON.stringify({status:'returned',actualPublicCalls:1,wallMs,sizes,proofStatus:product.receipt.layoutCertification?.status}));
}catch(error){const failure=describeError(error);gz('RESULT.json',{status:'refused',actualPublicCalls:1,runtime:process.version,wallMs:performance.now()-start,cpu:process.cpuUsage(cpu),peakRssKiB:process.resourceUsage().maxRSS,failure,job});console.log(JSON.stringify({status:'refused',actualPublicCalls:1,failure}));process.exitCode=1;}
