// Untimed, public-API full-payload correctness capture. Never a cost worker.
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,readlinkSync,realpathSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join,resolve,dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {serialize,deserialize} from 'node:v8'
import {deepStrictEqual} from 'node:assert/strict'
const sha=b=>createHash('sha256').update(b).digest('hex')
const json=v=>JSON.stringify(v)
const [specPath,policy,role]=process.argv.slice(2)
if(process.version!=='v24.19.0'||!['off','normal'].includes(policy)||!['baseline','candidate','elk-reference','baseline-elk'].includes(role))throw Error('PinnedNode24/off|normal/baseline|candidate|elk-reference|baseline-elk required')
if(Object.hasOwn(process.env,'AGENTIC_MERMAID_SCENE_ASSERTIONS')||process.env.NODE_OPTIONS!=='')throw Error('Capture requires explicit default: SCENE_ASSERTIONS absent and NODE_OPTIONS empty')
const launcherEnvironment={NODE_OPTIONS:{present:Object.hasOwn(process.env,'NODE_OPTIONS'),value:process.env.NODE_OPTIONS},AGENTIC_MERMAID_SCENE_ASSERTIONS:{present:Object.hasOwn(process.env,'AGENTIC_MERMAID_SCENE_ASSERTIONS'),value:process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS??null}}
const launch={argv:process.argv,execArgv:process.execArgv,executable:process.execPath,environment:launcherEnvironment,observedBeforePolicyChangesAtUtc:new Date().toISOString()}
const spec=JSON.parse(readFileSync(specPath,'utf8'))
const frozen=(p,h)=>{const b=readFileSync(p);if(sha(b)!==h)throw Error('Frozen file changed:'+p);return b}
for(const [p,h]of Object.entries(spec.requiredFiles))frozen(p,h)
const enrollment=JSON.parse(frozen(spec.inputs.path,spec.inputs.sha256))
const inputs=enrollment.inputs
if(enrollment.scope!=='H27+D48'||inputs.length!==75||new Set(inputs.map(v=>v.occurrenceId)).size!==75||inputs.slice(0,27).some(v=>v.stratum!=='H27')||inputs.slice(27).some(v=>v.stratum!=='D48'))throw Error('Complete ordered75 required')
const artifactRole=role==='baseline'||role==='baseline-elk'?'baseline':'candidate'
const artifact=spec.artifacts[artifactRole]
function verifyLinks(){for(const [rel,target]of Object.entries(artifact.symlinks??{})){const path=join(artifact.root,rel);if(readlinkSync(path)!==target)throw Error('Frozen runtime link changed:'+path);const real=realpathSync(path),prefix=resolve(artifact.root)+'/';if(!real.startsWith(prefix))throw Error('Runtime dependency escaped isolated artifact:'+path)}}
verifyLinks()
const manifest={}
for(const [rel,h]of Object.entries(artifact.files)) {frozen(join(artifact.root,rel),h);manifest[rel]=h}
const identity=sha(json(Object.fromEntries(Object.keys(manifest).sort().map(k=>[k,manifest[k]]))))
if(identity!==artifact.identity)throw Error('Artifact canonical manifest identity mismatch')
const out=join(spec.output,`${policy}-${role}.json`)
if(existsSync(out))throw Error('Refusing capture overwrite/retry:'+out)
mkdirSync(spec.output,{recursive:true});const store=join(spec.output,'payloads');mkdirSync(store,{recursive:true})
function valuePayload(value){
 const bytes=serialize(value);deepStrictEqual(deserialize(bytes),value,'Complete public value V8 roundtrip must preserve deep equality')
 const digest=sha(bytes),path=join(store,digest+'.v8');if(existsSync(path))frozen(path,digest);else writeFileSync(path,bytes,{flag:'wx'})
 return{path,sha256:digest,bytes:bytes.length,v8RoundTripDeepEqual:true,representation:'Complete public values, V8 serialize/deserialize deepStrictEqual; no JSON normalization. Original object identity, property descriptors and executable callbacks are not transported.'}
}
function payload(value){const bytes=Buffer.from(value,'utf8'),digest=sha(bytes),path=join(store,digest);if(existsSync(path))frozen(path,digest);else writeFileSync(path,bytes,{flag:'wx'});return{path,sha256:digest,bytes:bytes.length}}
Object.assign(process.env,policy==='off'?{AGENTIC_MERMAID_ELK_CACHE:'0',AGENTIC_MERMAID_EXPERIMENTS:'text-spans'}:{AGENTIC_MERMAID_ELK_CACHE:'1',AGENTIC_MERMAID_EXPERIMENTS:'text-spans,position-cache'})
const api=await import(pathToFileURL(join(artifact.root,'dist/agent.js')).href)
const fidelity=await import(pathToFileURL(spec.fidelity).href)
const mode=role==='elk-reference'||role==='baseline-elk'?'elk':spec[role].layoutMode
const occurrences=[]
for(const input of inputs){
 const row={occurrenceId:input.occurrenceId,sourceSha256:sha(input.source),independentRequiredChecksPassed:false,nativeScenePaintStatus:'not-applicable',unverifiedLimitations:[],independentChecks:{},nativeScenePaintEvidence:[]}
 try{
  let finalSource=input.source,rendered,callbackCalls=0
  // EXACT request expression used by the frozen public-SVG worker.
  const options={...input.baseOptions,idPrefix:input.idPrefix,...fidelity.layoutRenderOptions(mode)}
  const render=source=>{finalSource=source;callbackCalls++;rendered=api.renderMermaidSVGWithReceipt(source,options);return rendered.svg}
  const svg=input.workflow?fidelity.renderAgentEdit(api,input.source,options,render):render(input.source)
  if(!rendered||svg!==rendered.svg||callbackCalls!==1)throw Error('Workflow final SVG/callback contract failed')
  row.svg=payload(svg);row.receipt=payload(json(rendered.receipt));row.finalSourceSha256=sha(finalSource)
  const positioned=api.layoutMermaidWithReceipt(finalSource,{...options,debug:true})
  row.layout=payload(json(positioned.layout));row.layoutReceipt=payload(json(positioned.receipt))
  const missing=fidelity.missingSvgLabels(svg,input.expectedSvgLabels)
  const metrics=api.measureQuality(positioned.layout)
  row.fullValues=valuePayload({finalSource,svg,receipt:rendered.receipt,debugLayout:positioned,metrics,missingLabels:missing})
  row.independentChecks={publicRenderAndLayoutSucceeded:true,oneFinalWorkflowCallback:callbackCalls===1,svgCapabilityAccepted:rendered.receipt.capabilityDecision?.accepted===true,layoutCapabilityAccepted:positioned.receipt.capabilityDecision?.accepted===true,missingExpectedSvgLabels:missing,fullPayloadsRetained:true}
  for(const [origin,c]of [['svgReceipt',rendered.receipt.layoutCertification],['layoutReceipt',positioned.receipt.layoutCertification],['layout',positioned.layout.paintCertification]])if(c){
   row.nativeScenePaintEvidence.push({origin,certificate:c})
   if(c.scope!=='native-scene'||!['passed','unverified','failed'].includes(c.status))throw Error('Unexpected paint certificate scope/status')
  }
  const certs=row.nativeScenePaintEvidence.map(v=>v.certificate)
  row.nativeScenePaintStatus=certs.some(c=>c.status==='failed')?'failed':certs.some(c=>c.status==='unverified')?'unverified':certs.length?'passed':'not-applicable'
  if(row.nativeScenePaintStatus==='unverified')row.unverifiedLimitations=row.nativeScenePaintEvidence.filter(v=>v.certificate.status==='unverified').flatMap(v=>[...v.certificate.limitations.map(s=>`${v.origin}: ${s}`),...v.certificate.issues.map(issue=>`${v.origin}: ${json(issue)}`)])
  row.independentChecks.noActualPaintFailure=row.nativeScenePaintStatus!=='failed'
  row.independentRequiredChecksPassed=row.independentChecks.svgCapabilityAccepted&&row.independentChecks.layoutCapabilityAccepted&&missing.length===0&&row.independentChecks.noActualPaintFailure
  if(!row.independentRequiredChecksPassed)row.failure={message:'One or more independent required checks failed; full payload retained'}
 }catch(e){row.failure={name:e?.name,message:String(e),code:e?.code,certificate:e?.certificate,certification:e?.certification};row.independentRequiredChecksPassed=false}
 occurrences.push(row)
 writeFileSync(out+'.progress.json',json({policy,role,complete:false,occurrences})+'\n')
 console.log(json({policy,role,occurrenceId:row.occurrenceId,passedRequired:row.independentRequiredChecksPassed,paint:row.nativeScenePaintStatus,failure:row.failure?.message}))
}
verifyLinks()
for(const [rel,h]of Object.entries(artifact.files))frozen(join(artifact.root,rel),h)
const result={protocol:'svg-independent-public-full-payload-oracle@2',supplementProtocol:'bounded-crossing-eight-role-full-value-V8-oracle@1',launch,scope:'H27+D48',policy,role,node:process.version,artifactIdentity:identity,source:spec[artifactRole].source,layoutMode:mode,captureSpecSha256:sha(readFileSync(specPath)),builderSha256:sha(readFileSync(new URL(import.meta.url))),occurrences}
writeFileSync(out,json(result)+'\n',{flag:'wx'})
const failed=occurrences.filter(v=>!v.independentRequiredChecksPassed).map(v=>v.occurrenceId)
console.log(json({complete:true,role,policy,rows:occurrences.length,failed,paintCounts:Object.fromEntries(['passed','unverified','not-applicable','failed'].map(status=>[status,occurrences.filter(v=>v.nativeScenePaintStatus===status).length]))}))
if(failed.length)process.exitCode=1
