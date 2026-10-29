const fs=require('node:fs'),assert=require('node:assert/strict');
const root=process.argv[2],phase=process.argv[3];
const jiti=require('/workspace/agentic-mermaid/node_modules/jiti')(root+'/package.json');
const {renderMermaidSVGWithReceipt,layoutMermaidWithReceipt}=jiti(root+'/src/agent/core.ts');
const {extractEdgesRecursively}=jiti(root+'/src/layout/passes/elk-edges.ts');
const {parseMermaid}=jiti(root+'/src/parser.ts');
const read=n=>fs.readFileSync(root+'/eval/layout-compare/fixtures/'+n+'.mmd','utf8');
const sources={
 flowchart:'flowchart TB\nsubgraph Outer\nsubgraph Inner\nA[Alpha]\nB[Beta]\nend\nend\nX[Outside]\nX-->A\nA-->B\nA-->B\nB-->A',
 state:'stateDiagram-v2\ndirection TB\nstate Outer {\nstate Inner {\nA --> B : forward\nB --> A : back\n}\n}\n[*] --> Outer\nOuter --> [*]',
 class:read('class-compound-backends'),
 er:read('er-compound-backends'),
 requirement:read('requirement-backends'),
};
const results=[];
for(const [family,input] of Object.entries(sources))for(const direction of ['TB','BT','LR','RL'])for(const style of [undefined,'publication-figure']){
 let source=input.replace(/^\s*direction\s+(TB|BT|LR|RL)\s*$/m,'direction '+direction);
 const options={graphLayout:{backend:'elk',fallback:'none'},...(style?{style}:{})};
 const id=family+'/'+direction+'/'+(style||'default');
 try{
  const svg=renderMermaidSVGWithReceipt(source,options).svg;
  const {layout}=layoutMermaidWithReceipt(source,options);
  for(const e of layout.edges)for(const point of e.path)assert(point.every(Number.isFinite),id+' has nonfinite geometry');
  results.push({id,ok:true,nodes:layout.nodes.map(n=>n.id),edges:layout.edges.map(e=>[e.id,e.from,e.to]),svg});
 }catch(e){results.push({id,ok:false,error:e.message});}
}
// Exercise the actual extraction boundary with independent authored corner
// expectations at ordinary, large, and huge coordinate scales.
let boundaryChecks=0;const boundaryResults=[];
for(const [anchor,delta,snap] of [[348.04,-5.684341886080802e-14,true],[348.04,1e-11,false],[348.04,1e-5,false],[1e9,5e-7,true],[1e9,2e-6,false],[1e16,2,false]]){
 const graph=parseMermaid('flowchart LR\nA-->B');
 const parts=[[[anchor-10,0],[anchor,0]],[[anchor+delta,20],[anchor+delta+40,20]]];
 const edges=[];extractEdgesRecursively({id:'root',edges:parts.map((p,order)=>({id:'p'+order,sources:['A'],targets:['B'],hierarchySegment:{edgeIndex:0,order},sections:[{id:'s'+order,startPoint:{x:p[0][0],y:p[0][1]},endPoint:{x:p[1][0],y:p[1][1]}}]}))},graph,edges,0,0);
 const expected=phase==='head'&&snap?anchor:anchor+delta;
 boundaryResults.push({anchor,delta,snap,expected,actual:edges[0].points.map(p=>[p.x,p.y])});
 if(anchor!==1e16)assert.equal(edges[0].points[2].x,expected);
 else assert(edges[0].points.some(p=>p.x===anchor+delta),'real 2px offset must survive orthogonalization');
 boundaryChecks++;
}
const out='/workspace/pr582-evidence';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/review-'+phase+'.json',JSON.stringify({boundaryChecks,boundaryResults,results},null,2));
console.log(JSON.stringify({phase,boundaryChecks,cases:results.length,successes:results.filter(r=>r.ok).length,failures:results.filter(r=>!r.ok).map(r=>({id:r.id,error:r.error}))}));
