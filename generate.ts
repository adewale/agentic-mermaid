import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
const [root,phase,out,revision]=process.argv.slice(2)
if(!root||!phase||!out||!revision)throw new Error('Usage: bun generate.ts ROOT before|after OUT_DIR REVISION')
const actualRevision=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
if(actualRevision!==revision)throw new Error('Revision does not match source checkout')
const api=await import(join(root,'src/agent/index.ts'))
const {contactSheetScenarios}=await import(join(root,'eval/visual-rubric/scenarios.ts'))
const {parseMermaid}=await import(join(root,'src/parser.ts'))
const {layoutGraphSync}=await import(join(root,'src/layout-engine.ts'))
const {assessLayout}=await import(join(root,'src/layout-rubric.ts'))
const {auditRouteContracts}=await import(join(root,'src/route-contracts.ts'))
mkdirSync(out,{recursive:true})
const scenarios=contactSheetScenarios()
const cases=[
 {id:'shared-trunk-AJ',source:scenarios.find((s:any)=>s.letter==='AJ')!.source},
 {id:'class-v2',source:'classDiagram-v2\nclass Account {\n+int balance\n}\nAccount --> Ledger : records'},
 {id:'quadrant-semicolons',source:'quadrantChart\nx-axis Low --> High\ny-axis Low --> High\nA: [0.1, 0.2]; B: [0.3, 0.4]'},
 {id:'numeric-state',source:'stateDiagram-v2\n[*] --> A\nA --> [*]'},
]
const results=[]
for(const item of cases){
 const source=item.source+'\n',input=join(out,item.id+'.mmd')
 if(existsSync(input)&&readFileSync(input,'utf8')!==source)throw new Error('Source changed between revisions: '+item.id)
 writeFileSync(input,source)
 try{
  const rendered=api.renderMermaidSVGWithReceipt(source,{embedFontImport:false})
  const warnings:unknown[]=[]
  const png=api.renderMermaidPNGWithReceipt(source,{scale:1,onWarning:(warning:unknown)=>warnings.push(warning)})
  writeFileSync(join(out,`${item.id}-${phase}.svg`),rendered.svg)
  writeFileSync(join(out,`${item.id}-${phase}.png`),png.png)
  writeFileSync(join(out,`${item.id}-${phase}-layout.json`),JSON.stringify(api.layoutMermaidWithReceipt(source,{debug:true}).layout,null,2)+'\n')
  results.push({id:item.id,ok:true,revision,options:{svg:{embedFontImport:false},png:{scale:1}},warnings,receipt:rendered.receipt,runtime:png.runtime})
 }catch(error){
  writeFileSync(join(out,`${item.id}-${phase}-error.txt`),String(error)+'\n')
  results.push({id:item.id,ok:false,revision,error:String(error)})
 }
}
const geometry=scenarios.map((scenario:any)=>{
 const graph=parseMermaid(scenario.source),positioned=layoutGraphSync(graph)
 return {id:scenario.letter,quality:assessLayout(graph,positioned),routes:auditRouteContracts(positioned,graph),nodes:positioned.nodes.map((n:any)=>({id:n.id,label:n.label,x:n.x,y:n.y,width:n.width,height:n.height})),edges:positioned.edges.map((e:any)=>({source:e.source,target:e.target,label:e.label,points:e.points,labelPosition:e.labelPosition}))}
})
writeFileSync(join(out,`${phase}-results.json`),JSON.stringify({revision,runtime:{bun:process.versions.bun,platform:process.platform,arch:process.arch},results},null,2)+'\n')
writeFileSync(join(out,`${phase}-geometry.json`),JSON.stringify(geometry,null,2)+'\n')
console.log(JSON.stringify({phase,revision,results:results.map(({id,ok,error})=>({id,ok,error})),geometryCases:geometry.length}))
