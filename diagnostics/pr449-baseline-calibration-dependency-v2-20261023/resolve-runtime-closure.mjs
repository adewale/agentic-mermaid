// Diagnostic preparation ONLY. Public resolution without importing package code.
import{createRequire}from'node:module';
import{readFileSync,realpathSync,existsSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{resolve,dirname,relative,isAbsolute,join}from'node:path';
import{fileURLToPath}from'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const load=p=>JSON.parse(readFileSync(p));
function contained(root,path){const rel=relative(root,path);return rel!== '..'&&!rel.startsWith('../')&&!isAbsolute(rel)}
export function resolveRuntimeClosure(project,spec,{onObservation=()=>{}}={}){
 project=realpathSync(project);
 if(spec.protocol!=='consumer-root-runtime-dependency-location@2')throw Error('Unknown dependency-location protocol');
 if(sha(readFileSync(join(project,'package.json')))!==spec.projectPackageJSONSHA256||sha(readFileSync(join(project,'bun.lock')))!==spec.lockSHA256)throw Error('Fixed project package/lock mismatch');
 const packages=spec.packages,roots=new Map(),records=[],pending=[...spec.roots,...spec.edges];
 if(new Set(Object.values(packages).map(p=>p.name)).size!==Object.keys(packages).length)throw Error('Ambiguous expected package name');
 for(const edge of pending){
  if(!packages[edge.target]||edge.consumer!=='$project'&&!packages[edge.consumer])throw Error('Unknown consumer/target');
  const want=packages[edge.target],locked=spec.lockedRecords[edge.lockKey];
  if(edge.specifier!==want.name||!locked||locked[0]!==want.name+'@'+want.version)throw Error('Frozen consumer-lock identity mismatch');
 }
 while(pending.length){let progress=false;
  for(let i=0;i<pending.length;){const edge=pending[i];
   if(edge.consumer!=='$project'&&!roots.has(edge.consumer)){i++;continue}
   const consumer=edge.consumer==='$project'?project:roots.get(edge.consumer),wanted=packages[edge.target];
   const consumerPackage=join(consumer,'package.json'),req=createRequire(consumerPackage);
   // resolve() returns a filename without evaluating JavaScript/native modules.
   const entry=realpathSync(req.resolve(edge.specifier));
   if(!contained(project,entry))throw Error('Resolved entry escapes fixed source checkout');
   let current=dirname(entry),found=null;
   for(let depth=0;depth<64&&contained(project,current);depth++){
    const metadataPath=join(current,'package.json');
    if(existsSync(metadataPath)){
     if(!contained(project,realpathSync(metadataPath)))throw Error('Package metadata escapes fixed source checkout');
     const bytes=readFileSync(metadataPath),metadata=JSON.parse(bytes);
     if(metadata.name){
      onObservation({...edge,consumerRoot:consumer,resolvedEntry:entry,packageRoot:current,actualName:metadata.name,actualVersion:metadata.version,actualPackageJSONSHA256:sha(bytes),expectedName:wanted.name,expectedVersion:wanted.version});
      if(metadata.name!==wanted.name)throw Error('Resolved entry belongs to another named package');
      if(metadata.version!==wanted.version||sha(bytes)!==wanted.packageJSONSHA256)throw Error('Consumer-resolved package identity mismatch:'+wanted.name);
      found=current;break;
     }
    }
    const parent=dirname(current);if(parent===current)break;current=parent;
   }
   if(!found)throw Error('Containing package root unavailable');
   if(roots.has(edge.target)&&roots.get(edge.target)!==found)throw Error('Consumer edges resolve divergent package roots');
   roots.set(edge.target,found);
   records.push({...edge,consumerRoot:consumer,consumerPackageJSONSHA256:sha(readFileSync(consumerPackage)),
    resolvedEntry:entry,resolvedEntrySHA256:sha(readFileSync(entry)),packageRoot:found,
    packageName:wanted.name,packageVersion:wanted.version,packageJSONSHA256:wanted.packageJSONSHA256,
    resolution:'Public createRequire(consumer package.json).resolve(specifier); no package import'});
   pending.splice(i,1);progress=true;
  }
  if(!progress)throw Error('Unreachable consumer dependency closure');
 }
 if(roots.size!==Object.keys(packages).length)throw Error('Incomplete exact expected closure');
 return{protocol:'consumer-root-runtime-dependency-resolution-result@2',node:process.version,execPath:process.execPath,
  projectRoot:project,projectPackageJSONSHA256:spec.projectPackageJSONSHA256,lockSHA256:spec.lockSHA256,
  qualified:true,packages:Object.fromEntries(roots),edges:records,noPackageCodeImported:true,
  scope:'Exactly declared original consuming-package closure, not all installed packages or all dynamic loads. Each declared edge resolves from its actual consumer; no matching-version global search.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[project,specPath,out]=process.argv.slice(2);
 const observations=[];let report;
 try{report=resolveRuntimeClosure(project,load(specPath),{onObservation:row=>observations.push(row)})}
 catch(error){process.exitCode=1;report={protocol:'consumer-root-runtime-dependency-resolution-result@2',qualified:false,node:process.version,execPath:process.execPath,error:{name:error.name,message:error.message},noPackageCodeImported:true}}
 writeFileSync(out,JSON.stringify({...report,specSHA256:sha(readFileSync(specPath)),actualPackageObservations:observations},null,2)+'\n',{flag:'wx'});
}
