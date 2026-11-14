// Existing product-reuse protocol: bind retained DOM observations to pinned Node products.
import fs from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root='/workspace/pr449-native-loop-20261113/main-combined/original99/',out=fileURLToPath(new URL('./',import.meta.url))+'node-products/';
if(!process.argv[2])throw new Error('Provide frozen candidate SDK root');
fs.mkdirSync(out,{recursive:true});
const cases=JSON.parse(fs.readFileSync(root+'FIDELITY-CASES.json','utf8')).selected;
const old=JSON.parse(fs.readFileSync(root+'fidelity/RESULTS.json','utf8'));
process.env.AGENTIC_MERMAID_ELK_CACHE='0';
const roots={candidate:process.argv[2]};
const apis={},parsers={};
for(const [target,path] of Object.entries(roots)){
 apis[target]=await import(pathToFileURL(path+'/dist/index.js'));
 parsers[target]=await import(pathToFileURL(path+'/dist/agent-core.js'));
}
const rows=[];
for(let index=0;index<cases.length;index++)for(const target of ['candidate'])for(const backend of ['agentic','elk']){
 const c=cases[index],prior=old.find(x=>x.id===c.id&&x.target===target&&x.backend===backend),api=apis[target],parser=parsers[target];
 for(const p of c.prelude??[]){try{api.renderMermaidSVG(p.source,p.renderOptions)}catch{};await parser.parseRegisteredMermaid(p.source)}
 const parsed=await parser.parseRegisteredMermaid(c.source);
 const rawJsonExact=JSON.stringify(parsed.ok?parsed.value.body:undefined)===JSON.stringify(prior.acquired?.raw);
 let product,error;
 try{product=api.renderMermaidSVGWithReceipt(c.source,{...c.renderOptions,graphLayout:{backend,fallback:'none'}})}catch(e){error={name:e.name,code:e.code,error:String(e),details:e.details}}
 const accepted=!!product,stem=index+'-'+target+'-'+backend;
 let exact=false,sha256;
 if(product&&prior.rendered.accepted){const whole=JSON.stringify(product),before=gunzipSync(fs.readFileSync(root+'node-products/'+index+'-candidate-'+backend+'.product.json.gz')).toString();exact=whole===before;sha256=createHash('sha256').update(whole).digest('hex');fs.writeFileSync(out+stem+'.product.json.gz',gzipSync(whole))}
 else if(!product&&!prior.rendered.accepted)exact=error.name===prior.rendered.name&&error.code===prior.rendered.code&&error.error===prior.rendered.error&&JSON.stringify(error.details)===JSON.stringify(prior.rendered.details);
 rows.push({id:c.id,target,backend,stem,accepted,priorAccepted:prior.rendered.accepted,wholeProductOrErrorExact:exact,serializedPublicBodyExact:rawJsonExact,publicParseAccepted:parsed.ok,sha256,error});
 if(rows.length%40===0)console.log(JSON.stringify({completed:rows.length,total:198}));
}
fs.writeFileSync(out+'INPUT.json',JSON.stringify({candidateRoot:process.argv[2],baselineSource:'c037a727de23228c2dccfc6f8bc12dcb77ba94ca',runtime:process.version,caseFile:root+'FIDELITY-CASES.json',cache:process.env.AGENTIC_MERMAID_ELK_CACHE},null,2)+'\n');
const changed=rows.filter(x=>!x.wholeProductOrErrorExact),rawChanged=rows.filter(x=>!x.serializedPublicBodyExact);
fs.writeFileSync(out+'RESULTS.json',JSON.stringify(rows,null,2)+'\n');
fs.writeFileSync(out+'SUMMARY.json',JSON.stringify({runtime:process.version,rows:rows.length,exact:rows.length-changed.length,changed,serializedPublicBodyChanged:rawChanged,scope:'Actual pinned-Node candidate public parser and complete product/error compared with the existing actual-Node c037 products; earlier DOM observations reused only under exact entire product bytes, same source/options/preludes. No baseline rerender or unchanged full-DOM replay. Serialized public-model comparison is not a proof of borrowed identity/getter behavior. No timing claim.'},null,2)+'\n');
console.log(JSON.stringify({runtime:process.version,rows:rows.length,exact:rows.length-changed.length,changed:changed.length,rawChanged:rawChanged.length}));
