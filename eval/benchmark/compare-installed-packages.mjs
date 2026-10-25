import assert from 'node:assert/strict'
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { gunzipSync,gzipSync } from 'node:zlib'
const [before,after,out]=process.argv.slice(2)
if(!before||!after||!out)throw new Error('Provide baseline capture, candidate capture and fresh output directory')
mkdirSync(out,{recursive:true})
const load=path=>JSON.parse(gunzipSync(readFileSync(path)))
const a=load(before),b=load(after),failures=[],functionNameDifferences=[]
for(const[side,value]of Object.entries({baseline:a,candidate:b}))if(!value.contractChecks||!Object.values(value.contractChecks).every(Boolean))failures.push({section:'nonvacuousContracts',side})
for(const section of ['exports','errors','declarations','licences','packageJson'])try{assert.deepStrictEqual(a[section],b[section])}catch(error){failures.push({section,message:error.message})}
const keys=Object.keys(a.outputs);assert.deepStrictEqual(Object.keys(b.outputs),keys)
let success=0,refusals=0
for(const key of keys){try{assert.deepStrictEqual(a.outputs[key],b.outputs[key]);a.outputs[key].ok?success++:refusals++}catch(error){failures.push({section:'outputs',key});writeFileSync(out+'/installed-failure-'+failures.length+'.json.gz',gzipSync(JSON.stringify({key,baseline:a.outputs[key],candidate:b.outputs[key]}),{level:9}))}}
for(const entry of Object.keys(a.functions))for(const key of Object.keys(a.functions[entry]))if(a.functions[entry][key]!==b.functions[entry]?.[key])functionNameDifferences.push({entry,export:key,baseline:a.functions[entry][key],candidate:b.functions[entry]?.[key]})
const normalize=path=>path.replace(/-([A-Za-z0-9_-]{8})(\.js|\.d\.ts)$/,(whole,hash,extension)=>/[A-Z0-9]/.test(hash)?`-[hash]${extension}`:whole)
const nonLazy=files=>files.filter(f=>!f.startsWith('dist/browser-lazy/chunks/')).map(normalize).sort()
try{assert.deepStrictEqual(nonLazy(a.files),nonLazy(b.files))}catch(error){failures.push({section:'nonLazyManifest',message:error.message})}
const result={runtime:process.version,outputs:keys.length,successfulComparisons:success,equalErrorComparisons:refusals,exports:Object.entries(a.exports).map(([entry,keys])=>({entry,count:keys.length,equal:JSON.stringify(keys)===JSON.stringify(b.exports[entry])})),declarationFiles:Object.keys(a.declarations).length,licenceFiles:Object.keys(a.licences).length,baselineFiles:a.files.length,candidateFiles:b.files.length,static:{baseline:a.static,candidate:b.static},functionNameDifferences,failures,scope:'Actual study archives installed by the maintained frozen-policy installer; complete receipt outputs retained in gzip captures. Reflective Function.name differences disclosed separately. No rebuild, repack or performance claim.'}
writeFileSync(out+'/installed-parity.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));assert.equal(failures.length,0)
