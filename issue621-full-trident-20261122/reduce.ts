import {readFileSync,writeFileSync} from 'node:fs';
import {threeBenchmarkReport,renderDavebenchFamilies} from './harness/unified/three-benchmark-report.ts';
import {synthesiseBenchmarks} from './harness/unified/overall-score.ts';
import {fidelityScoring} from './harness/unified/mermaid-fidelity/scoring.ts';
import {publishDrawingRun} from './harness/scripts/merge-drawing-results.ts';
import {mergeFidelityRuns} from './harness/scripts/merge-fidelity-runs.ts';
import {assessmentConfirmations,checkRefusalVerification} from './harness/unified/mermaid-fidelity/verification.ts';
const root=import.meta.dirname,read=(p:string)=>JSON.parse(readFileSync(root+'/'+p,'utf8')),write=(p:string,data:any)=>writeFileSync(root+'/'+p,JSON.stringify(data,null,2)+'\n');
const arms=read('arms.json'),peerRaw=read('peers/fidelity/results.json');
const reviewPaths=['fidelity-capability-review-2026-11-14.json','fidelity-model-concept-review-2026-11-14.json','fidelity-model-concept-review-2026-11-15.json'].map(x=>'harness/docs/evidence/'+x);
const reviews=assessmentConfirmations(reviewPaths.map(read)),refusals=checkRefusalVerification(read('refusal-verification.json'));
const outputs=[];
for(const arm of [...arms,{id:'peers'}]){
 const id=arm.id,own=id==='peers'?'current-default':id.replace(/-(balanced|native)$/,'-default'),catalog=read(id==='peers'?'versions-current/catalog.json':id+'/catalog.json');
 const raw=read(own+'/fidelity/results.json');
 const fidelity=mergeFidelityRuns([raw,peerRaw],{catalog,refusals,reviews,evidence:{refusals:'refusal-verification.json',reviews:reviewPaths,freshRaw:[own+'/fidelity/results.json','peers/fidelity/results.json']}});
 const dave=threeBenchmarkReport(read(id+'/'+(id==='peers'?'dave-images-recovery2':'dave-images')+'/results.json'),read((id==='peers'?'peers/dave-terminal-recovery':own+'/dave-terminal')+'/results.json'),read(id==='peers'?'versions-current/versions.json':id+'/versions.json'));
 const drawing=publishDrawingRun(read(id+'/drawing/results.json'));
 const project=id==='peers'?null:'adewale/agentic-mermaid';
 const scores=synthesiseBenchmarks(dave,drawing,fidelity,catalog).filter((r:any)=>project?r.project===project:r.project!=='adewale/agentic-mermaid');
 const sc=fidelityScoring(fidelity,catalog);
 const result={arm,commonScope:fidelity.scoring,scoredPopulation:sc.population,scores,dave:{corpus:dave.corpus,rankings:dave.rankings,method:dave.collection,blocked:dave.blocked,runs:dave.runs},drawing:{corpus:drawing.corpus,results:drawing.results,blocked:drawing.blocked,method:drawing.method},fidelity:{results:sc.results.filter((r:any)=>project?r.project===project:r.project!=='adewale/agentic-mermaid').map((r:any)=>({...r,score:sc.score(r)})),blocked:fidelity.blocked,notApplicable:fidelity.notApplicable,coverage:fidelity.coverage}};
 write(id+'/dave-report.json',dave);write(id+'/drawing-summary.json',drawing);write(id+'/fidelity-summary.json',fidelity);write(id+'/scores.json',result);const family=renderDavebenchFamilies(dave,catalog);if(family)writeFileSync(root+'/'+id+'/families.md',family);outputs.push(result);
}
write('scores.json',{trident:{version:'0.4.0',release:'ceb42fa47215f5349cbe96ed56ef48a7b90095b4',adapters:'43ac1128f67ab5674d0c303084bc1503f96ec249',localPatch:'adapter-review-additions.patch'},outputs});
for(const row of outputs)console.log(JSON.stringify({id:row.arm.id,population:row.scoredPopulation,scores:row.scores,fidelity:row.fidelity.results.map((r:any)=>({project:r.project,score:r.score}))}));
