import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverStartupInventory, parseStartupResource, prepareEntryStartup, runEntryStartupSuite, runStartupChild } from '../unified/entry-startup.ts'
import { finishStartupMcpObserver, runInvocationMcpStartup } from '../unified/invocation-mcp.ts'
import { spawn } from 'node:child_process'
import { runInvocationBrowser } from '../unified/invocation-browser.ts'
import { chromiumExecutable } from './helpers/environment.ts'

test('inventory expands actual wildcard files and retains aliases, browser/data and missing native declarations', () => {
  const root = mkdtempSync(join(tmpdir(), 'entry-inventory-'))
  try {
    mkdirSync(join(root, 'dist/diagrams'), { recursive: true })
    writeFileSync(join(root, 'dist/diagrams/flowchart.js'), 'export{}')
    writeFileSync(join(root, 'dist/diagrams/state.js'), 'export{}')
    writeFileSync(join(root, 'dist/diagrams/README.md'), 'not a public JavaScript match')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', exports: { './diagrams/*': './dist/diagrams/*.js', './global': './dist/fixture.global.js', './package.json': './package.json' }, bin: { am: 'dist/am.js', alias: 'dist/am.js', 'fixture-mcp': 'dist/mcp.js' }, scripts: { 'build:binary': 'bun build bin.ts --compile --outfile dist/am' } }))
    const inventory = discoverStartupInventory(root)
    expect(inventory.filter(value => value.publicName.startsWith('./diagrams/')).map(value => value.publicName)).toEqual(['./diagrams/flowchart', './diagrams/state'])
    expect(inventory.find(value => value.publicName === 'am')?.aliases).toEqual(['am', 'alias'])
    expect(inventory.find(value => value.publicName === './global')?.kind).toBe('browser-global')
    expect(inventory.find(value => value.publicName === './package.json')?.kind).toBe('data')
    expect(inventory.find(value => value.kind === 'native')).toMatchObject({ path: 'dist/am', exists: false })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('fresh public self-import uses the candidate, includes delayed initialization, first async result and every metadata byte', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'entry-candidate-')))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'agentic-mermaid', type: 'module', exports: { '.': './candidate.js' } }))
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start End</text></svg>'
    writeFileSync(join(root, 'candidate.js'), `await new Promise(r=>setTimeout(r,35));export async function renderMermaidSVGWithReceiptAsync(){await new Promise(r=>setTimeout(r,25));return {svg:${JSON.stringify(svg)},receipt:{version:1,output:'svg',requestDigest:'authored-fixture'},metadata:{candidateOnly:'candidate-artifact',payload:'x'.repeat(8192)}}}`)
    const options = { root, packageRoot: root, out: join(root, 'out'), rounds: 1, profile: 'smoke' as const, surfaces: ['library'] as const, nodeExecutable: 'node', bunExecutable: join(root, 'missing-bun'), observerExecutable: join(root, 'missing-observer') }
    const prepared = await prepareEntryStartup(options)
    expect(prepared.jobs).toHaveLength(1)
    expect(prepared.jobs[0]!.operation.id).toBe('renderMermaidSVGWithReceiptAsync:svg')
    const result = await runEntryStartupSuite(options, prepared)
    const row = result.observations.find(value => value.mode === 'process-to-first-consumed')!
    expect(row.status).toBe('passed')
    expect(row.metrics!.entry).toBe('file://' + join(root, 'candidate.js'))
    expect(Number(row.metrics!.moduleImportMs)).toBeGreaterThanOrEqual(25)
    expect(Number(row.metrics!.firstApiMs)).toBeGreaterThanOrEqual(15)
    expect(row.samplesMs![0]).toBeGreaterThanOrEqual(Number(row.metrics!.moduleImportMs) + Number(row.metrics!.firstApiMs))
    expect(row.bytes).toBeGreaterThan(svg.length + 8192)
    expect(result.gaps.join('\n')).toContain('p95 unavailable')
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 20_000)

test('browser startup consumes one first result in each fresh browser and keeps heap diagnostics in separate passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'entry-browser-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', exports: { './browser': './global.js' } }))
    writeFileSync(join(root, 'global.js'), `let calls=0;const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start End</text></svg>';function first(){if(++calls!==1)throw Error('Startup made a warmup call before the recorded result')}const receipt=output=>({version:1,output,requestDigest:'fixture'});var agenticMermaid={renderMermaidSVG(){first();return svg},async renderMermaidSVGAsync(){first();await new Promise(r=>setTimeout(r,25));return svg},renderMermaidSVGWithReceipt(){first();return{svg,receipt:receipt('svg'),metadata:{owner:'fixture'}}},renderMermaidASCIIWithReceipt(source,options){first();return{text:'Start --> End',receipt:receipt(options.useAscii?'ascii':'unicode')}},renderMermaidPNGInBrowserWithReceipt(){first();return{png:Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gM0AAAAASUVORK5CYII='),c=>c.charCodeAt(0)),receipt:receipt('png')}}}`)
    const workload = { id: 'browser-first', family: 'flowchart', source: 'flowchart LR\nA[Start] --> B[End]', expectedLabels: ['Start', 'End'], features: [], provenance: 'authored first-browser-call regression' }
    const result = await runInvocationBrowser({ root, harnessRoot: process.cwd(), out: join(root, 'out'), rounds: 1, profile: 'smoke', startupOnly: true, startupSamplesPerRound: 1, executable: chromiumExecutable }, [workload])
    const rows = result.rows.filter(value => value.mode === 'browser-launch-to-first-consumed')
    expect(rows).toHaveLength(6)
    expect(rows.map(value => ({ status: value.status, detail: value.detail, findings: value.findings }))).toEqual(rows.map(() => ({ status: 'passed', detail: undefined, findings: [] })))
    expect(rows.every(value => value.samplesMs!.length === 1 && value.samplesMs![0]! >= Number(value.metrics!.firstInputMs))).toBe(true)
    expect(rows.every(value => Number(value.metrics!.launchToReadyMs) >= Number(value.metrics!.pageToReadyMs))).toBe(true)
    const diagnostic = result.rows.filter(value => value.mode === 'fresh-browser-resource')
    expect(diagnostic).toHaveLength(6)
    expect(diagnostic.every(value => value.samplesMs === undefined && value.status === 'passed')).toBe(true)
    const resource = result.artifacts.find(value => value.endsWith('svg-resource-payload.json'))!
    expect(Object.keys(JSON.parse(readFileSync(resource, 'utf8')).heapSnapshots)).toEqual(['beforeTargetLoad', 'apiReady', 'afterConsumed', 'afterReleaseAfterGc'])
    expect(Number(rows.find(value => value.operation === 'svg-async')!.metrics!.firstInputMs)).toBeGreaterThanOrEqual(15)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 45_000)

test('child milestone decoder preserves Unicode split across stdout buffers and ignores unframed output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'entry-frame-'))
  try {
    const script = join(root, 'frames.cjs')
    writeFileSync(script, `const fs=require('node:fs'),b=Buffer.from('noise\\n\\u0001entry-startup\\u0001'+JSON.stringify({phase:'first-consumed',label:'漢字'})+'\\n');const cut=b.indexOf(Buffer.from('漢'))+1;fs.writeSync(1,b.subarray(0,cut));setTimeout(()=>fs.writeSync(1,b.subarray(cut)),20)`)
    const result = await runStartupChild('node', [script], { cwd: root })
    expect(result.code).toBe(0)
    expect(result.phases).toHaveLength(1)
    expect(result.phases[0]!.label).toBe('漢字')
    expect(result.phases[0]!.observedMs).toBeGreaterThan(0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a fully consumed first SVG cannot hide a later failing process lifecycle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'entry-lifecycle-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture-late-exit', type: 'module', exports: { '.': './index.js' } }))
    writeFileSync(join(root, 'index.js'), `export function renderMermaidSVG(){setImmediate(()=>{process.exitCode=1});return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start End</text></svg>'}`)
    const result = await runEntryStartupSuite({ root, out: join(root, 'out'), rounds: 1, profile: 'smoke', surfaces: ['library'], bunExecutable: join(root, 'missing'), observerExecutable: join(root, 'missing') })
    const row = result.observations.find(value => value.mode === 'process-to-first-consumed')!
    expect(row.status).toBe('failed')
    expect(row.metrics!.lifecycleExitCode).toBe(1)
    expect(row.samplesMs).toHaveLength(1)
    expect(row.detail).toContain('lifecycle')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('MCP resource cleanup accepts an already reaped observer without consulting a vanished procfs child', async () => {
  const observer = spawn('node', ['--version'], { stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => { observer.once('error', reject); observer.once('close', () => resolve()) })
  expect(observer.exitCode).toBe(0)
  await finishStartupMcpObserver(observer)
})

test('resource observer records fresh product and baseline process costs in explicit byte/millisecond units', async () => {
  const root = mkdtempSync(join(tmpdir(), 'entry-resource-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture-entry', type: 'module', exports: { '.': './index.js' } }))
    writeFileSync(join(root, 'index.js'), `export function renderMermaidSVG(){return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start End</text></svg>'}`)
    const observer = join(root, 'observer.cjs')
    writeFileSync(observer, `#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process');if(process.argv.includes('--version')){fs.writeSync(1,'fixture (GNU Time)');process.exit(0)}const args=process.argv.slice(2),out=args[args.indexOf('-o')+1],start=args.indexOf('--')+1;const child=cp.spawnSync(args[start],args.slice(start+1),{encoding:'utf8'});fs.writeFileSync(out,'user_seconds=0.01\\nsystem_seconds=0.02\\npeak_rss_kib=1234\\n');if(child.stdout)fs.writeSync(1,child.stdout);if(child.stderr)fs.writeSync(2,child.stderr);process.exit(child.status||0)`)
    chmodSync(observer, 0o755)
    const result = await runEntryStartupSuite({ root, out: join(root, 'out'), rounds: 1, profile: 'smoke', surfaces: ['library'], bunExecutable: join(root, 'missing'), observerExecutable: observer })
    const row = result.observations.find(value => value.mode === 'fresh-process-resource-paired-control')!
    expect(row.status).toBe('passed')
    expect(row.samplesMs).toBeUndefined()
    expect(row.metrics).toMatchObject({ peakRssBytes: 1234 * 1024, baselinePeakRssBytes: 1234 * 1024, peakDifferenceBytes: 0, userCpuMs: 10, systemCpuMs: 20, cpuResolutionMs: 10 })
    const evidence = JSON.parse(readFileSync(String(row.metrics!.rawSnapshots), 'utf8'))
    expect(Object.keys(evidence.resource.snapshots)).toEqual(['beforeImport', 'apiReady', 'afterConsumed', 'outputHeldAfterGc', 'afterReleaseAfterGc'])
    expect(evidence.baseline.snapshots.beforeImport.rss).toBeGreaterThan(0)
    expect(parseStartupResource('user_seconds=0.00\nsystem_seconds=0.00\npeak_rss_kib=1\n')).toMatchObject({ userCpuMs: 0, systemCpuMs: 0, peakRssBytes: 1024, cpuResolutionMs: 10 })
    expect(() => parseStartupResource('peak_rss_kib=1')).toThrow('user_seconds')
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 20_000)

test('MCP startup sends exactly one first real format call per fresh initialized server, before any warmup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'entry-mcp-'))
  try {
    const calls = join(root, 'calls.jsonl'), server = join(root, 'mcp.cjs')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', bin: { 'fixture-mcp': 'mcp.cjs' } }))
    writeFileSync(server, `const fs=require('node:fs');const alive=setInterval(()=>{},1000);process.stdin.on('end',()=>clearInterval(alive));let pending='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{pending+=chunk;let nl;while((nl=pending.indexOf('\\n'))>=0){const line=pending.slice(0,nl);pending=pending.slice(nl+1);if(!line.trim())continue;const r=JSON.parse(line);if(r.id===undefined)continue;let result;if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};else if(r.method==='tools/list')result={tools:['render_svg','render_ascii','render_png'].map(name=>({name,inputSchema:{type:'object',properties:{source:{type:'string'}}}}))};else if(r.method==='tools/call'){fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({pid:process.pid,name:r.params.name,args:r.params.arguments})+'\\n');const format=r.params.name==='render_svg'?'svg':r.params.name==='render_png'?'png':r.params.arguments.useAscii?'ascii':'unicode';const value=format==='svg'?{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start End</text></svg>'}:format==='png'?{png_base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gM0AAAAASUVORK5CYII='}:{text:'Start --> End'};value.receipt={version:1,output:format,requestDigest:'fixture'};result={content:[{type:'text',text:JSON.stringify(value)}]}}else result={};fs.writeSync(1,JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n')}});`)
    const workload = { id: 'mcp-first', family: 'flowchart', source: 'flowchart LR\nA[Start] --> B[End]', expectedLabels: ['Start', 'End'], features: [], provenance: 'authored first-request regression' }
    const result = await runInvocationMcpStartup({ root, harnessRoot: process.cwd(), out: join(root, 'out'), rounds: 1, profile: 'smoke', startupOnly: true, startupSamplesPerRound: 1, startupRuntimes: [{ name: 'node', executable: 'node', version: 'test' }], startupMcpTransports: ['stdio'] }, [workload])
    const rows = result.rows.filter(value => value.mode === 'process-initialize-first-fully-consumed-tool')
    expect(rows).toHaveLength(4)
    expect(rows.map(value => ({ status: value.status, detail: value.detail, findings: value.findings }))).toEqual(rows.map(() => ({ status: 'passed', detail: undefined, findings: [] })))
    expect(rows.every(value => value.metrics!.receiptPresent === true)).toBe(true)
    expect(rows.every(value => value.samplesMs![0]! >= Number(value.metrics!.firstCallAndConsumptionMs))).toBe(true)
    const observed = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(observed).toHaveLength(4)
    expect(new Set(observed.map(value => value.pid)).size).toBe(4)
    expect(observed.map(value => value.name)).toEqual(['render_svg', 'render_ascii', 'render_ascii', 'render_png'])
    // Local published MCP exposes code execution for SVG/terminal, while the
    // hosted tool set can expose direct render tools. Exercise both contracts.
    writeFileSync(server, readFileSync(server, 'utf8').replace("['render_svg','render_ascii','render_png']", "['execute','render_png']").replace("const format=", "const code=r.params.arguments.code??'';if(r.params.name==='execute'){r.params.name=code.includes('renderMermaidSVGWithReceipt')?'render_svg':'render_ascii';r.params.arguments.useAscii=code.includes('\"useAscii\":true')}const format="))
    const codeWorkflow = await runInvocationMcpStartup({ root, harnessRoot: process.cwd(), out: join(root, 'code-out'), rounds: 1, profile: 'smoke', startupOnly: true, startupSamplesPerRound: 1, startupRuntimes: [{ name: 'node', executable: 'node', version: 'test' }], startupMcpTransports: ['stdio'] }, [workload])
    const codeRows = codeWorkflow.rows.filter(value => value.mode === 'process-initialize-first-fully-consumed-tool')
    expect(codeRows.every(value => value.status === 'passed')).toBe(true)
    expect(codeRows.map(value => value.operation)).toEqual(['execute', 'execute', 'execute', 'render_png'])
    expect(codeRows.slice(0, 3).every(value => JSON.parse(String(value.metrics!.requestArguments)).code.includes('WithReceipt'))).toBe(true)
    // The public SDK has no server exit-status field. A separate observer must
    // reject a server which replies correctly and later drains with exit1.
    writeFileSync(server, 'process.exitCode=1;\n' + readFileSync(server, 'utf8'))
    const observer = join(root, 'observe.cjs')
    writeFileSync(observer, `#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process'),a=process.argv.slice(2),file=a[a.indexOf('-o')+1],start=a.indexOf('--')+1;const child=cp.spawn(a[start],a.slice(start+1),{stdio:'inherit'});child.on('close',code=>{fs.writeFileSync(file,'user_seconds=0.01\\nsystem_seconds=0.02\\npeak_rss_kib=1234\\nexit_code='+code+'\\n');process.exitCode=code??1})`)
    chmodSync(observer, 0o755)
    const late = await runInvocationMcpStartup({ root, harnessRoot: process.cwd(), out: join(root, 'late-out'), rounds: 1, profile: 'smoke', startupOnly: true, startupSamplesPerRound: 1, startupRuntimes: [{ name: 'node', executable: 'node', version: 'test' }], startupMcpTransports: ['stdio'], startupObserverExecutable: observer }, [workload])
    const resources = late.rows.filter(value => value.mode === 'fresh-mcp-server-resource')
    expect(resources).toHaveLength(4)
    expect(resources.every(value => value.status === 'failed' && value.metrics!.serverExitCode === 1)).toBe(true)
    expect(resources.every(value => value.metrics!.peakRssBytes === 1234 * 1024)).toBe(true)
    expect(resources.every(value => value.detail!.includes('lifecycle'))).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 20_000)
