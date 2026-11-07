import { layoutAgenticGraph } from '/tmp/pr449-main-integration-20261029-762/src/layout/agentic-layered.ts';
import { layoutGraphSync } from '/tmp/pr449-main-integration-20261029-762/src/layout-engine.ts';
import { parseMermaid } from '/tmp/pr449-main-integration-20261029-762/src/parser.ts';
import { countEdgeCrossings } from '/tmp/pr449-main-integration-20261029-762/src/layout-rubric.ts';
import { withRenderStageObserver } from '/tmp/pr449-main-integration-20261029-762/src/render-stages.ts';
import { layered, lnode, ledge } from './pele-3a2f075ee0c3d914f0fad3545fc0f193693975ac/src/layout/layered.ts';
import { render as peleRender } from './pele-3a2f075ee0c3d914f0fad3545fc0f193693975ac/src/index.ts';
import { render as pele19Render } from './pele-e7f092a4de147cc32210913c20e36eaa5fcd0ef1/src/index.ts';
const cases = [ ['diamond', [[0,1],[0,2],[1,3],[2,3]],4], ['shortcut',[[0,1],[1,2],[0,2]],3], ['ladder',[[0,1],[1,2],[2,3],[0,2],[1,3]],4] ] as const;
const results=[];
for(const [name,pairs,count] of cases) {
 const source = 'flowchart TB\n'+pairs.map(([a,b])=>`n${a} --> n${b}`).join('\n');
 const input = {nodes:Array.from({length:count},(_,i)=>({id:`n${i}`,width:60,height:40})),edges:pairs.map(([source,target])=>({source,target,minSpan:1})),direction:'TB' as const,padding:0,nodeSpacing:40,layerSpacing:48,edgeSpacing:16};
 const native = [false,true].map(compactPrivateRanks=>{ const out=layoutAgenticGraph({...input,compactPrivateRanks}); return {compactPrivateRanks,...out}; });
 const pn = input.nodes.map(()=>lnode(60,40)), pe = pairs.map(([a,b])=>ledge(a,b));
 const pele = layered(pn,pe,{nodeSep:40,edgeSep:16,rankSep:48,portSep:20,tracks:true});
 const stages=[]; const publicLayout=withRenderStageObserver(s=>stages.push(s.stage),()=>layoutGraphSync(parseMermaid(source),{graphLayout:{backend:'agentic'}}));
 results.push({name,source,input,native,pele:{...pele,nodes:pn,edges:pe},publicNative:{width:publicLayout.width,height:publicLayout.height,crossings:countEdgeCrossings(publicLayout.edges),certification:publicLayout.certification,stages},pelePublic:[pele19Render(source),peleRender(source)].map(({svg,width,height})=>({width,height,svg}))});
}
await Bun.write(new URL('./probe-results.json',import.meta.url),JSON.stringify(results,null,2));
console.log(results.map(r=>({name:r.name,native:r.native.map(n=>({compact:n.compactPrivateRanks,w:n.width,h:n.height})),pele:{w:r.pele.width,h:r.pele.height},publicNative:r.publicNative})));
