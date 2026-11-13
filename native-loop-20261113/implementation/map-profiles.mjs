import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
const {TraceMap,originalPositionFor}=createRequire('/workspace/agentic-mermaid/package.json')('@jridgewell/trace-mapping');
const root=path.dirname(fileURLToPath(import.meta.url));
const read=p=>JSON.parse(gunzipSync(fs.readFileSync(p)));
const maps=new Map(),summary={};
const add=(m,k,t)=>m.set(k,(m.get(k)??0)+t);
function location(f){
 let original;
 if(f.url.startsWith('file:')){
  const map=fileURLToPath(f.url)+'.map';
  if(!maps.has(map))maps.set(map,fs.existsSync(map)?new TraceMap(JSON.parse(fs.readFileSync(map,'utf8'))):undefined);
  if(maps.get(map))original=originalPositionFor(maps.get(map),{line:f.lineNumber+1,column:f.columnNumber});
 }
 return JSON.stringify({function:f.functionName,generatedFile:path.basename(f.url),generatedLine:f.lineNumber+1,generatedColumn:f.columnNumber,source:original?.source,line:original?.line,column:original?.column,name:original?.name});
}
for(const c of ['chain100','fanin100','chain300'])for(const arm of ['baseline','candidate']){
 const dir=path.join(root,'mapped-profile-'+arm+'-'+c),self=new Map(),inclusive=new Map();let total=0;
 for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.cpuprofile.gz'))){
  const p=read(path.join(dir,name)),nodes=new Map(p.nodes.map(n=>[n.id,n])),parents=new Map(),keys=new Map();
  for(const n of p.nodes){keys.set(n.id,location(n.callFrame));for(const child of n.children??[])parents.set(child,n.id);}
  for(let index=0;index<p.samples.length;index++){
   let id=p.samples[index];const t=p.timeDeltas[index];total+=t;add(self,keys.get(id),t);const seen=new Set();
   while(id){const k=keys.get(id);if(!seen.has(k)){add(inclusive,k,t);seen.add(k);}id=parents.get(id);}
  }
 }
 const rows=m=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,100).map(([k,t])=>({...JSON.parse(k),sampledMsPerRender:t/10000,pct:t*100/total}));
 summary[arm+'-'+c]={renders:10,profileMs:total/1000,self:rows(self),inclusive:rows(inclusive)};
 console.log(arm,c,JSON.stringify(rows(self).slice(0,8)));
}
fs.writeFileSync(path.join(root,'MAPPED-PROFILES.json'),JSON.stringify({scope:'Sampled wall contributions, source maps from matching build pipeline; inspector overhead retained. Inclusive rows overlap and do not sum. No unprofiled milliseconds saved inferred.',summary},null,2)+'\n');
const controls=[];
for(const c of ['chain100','fanin100','chain300']){
 const canonical=path.join(root,'profile-'+c),baseline=path.join(root,'mapped-profile-baseline-'+c),candidate=path.join(root,'mapped-profile-candidate-'+c);
 for(const arm of ['baseline','candidate']){
  const dir=arm==='baseline'?baseline:candidate,result=read(path.join(dir,'RESULT.json.gz'));
  for(const phase of ['warmup',...result.rows.slice(1).map(r=>r.phase)])for(const part of ['svg','receipt.json']){
   const file=phase+'.'+part+'.gz',control='warmup.'+part+'.gz';
   controls.push({case:c,arm,phase,part,exactCanonical:gunzipSync(fs.readFileSync(path.join(dir,file))).equals(gunzipSync(fs.readFileSync(path.join(canonical,control))))});
  }
 }
}
fs.writeFileSync(path.join(root,'BUILD-PRODUCT-CONTROLS.json'),JSON.stringify({comparisons:controls.length,allExact:controls.every(r=>r.exactCanonical),controls},null,2)+'\n');
console.log('product-controls',controls.length,controls.every(r=>r.exactCanonical));
