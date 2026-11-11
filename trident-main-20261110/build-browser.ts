import {pathToFileURL} from 'node:url'
const root=process.argv[2]!
process.chdir(root)
const {build}=await import('/tmp/pr449-main-integration-20261029-762/node_modules/tsup/dist/index.js')
const config=(await import(pathToFileURL(root+'/tsup.browser-lazy.config.ts').href)).default
await build({...config,config:false,dts:false,entry:Object.fromEntries(Object.entries(config.entry).map(([name,path])=>[name,root+'/'+path])),outDir:root+'/dist',tsconfig:root+'/tsconfig.json',clean:false})
