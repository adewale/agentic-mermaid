import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs'
import {join} from 'node:path'
import {portableCases,familySupportProbe} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/portable/cohorts.ts'
import {expandedFidelityCases} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/fidelity/cases.ts'
import {resolveArtifact,artifactIdentity,harnessIdentity} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/portable/artifacts.ts'
import {assertMermaidOracle} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/portable/mermaid-oracle.ts'
const out=import.meta.dir, roots={main:'/tmp/pr449-bench-main-4260-20261110',pr:'/tmp/pr449-bench-pr-599b-20261110'}
process.env.MERMAID_REFERENCE_DIR='/tmp/pr449-main-integration-20261029-762'
const oracle=assertMermaidOracle()
const registry=JSON.parse(readFileSync(join(out,'FAMILY-REGISTRY.json'),'utf8'))
const original=portableCases(),supplemental=registry.filter((f:any)=>!original.some(c=>c.family===f.id)).map((f:any)=>familySupportProbe(f.id)).filter(Boolean)
const diagnostics=['chain100','fanin100','chain300'].map(name=>{const j=JSON.parse(readFileSync(`/tmp/pr449-week-comparison-20261101/pipeline-dedup-20261110/final-flat-qualification/${name}-job.json`,'utf8'));return{id:'diagnostic:'+name,family:'flowchart',cohort:'scaling',source:j.source,expected:{accept:true,labels:[]},edit:{source:j.edit,expected:{accept:true,labels:[]}},provenance:'Existing fully consumed source job; no new semantic expectations'}})
const cases=[...original,...supplemental,...diagnostics]
const originalFidelity=expandedFidelityCases(),missing=registry.filter((f:any)=>!originalFidelity.some(c=>c.family===f.id)).map((f:any)=>{const c=familySupportProbe(f.id)!;return{id:'meaning:'+c.id,family:c.family,source:c.source,features:['existing-Trident-family-support-probe'],expected:{labels:c.expected.labels},provenance:'Unmodified pinned Trident family-support probe; deeper meaning unavailable'}})
const fidelity=[...originalFidelity,...missing]
cpSync('/tmp/pr449-week-comparison-20261101/trident-native-elk-df133-20261108/kit',join(out,'kit'),{recursive:true})
writeFileSync(join(out,'CASES.json'),JSON.stringify({original,supplemental,diagnostics,all:cases,registryFamilies:registry.map((f:any)=>f.id)},null,2)+'\n')
writeFileSync(join(out,'FIDELITY-CASES.json'),JSON.stringify({original:originalFidelity,supplemental:missing,selected:fidelity},null,2)+'\n')
const artifacts=Object.fromEntries(Object.entries(roots).map(([name,root])=>{const artifact=resolveArtifact('adewale/agentic-mermaid',root,'agentic','node','dist/index.js');return[name,artifactIdentity(artifact)]}))
writeFileSync(join(out,'IDENTITY.json'),JSON.stringify({sources:{main:'4260292397d4bca7624a30c34649eb943a5f8e0c',pr:'599bee58db7cb54293866cc8aa86c887ef93e9a4'},trident:'f080278e31e4202ca89d524e4ee9e4cf3cbff038',oracle,artifacts,harness:harnessIdentity(join(out,'kit')),scope:'Same scoped canonical Node index/agent-core/providers and lazy browser builds. Not npm tarball builds. No source or backend modification.'},null,2)+'\n')
console.log(JSON.stringify({portable:cases.length,original:original.length,supplemental:supplemental.length,diagnostics:diagnostics.length,fidelity:fidelity.length,families:registry.length}))
