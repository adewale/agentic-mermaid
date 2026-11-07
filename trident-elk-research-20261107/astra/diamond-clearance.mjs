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
   const original=fs.readFileSync(job.moduleOverrides?.[fileURLToPath(url)] ?? fileURLToPath(url),'utf8');
   const source=stripTypeScriptTypes(original,{mode:'transform',sourceMap:true,sourceUrl:url});
   const m=source.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
   if(m)maps[url]=JSON.parse(Buffer.from(m[1],'base64').toString());
   return{format:'module',shortCircuit:true,source};
  }
  return next(url,context);
 }
});

globalThis.__astraTrace=[];
const rawApi=await import(pathToFileURL(root+'/src/layout/agentic-layered.ts'));
const api=await import(pathToFileURL(root+'/src/index.ts'));
const agent=await import(pathToFileURL(root+'/src/agent/core.ts'));
const input={nodes:Array.from({length:4},(_,i)=>({id:`n${i}`,width:60,height:40})),edges:[[0,1],[0,2],[1,3],[2,3]].map(([source,target])=>({source,target,minSpan:1})),direction:'TB',padding:0,nodeSpacing:40,layerSpacing:48,edgeSpacing:16};
const raw=rawApi.layoutAgenticGraph(input);
const rawTrace=globalThis.__astraTrace.splice(0);
const product=api.renderMermaidSVGWithReceipt(job.source,job.options);
JSON.stringify(product);
const publicTrace=globalThis.__astraTrace.splice(0);
const layout=agent.layoutMermaidWithReceipt(job.source,{...job.options,debug:true});
const expected=['n0>n1','n0>n2','n1>n3','n2>n3'].sort();
const actual=layout.layout.edges.map(e=>e.from+'>'+e.to).sort();
const boxes=layout.layout.nodes;
const n=Object.fromEntries(boxes.map(b=>[b.id,b]));
const gaps=[n.n1.y-n.n0.y-n.n0.h,n.n2.y-n.n0.y-n.n0.h,n.n3.y-n.n1.y-n.n1.h,n.n3.y-n.n2.y-n.n2.h];
const result={job,raw,rawTrace,publicTrace,layout,checks:{meaning:JSON.stringify(actual)===JSON.stringify(expected),nodeIdentities:boxes.map(b=>b.id).sort(),gaps,allGapsAtLeast48:gaps.every(g=>g>=48-1e-8),boxes60x40:boxes.every(b=>b.w===60&&b.h===40),paintProof:product.receipt.layoutCertification},product};
fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));
fs.writeFileSync(out+'/actual.svg',product.svg);
console.log(JSON.stringify({raw:{w:raw.width,h:raw.height},public:layout.layout.bounds,checks:result.checks}));
