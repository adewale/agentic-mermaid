import {pathToFileURL} from 'node:url'
const root=process.argv[2]!
process.chdir(root)
const {build}=await import('/tmp/pr449-main-integration-20261029-762/node_modules/tsup/dist/index.js')
const config=(await import(pathToFileURL(root+'/tsup.config.ts').href)).default
const entries=['index','agent-core','elk-constructor','builtin-font-metrics','builtin-font-metrics.node','layout-optimization','layout-optimization.node']
await build({...config,config:false,dts:false,entry:Object.fromEntries(entries.map(name=>[name,root+'/'+config.entry[name]])),outDir:root+'/dist',tsconfig:root+'/tsconfig.json',clean:false,onSuccess:async()=>{process.chdir(root);await config.onSuccess()}})
