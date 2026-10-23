import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus, release, platform, arch } from 'node:os'
import { fixtures } from './fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
if (args.length !== 4 || args[0] !== '--config' || args[2] !== '--out') throw Error('Usage: node run.mjs --config frozen-config.json --out NEW_OUTPUT_DIRECTORY')
const configPath = resolve(args[1]), out = resolve(args[3])
if (existsSync(out)) throw Error('Output directory already exists: use a fresh path')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
if (config.caseIds !== undefined && (!Array.isArray(config.caseIds) || !config.caseIds.length || new Set(config.caseIds).size !== config.caseIds.length || config.caseIds.some(id => !fixtures.some(fixture => fixture.id === id)))) throw Error('caseIds must be a nonempty unique list of known fixture ids')
const selectedFixtures = config.caseIds === undefined ? fixtures : fixtures.filter(fixture => config.caseIds.includes(fixture.id))
const hash = x => createHash('sha256').update(x).digest('hex')
const median = xs => { const a = [...xs].sort((a,b) => a-b); return a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1)-1]+a[a.length >> 1])/2 }
const node = config.node ?? process.execPath
const settings = { rounds: 7, aaRounds: 3, samples: 5, allocationSamples: 1, warmupCalls: 2, warmupMs: 80, regimes: ['repeat', 'new-source'], workerTimeoutMs: 20*60*1000, ...config.settings }
const featurePolicy=config.featurePolicy ?? 'default'
if(!['default','disabled'].includes(featurePolicy)) throw Error('featurePolicy must be default or disabled')
if(!config.acquisitionPath) throw Error('acquisitionPath is required')
const acquisitionPath=resolve(config.acquisitionPath), acquisition=JSON.parse(readFileSync(acquisitionPath,'utf8'))
if(acquisition.status!=='passed' || acquisition.dependencyGraphIdentical!==true) throw Error('Acquisition/dependency verification did not pass')
if(hash(readFileSync(acquisition.lock.path))!==acquisition.lock.sha256) throw Error('Frozen dependency lock changed since acquisition')
for (const name of ['rounds','aaRounds','samples','allocationSamples','warmupCalls','workerTimeoutMs']) if (!Number.isSafeInteger(settings[name]) || settings[name] < 1) throw Error(`Invalid setting ${name}`)
if (!Number.isSafeInteger(settings.warmupMs) || settings.warmupMs < 0) throw Error('Invalid warmupMs')
if (!Array.isArray(settings.regimes) || !settings.regimes.length || new Set(settings.regimes).size !== settings.regimes.length || settings.regimes.some(x => !['repeat', 'new-source'].includes(x))) throw Error('Invalid regimes')
mkdirSync(out, { recursive: true })
const identities = {}
function treeFiles(root, prefix = '') { return readdirSync(join(root, prefix), { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e => e.isDirectory() ? treeFiles(root, join(prefix,e.name)) : e.isFile() ? [{ path: join(prefix,e.name), sha256: hash(readFileSync(join(root,prefix,e.name))) }] : (()=>{throw Error('Symlink or special file in frozen dist')})()) }
for (const role of ['baseline', 'candidate']) {
  const identity = config[role] ?? { sourceRevision:acquisition[role].sourceRevision, artifactSha256:acquisition[role].archive.sha256, tarball:acquisition[role].archive.path, packageRoot:acquisition[role].root }
  if (!identity || !/^[0-9a-f]{40}$/.test(identity.sourceRevision) || !/^[0-9a-f]{64}$/.test(identity.artifactSha256)) throw Error(`Invalid frozen identity for ${role}`)
  const artifact = resolve(identity.tarball), declaredRoot = resolve(identity.packageRoot)
  const acquired=acquisition[role]
  if(acquired.sourceRevision!==identity.sourceRevision || acquired.archive.sha256!==identity.artifactSha256 || realpathSync(acquired.root)!==realpathSync(declaredRoot)) throw Error(`${role} identity does not match acquisition receipt`)
  if (hash(readFileSync(artifact)) !== identity.artifactSha256) throw Error(`${role} artifact digest mismatch`)
  const packedRoot = join(out,'frozen-packages',role)
  mkdirSync(packedRoot,{recursive:true})
  const inventory = spawnSync('tar',['-tzf',artifact],{encoding:'utf8',maxBuffer:8*1024*1024})
  if(inventory.status!==0 || inventory.stdout.trim().split('\n').some(p=>!p.startsWith('package/') || p.split('/').includes('..') || p.startsWith('/'))) throw Error(`${role} unsafe tar inventory`)
  const extract = spawnSync('tar',['-xzf',artifact,'-C',packedRoot],{encoding:'utf8'})
  if(extract.status!==0) throw Error(`${role} artifact extraction failed: ${extract.stderr}`)
  const root=join(packedRoot,'package')
  for(const file of acquired.files) if(hash(readFileSync(join(root,file.path)))!==file.sha256) throw Error(`${role} extracted bytes differ from acquisition receipt: ${file.path}`)
  // The measured package is freshly extracted from the verified archive.
  // Production dependency modules are shared from the separately frozen install.
  const dependencyRoot = realpathSync(join(declaredRoot,'node_modules'))
  symlinkSync(dependencyRoot,join(root,'node_modules'),'dir')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (pkg.name !== 'agentic-mermaid') throw Error(`${role} package root is not agentic-mermaid`)
  const distFiles = treeFiles(join(root, 'dist'))
  identities[role] = { ...identity, tarball: artifact, declaredPackageRoot:declaredRoot, packageRoot: root, dependencyRoot, packageJsonSha256: hash(readFileSync(join(root,'package.json'))), distFiles, distManifestSha256: hash(JSON.stringify(distFiles)) }
}
if(identities.baseline.dependencyRoot!==identities.candidate.dependencyRoot) throw Error('This protocol requires one shared frozen dependency installation')
const nodeVersion = spawnSync(node, ['--version'], { encoding: 'utf8' })
if (nodeVersion.status !== 0) throw Error('Node runtime unavailable')
if(nodeVersion.stdout.trim()!==`v${acquisition.environment.node}`) throw Error('Node differs from acquisition runtime')
const meta = { schemaVersion: 1, startedAt: new Date().toISOString(), configPath, node, nodeVersion: nodeVersion.stdout.trim(), settings, featurePolicy, specificFeatureEnvironment:Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('APL_'))), identities, inputs: selectedFixtures, environment: { platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length }, invocation: process.argv }
writeFileSync(join(out,'manifest.json'), JSON.stringify(meta,null,2))
meta.acquisition={path:acquisitionPath,status:acquisition.status,lock:acquisition.lock}
writeFileSync(join(out,'manifest.json'), JSON.stringify(meta,null,2))
writeFileSync(join(out,'acquisition.json'),readFileSync(acquisitionPath))
writeFileSync(join(out,'frozen-config.json'),readFileSync(configPath))
writeFileSync(join(out,'protocol.md'), readFileSync(join(here,'protocol.md')))
mkdirSync(join(out,'runner'),{recursive:true})
for(const file of ['fixtures.mjs','worker.mjs','run.mjs','protocol.md']) writeFileSync(join(out,'runner',file),readFileSync(join(here,file)))
const runs = [], pairs = []
// One worker at a time; no builds, allocations or oracles compete with timing.
const schedule=[]
let aa=0
for(let round=0;round<settings.rounds;round++) {
  schedule.push({comparison:'candidate',round})
  while(aa<settings.aaRounds && round>=Math.floor((aa+1)*settings.rounds/(settings.aaRounds+1))) { schedule.push({comparison:'AA',round:aa}); aa++ }
}
while(aa<settings.aaRounds) { schedule.push({comparison:'AA',round:aa});aa++ }
for (const mode of ['time','allocation']) for (const cache of ['off','on']) {
  for (const {comparison,round} of schedule) {
    const pairId = `${mode}-${cache}-${comparison}-${round+1}`
    const roles = round % 2 ? ['right','left'] : ['left','right']
    const pair = { pairId, mode, cache, comparison, round: round+1, order: roles, runs: {} }
    for (const side of roles) {
      const engine = side === 'right' && comparison === 'candidate' ? 'candidate' : 'baseline'
      const runId = `${pairId}-${side}`, outputPath = join(out,`${runId}.json`), jobPath = join(out,`${runId}.job.json`)
      const job = { ...settings, caseIds:selectedFixtures.map(fixture=>fixture.id), out: outputPath, packageRoot: identities[engine].packageRoot, runId, mode, cache, engine, sourceRevision: identities[engine].sourceRevision, artifactSha256: identities[engine].artifactSha256 }
      writeFileSync(jobPath,JSON.stringify(job,null,2))
      const start = Date.now()
      const childEnv={...process.env, AGENTIC_MERMAID_ELK_CACHE:cache === 'on' ? '1':'0',AGENTIC_MERMAID_SCENE_ASSERTIONS:'0'}
      if(featurePolicy==='default') delete childEnv.AGENTIC_MERMAID_EXPERIMENTS
      else childEnv.AGENTIC_MERMAID_EXPERIMENTS=''
      const result = spawnSync(node, [...(mode === 'allocation' ? ['--expose-gc'] : []), join(here,'worker.mjs'),jobPath], { encoding:'utf8', timeout:settings.workerTimeoutMs, maxBuffer:8*1024*1024, env:childEnv })
      writeFileSync(join(out,`${runId}.stdout.log`),result.stdout ?? '')
      writeFileSync(join(out,`${runId}.stderr.log`),result.stderr ?? '')
      const run = { runId, pairId, mode, cache, comparison, round:round+1, side, engine, exitCode:result.status, signal:result.signal, error:result.error?.message, elapsedMs:Date.now()-start, outputPath, output:existsSync(outputPath) ? JSON.parse(readFileSync(outputPath,'utf8')) : null }
      runs.push(run); pair.runs[side] = run
      const compact = { ...run, output:undefined }
      appendFileSync(join(out,'processes.jsonl'),JSON.stringify(compact)+'\n')
      process.stdout.write(`${runId} exit=${run.exitCode} elapsed=${Math.round(run.elapsedMs/1000)}s\n`)
    }
    pairs.push(pair)
  }
}
const issues = [], observations = new Map()
const expectedIds=selectedFixtures.flatMap(f=>['svg','receipt'].flatMap(endpoint=>settings.regimes.filter(regime=>regime!=='new-source'||f.variant!==false).map(regime=>`${f.id}/${endpoint}/${regime}`)))
for (const run of runs) {
  if (run.exitCode !== 0 || !run.output) issues.push({ runId:run.runId, reason:run.error ?? `process exit ${run.exitCode}` })
  if(run.output && JSON.stringify(run.output.rows.map(r=>r.id))!==JSON.stringify(expectedIds)) issues.push({runId:run.runId,reason:'worker missing required fixture/endpoint/regime rows'})
  for(const row of run.output?.rows ?? []) if(row.status==='refusal' && row.fixture!=='empty') issues.push({runId:run.runId,id:row.id,reason:'nonempty required fixture refused; not a render speedup'})
}
for (const pair of pairs) {
  const left = pair.runs.left.output?.rows, right = pair.runs.right.output?.rows
  if (!left || !right) continue
  if (JSON.stringify(left.map(x=>x.id)) !== JSON.stringify(right.map(x=>x.id))) { issues.push({pairId:pair.pairId,reason:'row inventory differs'}); continue }
  for (let i = 0; i < left.length; i++) {
    const a=left[i], b=right[i]
    const oracleKeys=['status','oracle','oracleAgain','finalOracle','deterministic']
    if (oracleKeys.some(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]))) { issues.push({pairId:pair.pairId,id:a.id,reason:'paired output/status oracle differs'});continue }
    if (a.status !== 'ok' || b.status !== 'ok') continue
    const expectedSamples=pair.mode==='time' ? settings.samples:settings.allocationSamples
    if (a.samples.length !== expectedSamples || b.samples.length!==expectedSamples || a.samples.some((s,j)=>JSON.stringify(s.output)!==JSON.stringify(b.samples[j]?.output) || s.token!==b.samples[j]?.token)) { issues.push({pairId:pair.pairId,id:a.id,reason:'complete sampled output fingerprint or sample count differs'});continue }
    const metric = pair.mode === 'time' ? 'medianMs':'medianAllocatedBytes'
    if(!Number.isFinite(a[metric]) || !Number.isFinite(b[metric]) || a[metric]<=0 || b[metric]<=0) { issues.push({pairId:pair.pairId,id:a.id,reason:'invalid metric or denominator'});continue }
    const ratio=b[metric]/a[metric]
    const key=`${pair.mode}/${pair.cache}/${pair.comparison}/${a.id}`
    if(!observations.has(key)) observations.set(key,[])
    observations.get(key).push({round:pair.round,pairId:pair.pairId,baseline:a[metric],candidate:b[metric],ratio,delta:b[metric]-a[metric]})
  }
}
const summary=Array.from(observations,([id,rounds])=>({id,rounds,medianRatio:median(rounds.map(x=>x.ratio)),medianDelta:median(rounds.map(x=>x.delta)),slowerRounds:rounds.filter(x=>x.ratio>1).length,minimumRatio:Math.min(...rounds.map(x=>x.ratio)),maximumRatio:Math.max(...rounds.map(x=>x.ratio))}))
for(const row of summary.filter(x=>x.id.includes('/candidate/'))) {
  const aa=summary.find(x=>x.id===row.id.replace('/candidate/','/AA/'))
  if(!aa) continue
  const aaMaxRatioDisplacement=Math.max(...aa.rounds.map(x=>Math.abs(x.ratio-1)))
  const aaMaxAbsoluteDelta=Math.max(...aa.rounds.map(x=>Math.abs(x.delta)))
  const threshold=row.id.startsWith('time/') ? 1.05:1.02
  row.preregisteredDiagnostic={threshold,aaMaxRatioDisplacement,aaMaxAbsoluteDelta,flag:row.rounds.length===7 && aa.rounds.length===3 && row.medianRatio>threshold && row.slowerRounds>=6 && row.medianRatio-1>aaMaxRatioDisplacement && row.medianDelta>aaMaxAbsoluteDelta}
}
const report={schemaVersion:1,finishedAt:new Date().toISOString(),complete:issues.length===0,workerCount:runs.length,issues,summary,refusals:runs.filter(x=>x.output).flatMap(run=>run.output.rows.filter(row=>row.status==='refusal').map(row=>({runId:run.runId,id:row.id,oracle:row.oracle}))) }
writeFileSync(join(out,'summary.json'),JSON.stringify(report,null,2))
const table=['# Packed public decision measurements','',`Workers: ${runs.length}. Oracle/process issues: ${issues.length}. All ratios are candidate/baseline (A/A right/left). Lower is faster or less allocation.`, '', '| Row | Ratio | Paired delta | Slower rounds | Range |','|---|---:|---:|---:|---:|',...summary.map(x=>`| ${x.id} | ${x.medianRatio.toFixed(4)} | ${x.medianDelta.toFixed(4)} | ${x.slowerRounds}/${x.rounds.length} | ${x.minimumRatio.toFixed(4)}–${x.maximumRatio.toFixed(4)} |`),'',`Refusal rows are excluded from ratios (${report.refusals.length} worker observations). Time deltas are milliseconds; allocation deltas are bytes.`, '', 'This is a focused screen, not full release qualification. See manifest.json, individual job/output files, processes.jsonl and protocol.md.']
writeFileSync(join(out,'summary.md'),table.join('\n')+'\n')
if(issues.length) process.exitCode=1
