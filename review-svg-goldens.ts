import {readdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {Resvg} from '/workspace/agentic-mermaid-fixes/node_modules/@resvg/resvg-js'
import {formatSvgNumbers} from '/workspace/agentic-mermaid-fixes/src/svg-postprocess.ts'
import {inlineFontVarForRaster} from '/workspace/agentic-mermaid-fixes/src/theme.ts'
import {normalizeSvg} from '/workspace/agentic-mermaid-fixes/src/__tests__/helpers/svg-normalize.ts'
const root=process.argv[2] ?? '/workspace/agentic-mermaid-fixes'
const baseline=process.argv[3] ?? '98f19638d489badb278e3aa694b7f5a0c5234a5f'
const fonts=readdirSync(root+'/assets/fonts',{recursive:true}).filter(p=>/\.(ttf|otf)$/.test(String(p))).map(p=>join(root,'assets/fonts',String(p)))
const report=[]
for(const folder of ['src/__tests__/testdata/svg','src/__tests__/testdata/styled'])for(const filename of readdirSync(root+'/'+folder).filter(f=>f.endsWith('.svg'))){
 const path=folder+'/'+filename
 const before=execFileSync('git',['show',baseline+':'+path],{cwd:root,encoding:'utf8'})
 const after=readFileSync(root+'/'+path,'utf8')
 if(before.trim()===after.trim())continue
 if(normalizeSvg(after,{maskStyleScope:true})!==normalizeSvg(formatSvgNumbers(before),{maskStyleScope:true}))throw new Error('Non-formatting change in '+path)
 const raster=(s:string)=>new Resvg(inlineFontVarForRaster(s),{font:{fontFiles:fonts,loadSystemFonts:false,defaultFontFamily:'Inter'},background:'#ffffff'}).render()
 const a=raster(before),b=raster(after),ap=a.pixels,bp=b.pixels
 let differences=a.width===b.width&&a.height===b.height?0:-1
 if(differences===0)for(let i=0;i<ap.length;i++)if(ap[i]!==bp[i])differences++
 report.push({path,before:[a.width,a.height],after:[b.width,b.height],differentChannels:differences})
 Bun.gc(true)
}
writeFileSync(process.argv[4] ?? '/tmp/four-fixes-final-pixel-review.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({reviewed:report.length,identical:report.filter(r=>r.differentChannels===0).length,differences:report.filter(r=>r.differentChannels!==0)}))
