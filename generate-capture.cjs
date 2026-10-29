const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2],revision=process.argv[3],label=process.argv[4];
const jiti=require('/workspace/agentic-mermaid/node_modules/jiti')(root+'/package.json');
const {renderMermaidSVGWithReceipt,layoutMermaidWithReceipt}=jiti(root+'/src/agent/core.ts');
const {measureQuality}=jiti(root+'/src/agent/quality.ts');
const {graphStressSamples}=jiti(root+'/eval/layout-compare/generated.ts');
const out='/workspace/pr582-evidence';fs.mkdirSync(out,{recursive:true});
const samples=[
 {id:'class-80-publication',source:graphStressSamples().find(s=>s.id.includes('class-80')).source,options:{style:'publication-figure'}},
 {id:'cyclic-labelled-15-chains',source:fs.readFileSync(root+'/eval/layout-compare/fixtures/cyclic-labelled-15-chains.mmd','utf8'),options:{}},
 {id:'multigraph-24-publication',source:graphStressSamples().find(s=>s.id.includes('flowchart-multigraph-24-loops')).source,options:{style:'publication-figure'}}
];
const receipt={revision,runtime:process.version,sourceRenderer:'src/agent/core.ts renderMermaidSVGWithReceipt',samples:[]};
for(const sample of samples){
 const stem=sample.id+'-'+label;
 fs.writeFileSync(path.join(out,sample.id+'.mmd'),sample.source);
 fs.writeFileSync(path.join(out,sample.id+'.options.json'),JSON.stringify(sample.options,null,2)+'\n');
 try{
  const rendered=renderMermaidSVGWithReceipt(sample.source,sample.options);
  const {layout,receipt:layoutReceipt}=layoutMermaidWithReceipt(sample.source,sample.options);
  const metrics=measureQuality(layout);
  fs.writeFileSync(path.join(out,stem+'.svg'),rendered.svg);
  fs.writeFileSync(path.join(out,stem+'.layout.json'),JSON.stringify(layout,null,2));
  fs.writeFileSync(path.join(out,stem+'.metrics.json'),JSON.stringify(metrics,null,2));
  receipt.samples.push({id:sample.id,options:sample.options,ok:true,receipt:rendered.receipt,layoutReceipt});
  console.log(stem,'OK',JSON.stringify({nodes:layout.nodes.length,edges:layout.edges.length,width:layout.width,height:layout.height}));
 }catch(e){fs.writeFileSync(path.join(out,stem+'.error.txt'),e.stack||e.message);receipt.samples.push({id:sample.id,options:sample.options,ok:false,error:e.message});console.log(stem,'ERROR',e.message.slice(0,180));}
}
fs.writeFileSync(path.join(out,'capture-'+label+'.json'),JSON.stringify(receipt,null,2));
