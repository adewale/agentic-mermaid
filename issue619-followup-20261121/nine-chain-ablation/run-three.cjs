// Three explicit configurations using the retained serial launcher and unchanged consumed-product worker.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),zlib=require('node:zlib');
const [configuration,out]=process.argv.slice(2);
const arms=JSON.parse(fs.readFileSync(configuration,'utf8'));
const candidateRoot=arms.find(arm=>arm.label==='ts-final')?.root,candidateRevision=arms.find(arm=>arm.label==='ts-final')?.source;
if(!candidateRoot||!candidateRevision||!out)throw Error('candidateRoot candidateRevision freshOut required');
if(fs.existsSync(out))throw Error('Preserve prior run; use a fresh output directory');
fs.mkdirSync(out,{recursive:true});
const directory=__dirname,identity={arms,protocolOrigin:'/workspace/elk-layered-tools/current-main-2c689f-comparison/final96-render-protocol',workerSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(directory,'receipt-worker.mjs'))).digest('hex'),scope:'Full SVG+entire receipt serialization+UTF8 inside API clocks; import/cold/cache/edit separate, compression and explicit GC outside; RSS includes whole harness',sampling:'Three balanced fresh processes per configuration/cache/case; seven warm repeats; one actual source edit followed by three repeat renders of that edit; exploratory, not formal calibration'},cases=JSON.parse(fs.readFileSync(path.join(directory,'cases.json'),'utf8'));
identity.casesSha256=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(directory,'cases.json'))).digest('hex');identity.cases=cases.length;identity.launcherSha256=require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');identity.nodeVersion=process.version;identity.nodeBinary=process.execPath;identity.candidateRoot=candidateRoot;identity.candidateRevision=candidateRevision;identity.start=new Date().toISOString();identity.timingStatus='RUNNING';
fs.writeFileSync(path.join(out,'identity.json'),JSON.stringify(identity,null,2));
let completed=0,lifecycleErrors=0;
for(const cache of [0])for(let index=0;index<cases.length;index++)for(const replica of [0,1,2]){
 const c=cases[index],rotation=(index+replica+cache)%arms.length,ordered=[...arms.slice(rotation),...arms.slice(0,rotation)];
 for(const arm of ordered){
  const stem=`cache${cache}-${arm.label}-${c.id.replace(/[^a-z0-9_.-]/gi,'_')}-${replica}`,destination=path.join(out,stem),file=destination+'.job.json';
  const phases=[...Array.from({length:7},(_,i)=>'repeat'+(i+1)),...(c.edit?.source?['edit1','edit2','edit3','edit4']:[])];
  const job={prepareHandoff:arm.prepareHandoff,root:arm.root,case:c.id,backend:arm.backend,source:c.source,edit:c.edit?.source??c.source,options:{...c.renderOptions,graphLayout:{backend:arm.backend,fallback:'none'}},profile:false,observers:false,phases};
  fs.writeFileSync(file,JSON.stringify(job));
  const result=cp.spawnSync(process.execPath,['--expose-gc',path.join(directory,'receipt-worker.mjs'),destination,file],{env:{...process.env,AGENTIC_MERMAID_ELK_CACHE:String(cache),AGENTIC_MERMAID_SCENE_ASSERTIONS:'0'},timeout:180000,encoding:'utf8',maxBuffer:4*1024*1024});
  fs.writeFileSync(destination+'.log',(result.stdout??'')+(result.stderr??''));
  let data;try{data=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(destination,'RESULT.json.gz'))));}catch(error){lifecycleErrors++;data={status:'lifecycle-error',error:String(error),exitCode:result.status,signal:result.signal};}
  fs.appendFileSync(path.join(out,'results.jsonl'),JSON.stringify({arm:arm.label,cache,replica,id:c.id,family:c.family,origin:c.measurementOrigin,source:arm.source,backend:arm.backend,actualEdit:!!c.edit?.source,data})+'\n');completed++;
  if(completed%6===0)console.log(JSON.stringify({completed,total:cases.length*1*3*arms.length,lifecycleErrors,cache,id:c.id}));
 }
}
identity.end=new Date().toISOString();identity.timingStatus='COMPLETED';identity.completed=completed;identity.lifecycleErrors=lifecycleErrors;fs.writeFileSync(path.join(out,'identity.json'),JSON.stringify(identity,null,2));console.log(JSON.stringify({completed,lifecycleErrors,out}));
