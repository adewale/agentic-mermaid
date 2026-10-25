// Capture supplied installed bytes only; this helper never builds, packs or installs.
import { pathToFileURL } from 'node:url'
import { readFileSync,writeFileSync,readdirSync } from 'node:fs'
import { join,relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
const root=process.argv[2],output=process.argv[3],arms={}
for(const entry of ['index','svg','svg-styles','agent','agent-core']) arms[entry]=await import(pathToFileURL(root+'/dist/'+entry+'.js').href)
const exports={},functions={};for(const[entry,module]of Object.entries(arms)){exports[entry]=Object.keys(module).sort();functions[entry]=Object.fromEntries(Object.entries(module).filter(([,value])=>typeof value==='function').map(([key,value])=>[key,value.name]))}
const families=arms.agent.knownFamilies().map(id=>arms.agent.getFamily(id)),outputs={}
const capture=fn=>{try{return{ok:true,value:fn()}}catch(e){return{ok:false,error:{name:e.name,message:e.message}}}}
for(const family of families)for(const [i,option]of [{},{security:'strict'},{style:'hand-drawn'},{style:'excalidraw'},{mermaidConfig:{theme:'dark'}}].entries())for(const entry of ['index','svg'])outputs[`${family.id}|${entry}|${i}`]=capture(()=>arms[entry].renderMermaidSVGWithReceipt(family.example,option))
for(const family of families)for(const useAscii of [true,false])outputs[`${family.id}|ascii|${useAscii}`]=capture(()=>arms.index.renderMermaidASCIIWithReceipt(family.example,{useAscii}))
const paint=new arms.index.PaintLayoutCertificationError({issues:[]})
const errors={paint:{name:paint.name,code:paint.code,message:paint.message,instanceofOwnExport:paint instanceof arms.index.PaintLayoutCertificationError,instanceofOtherEntry:paint instanceof arms.svg.PaintLayoutCertificationError,constructorOwnExport:paint.constructor===arms.index.PaintLayoutCertificationError},refused:[]}
for(const entry of ['index','svg'])try{arms[entry].renderMermaidSVG('flowchart TD\nA-->B',{security:'invalid'})}catch(e){errors.refused.push({entry,name:e.name,message:e.message,typeError:e instanceof TypeError})}
const files=[];function visit(dir){for(const name of readdirSync(dir,{withFileTypes:true})){if(name.name==='node_modules')continue;const file=join(dir,name.name);if(name.isDirectory()){if(name.name!=='node_modules')visit(file)}else files.push(relative(root,file))}}visit(root)
const sha=file=>createHash('sha256').update(readFileSync(root+'/'+file)).digest('hex')
const declarations=Object.fromEntries(files.filter(f=>f.endsWith('.d.ts')).sort().map(f=>[f,sha(f)]))
const licences=Object.fromEntries(files.filter(f=>f.startsWith('LICENSE')||f==='THIRD_PARTY_NOTICES.md').sort().map(f=>[f,sha(f)]))
const pkg=JSON.parse(readFileSync(root+'/package.json','utf8'))
const browser=readFileSync(root+'/dist/browser.global.js')
const contractChecks={canonicalFamilies:families.length===23,completeSuccessfulOutputs:Object.keys(outputs).length===276&&Object.values(outputs).every(value=>value.ok),fiveNonemptyExportInventories:Object.keys(exports).length===5&&Object.values(exports).every(value=>value.length>0),paintError:errors.paint.name==='PaintLayoutCertificationError'&&errors.paint.code==='PAINT_LAYOUT_CERTIFICATION_FAILED'&&errors.paint.message==='Final paint certification failed: '&&errors.paint.instanceofOwnExport&&errors.paint.instanceofOtherEntry&&errors.paint.constructorOwnExport,securityRefusals:errors.refused.length===2&&errors.refused.every(value=>value.name==='RenderConfigError'&&value.message==='Invalid RenderOptions: render option "security" must be default or strict'&&value.typeError)}
const result={contractChecks,runtime:process.version,exports,functions,outputs,errors,declarations,licences,files:files.sort(),packageJson:pkg,static:{browserRaw:browser.length,browserGzip:gzipSync(browser,{level:9}).length,unpackedBytes:files.reduce((sum,file)=>sum+readFileSync(root+'/'+file).length,0)}}
writeFileSync(output,gzipSync(JSON.stringify(result),{level:9}));console.log(JSON.stringify({output,outputs:Object.keys(outputs).length,successes:Object.values(outputs).filter(o=>o.ok).length,refusals:Object.values(outputs).filter(o=>!o.ok).length,files:files.length,static:result.static,contractChecks}));if(!Object.values(contractChecks).every(Boolean))process.exitCode=1
