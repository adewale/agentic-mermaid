// NEW untimed preflight only. Never loaded by the unchanged calibration worker.
// Public synchronous Node24 resolution hooks; return/rethrow the original result.
import {registerHooks,isBuiltin} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,relative,dirname,isAbsolute} from 'node:path';

if(process.version!=='v24.19.0'||typeof registerHooks!=='function')throw Error('Public Node24 registerHooks required; no alternative loader.');
const hash=b=>createHash('sha256').update(b).digest('hex');
const artifactRoot=realpathSync(process.env.PR449_GRAPH_ARTIFACT_ROOT);
const protocolRoot=realpathSync(process.env.PR449_GRAPH_PROTOCOL_ROOT);
const out=process.env.PR449_GRAPH_OUTPUT;
if(!out||!isAbsolute(out))throw Error('Explicit graph output required');
const artifact=JSON.parse(readFileSync(resolve(artifactRoot,'../artifact.json')));
const source=JSON.parse(readFileSync(resolve(protocolRoot,'SOURCE-FREEZE.json')));
const events=[],mappingIssues=[];
function mapped(url){
 if(isBuiltin(url))return{kind:'node-builtin',url};
 if(!url.startsWith('file:'))return{kind:'unavailable',url,reason:'unsupported-resolved-scheme'};
 const file=realpathSync(fileURLToPath(url));
 for(const[root,files,kind]of[[artifactRoot,artifact.files,'frozen-hosted-artifact'],[protocolRoot,source.files,'frozen-diagnostic-source']]){
  const key=relative(root,file);
  if(key==='..'||key.startsWith('../')||isAbsolute(key))continue;
  const expected=files[key];
  if(!expected)return{kind:'unavailable',url,reason:'file-not-in-frozen-catalogue',file};
  const actual=hash(readFileSync(file));
  return{kind:actual===expected?kind:'unavailable',url,file,relative:key,sha256:actual,expectedSHA256:expected};
 }
 return{kind:'unavailable',url,reason:'resolved-file-outside-frozen-roots',file};
}
registerHooks({resolve(specifier,context,nextResolve){
 if(events.length>=10000)throw Error('Finite module-resolution event cap exceeded');
 const row={index:events.length,specifier,parentURL:context.parentURL??null,conditions:[...context.conditions]};
 events.push(row);
 try{
  const result=nextResolve(specifier,context);
  row.result={...result};
  try{row.mapping=mapped(result.url)}catch(e){row.mapping={kind:'unavailable',reason:String(e)}}
  if(row.mapping.kind==='unavailable')mappingIssues.push({index:row.index,...row.mapping});
  return result;
 }catch(error){
  // Actual failed resolution loads no module. Retain its error and unchanged
  // recovery behavior; never invent a successfully resolved module for it.
  row.resolutionError={name:error?.name,code:error?.code,message:String(error)};
  throw error;
 }
}});
process.once('exit',code=>{
 const report={protocol:'fresh-host-enrolled-public-module-resolution-graph@1',
  node:process.version,pid:process.pid,execPath:process.execPath,execArgv:process.execArgv,
  artifactRoot,artifactIdentity:artifact.identity,protocolRoot,
  complete:code===0,mappingIssues,events,
  scope:'Actual MAIN-thread Node resolution events after hook registration in one untimed75-input preflight. Not a --import preload: child worker-thread loaders are not observed. Not all possible dynamic branches, filesystem reads, native OS dependencies, startup bootstrap or a local actual-loader graph.',
  originalResultsReturnedAndErrorsRethrown:true,noCalibrationInstrumentation:true};
 const bytes=Buffer.from(JSON.stringify(report));
 if(bytes.length>4*1024*1024){process.exitCode=1;throw Error('Graph output cap4MiB exceeded')}
 mkdirSync(dirname(out),{recursive:true});writeFileSync(out,bytes,{flag:'wx'});
});
