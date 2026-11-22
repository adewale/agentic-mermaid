import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {communityCatalogFile} from './harness/unified/trident-paths.ts';
import {prepareCommunity} from './harness/unified/community.ts';
const root=import.meta.dirname,dir=root+'/model-review';mkdirSync(dir,{recursive:true});const catalog=JSON.parse(readFileSync(communityCatalogFile,'utf8')),ids=['dfadler/zombie-mermaid','Dicklesworthstone/frankenmermaid'];
for(const n of catalog.nodes)if(ids.includes(n.id)){delete n.benchmark.cliRelease;n.benchmark.outputs=['parse'];n.benchmark.moduleOutputs=['parse'];}
writeFileSync(dir+'/reviewed-catalog.json',JSON.stringify(catalog,null,2));const prepared=await prepareCommunity({root:root+'/harness',harnessRoot:'/tmp/issue621-trident-work/reviewed-models',out:dir+'/prepared',profile:'full',rounds:3,communityCatalogFile:dir+'/reviewed-catalog.json',communityProjects:ids});console.log(JSON.stringify(prepared.map(p=>({id:p.node.id,artifact:p.artifact?{root:p.artifact.root,module:p.artifact.module,version:p.artifact.version,revision:p.artifact.revision}:null,error:p.error}))));
