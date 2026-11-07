from pathlib import Path
import json
out=Path('/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/astra')
root=Path('/tmp/pr449-main-integration-20261029-762')
core=(root/'src/layout/agentic-layered-core.ts').read_text()
needle='  const main = new Float64Array(vertices.length)'
trace='''  ;(globalThis as any).__astraTrace.push({input: structuredClone(input), rank:[...rank], bandHeights:[...bandHeights], gaps:[...gaps], channels:structuredClone(channels)})
'''
assert core.count(needle)==1
base=core.replace(needle,trace+needle)
needle2='  const { nodes, edges, padding, nodeSpacing, layerSpacing } = input'
intervention='''  if (input.nodes.length === 4 && input.edges.length === 4 && !input.groups?.length && input.edges.every(e => !e.label && e.minSpan === 1)) input = {...input, compactPrivateRanks: true, layerSpacing: 2 * input.layerSpacing}
'''
assert base.count(needle2)==1
(out/'diamond-core-observe.ts').write_text(base)
(out/'diamond-core-compact-clearance.ts').write_text(base.replace(needle2,intervention+needle2))
loader=Path('/tmp/pr449-week-comparison-20261101/er256-dda69/capture-overrides.mjs').read_text()
loader=loader[:loader.index('const gz=')]
loader+='''
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
'''
(out/'diamond-clearance.mjs').write_text(loader)
for v,file in [('baseline','diamond-core-observe.ts'),('compact-clearance','diamond-core-compact-clearance.ts')]:
 job={'root':str(root),'source':'flowchart TB\nn0 --> n1\nn0 --> n2\nn1 --> n3\nn2 --> n3','options':{'graphLayout':{'backend':'agentic'},'layoutSafety':'strict','padding':0,'nodeSpacing':40,'layerSpacing':48,'style':{'roles':{'node':{'fontSize':10,'paddingX':0,'paddingY':13.5}}}},'moduleOverrides':{str(root/'src/layout/agentic-layered-core.ts'):str(out/file)}}
 (out/('diamond-'+v+'-job.json')).write_text(json.dumps(job,indent=2))
