// Diagnostic-only source hooks, following renderer-profile.ts's private Bun.build pattern.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs'
const dir=import.meta.dir,root='/workspace/elk-layered-port/src/elk-layered/kernel/'
writeFileSync(dir+'/entry.ts',`export { elkLayoutSync } from '${root}layout.ts'`)
const replace=(s:string,a:string,b:string)=>{if(s.split(a).length!==2)throw Error('Diagnostic hook is not unique: '+a);return s.replace(a,b)}
const result=await Bun.build({entrypoints:[dir+'/entry.ts'],target:'node',format:'cjs',minify:false,sourcemap:'external',outdir:dir+'/instrumented',plugins:[{name:'phase-counts',setup(b){b.onLoad({filter:/kernel\/(layout|long-edges)\.ts$/},async args=>{let s=readFileSync(args.path,'utf8');const phase=(name:string,layers:string)=>`;(globalThis as any).__phase?.('${name}',${layers});\n`
if(args.path.endsWith('/long-edges.ts'))s=replace(s,'  const oldTarget = edge.target',`  ;(globalThis as any).__split?.(edge,dummy);\n  const oldTarget = edge.target`)
else{
s=replace(s,'  splitLongEdges(layers)',phase('before-splitting','layers')+'  splitLongEdges(layers)\n'+phase('after-splitting','layers'))
s=replace(s,'  minimizeCrossings(prepared.layers,',phase('before-crossing','prepared.layers')+'  minimizeCrossings(prepared.layers,')
s=replace(s,'  return finishLayout(prepared)',phase('after-crossing','prepared.layers')+'  return finishLayout(prepared)')
s=replace(s,'  placeNodes(layers, state.options)',phase('before-placement','layers')+'  placeNodes(layers, state.options)\n'+phase('after-placement','layers'))
s=replace(s,'  const size = routeOrthogonal(layers, state.options, random, measurement)',phase('before-routing','layers')+'  const size = routeOrthogonal(layers, state.options, random, measurement)\n'+phase('after-routing','layers'))
s=replace(s,'  joinLongEdges(layers, state.options)',phase('before-joining','layers')+'  joinLongEdges(layers, state.options)\n'+phase('after-joining','layers'))
}return {contents:s,loader:'ts'}})}}]});if(!result.success)throw result.logs
copyFileSync(dir+'/instrumented/entry.js',dir+'/instrumented/entry.cjs')
console.log('Prepared diagnostic build; production source and distribution unchanged.')
