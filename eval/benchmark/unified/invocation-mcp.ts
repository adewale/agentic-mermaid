import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mutationWitnessForFamily, structuralBuildWitnessForFamily } from './family-suite.ts'
import { decodeToolPayload, type InvocationOptions, invocationHarnessRoot, invocationRow } from './invocation.ts'
import { qualifyOutput } from './qualification.ts'
import type { BenchmarkObservation, UnifiedWorkload } from './types.ts'
import type { StartupInvocationOptions } from './entry-startup.ts'

async function ready(command: string, args: string[], cwd: string, processGroup = false): Promise<{ child: ChildProcess; url: string; log: () => string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, detached: processGroup, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(Error('MCP listener did not become ready: ' + text.slice(-2000)))
    }, 60_000)
    const data = (chunk: Buffer) => {
      text += chunk.toString()
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match) {
        clearTimeout(timer)
        resolve({ child, url: match[0], log: () => text })
      }
    }
    child.stdout!.on('data', data)
    child.stderr!.on('data', data)
    child.once('error', e => {
      clearTimeout(timer)
      reject(e)
    })
    child.once('exit', code => {
      if (!text.match(/http:\/\/127\.0\.0\.1:\d+/)) {
        clearTimeout(timer)
        reject(Error(`MCP listener exited ${code}: ${text}`))
      }
    })
  })
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>(resolve => child.once('close', () => resolve())),
    new Promise<void>(resolve =>
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 2000),
    ),
  ])
}
export async function finishStartupMcpObserver(observer: ChildProcess): Promise<void> {
  if (observer.exitCode !== null || observer.signalCode !== null) return
  const closed = new Promise<void>(resolve => observer.once('close', () => resolve()))
  if (!observer.pid || process.platform === 'win32') throw Error('GNU time HTTP server shutdown requires an owned POSIX process group')
  // GNU time ignores interactive SIGINT/SIGQUIT while waiting. Signal its
  // owned group like a terminal Ctrl-C: the actual HTTP server handles SIGINT,
  // exits gracefully, and time remains alive to reap/write the wait4 record.
  // Killing the observer itself could silently discard that resource record.
  try { process.kill(-observer.pid, 'SIGINT') } catch (error) { if (observer.exitCode === null && observer.signalCode === null) throw error }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([closed, new Promise<never>((_, reject) => { timeout = setTimeout(() => { try { process.kill(-observer.pid!, 'SIGKILL') } catch {} reject(Error('Observed MCP server did not terminate gracefully')) }, 3000) })]) } finally { if (timeout) clearTimeout(timeout) }
}
async function hostedEntry(options: InvocationOptions, out: string): Promise<string> {
  const root = options.root,
    require = createRequire(join(options.harnessRoot ?? invocationHarnessRoot, 'package.json')),
    esbuild = require('esbuild')
  const entry = join(out, 'hosted-entry.mjs'),
    source = join(out, 'hosted-entry.ts')
  if (!existsSync(join(out, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'), 'dir')
  writeFileSync(
    source,
    `import{createServer}from'node:http';
import{createMcpHandler}from${JSON.stringify(join(root, 'website/src/mcp-handler.ts'))};
import{executeInSandbox}from${JSON.stringify(join(root, 'src/mcp/sandbox.ts'))};
import{renderMermaidPNGWasm}from${JSON.stringify(join(root, 'website/src/png-wasm.ts'))};
const handler=createMcpHandler({context:{execute:executeInSandbox,renderPng:renderMermaidPNGWasm},cacheVersion:'benchmark',onEvent:()=>{}});
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}: {})});const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}catch(e){res.writeHead(500).end(String(e))}});server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));process.on('SIGTERM',()=>server.close(()=>process.exit()));`,
  )
  const external = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies ?? {})
  await esbuild.build({ entryPoints: [source], outfile: entry, bundle: true, platform: 'node', format: 'esm', target: 'es2022', loader: { '.ttf': 'binary', '.wasm': 'binary' }, external: [...external, '@resvg/resvg-wasm'], logLevel: 'silent' })
  return entry
}
export async function runInvocationMcp(options: InvocationOptions & StartupInvocationOptions, workloads: UnifiedWorkload[]): Promise<{ rows: BenchmarkObservation[]; gaps: string[]; artifacts: string[] }> {
  if (options.startupOnly) return await runInvocationMcpStartup(options, workloads)
  const root = options.packageRoot ?? options.root,
    out = join(options.out, 'mcp')
  mkdirSync(out, { recursive: true })
  const require = createRequire(join(options.harnessRoot ?? invocationHarnessRoot, 'package.json')),
    rows: BenchmarkObservation[] = [],
    gaps: string[] = [],
    artifacts: string[] = []
  const module = async (name: string) => await import(pathToFileURL(require.resolve(name)).href)
  const [{ Client }, { StdioClientTransport }, { SSEClientTransport }, { StreamableHTTPClientTransport }] = await Promise.all([
    module('@modelcontextprotocol/sdk/client/index.js'),
    module('@modelcontextprotocol/sdk/client/stdio.js'),
    module('@modelcontextprotocol/sdk/client/sse.js'),
    module('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ])
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
    bin = join(root, pkg.bin?.['agentic-mermaid-mcp'] ?? 'dist/agentic-mermaid-mcp.js')
  const core = await import(pathToFileURL(join(root, 'dist/agent-core.js')).href)
  let hosted: string | undefined
  try {
    hosted = await hostedEntry(options, out)
    artifacts.push(hosted)
  } catch (e) {
    gaps.push(`Hosted handler/WASM preparation unavailable: ${String(e)}`)
  }
  for (const transportName of ['stdio', 'http-sse', 'hosted-streamable'] as const) {
    if (transportName === 'hosted-streamable' && !hosted) {
      rows.push({ ...invocationRow('mcp:hosted-streamable', workloads[0]!, 'start', 'rpc', 'fresh-server'), family: '*', caseId: 'hosted-start', status: 'blocked', detail: gaps.at(-1) })
      continue
    }
    if (transportName !== 'hosted-streamable' && !existsSync(bin)) {
      rows.push({ ...invocationRow(`mcp:${transportName}`, workloads[0]!, 'start', 'rpc', 'fresh-server'), family: '*', caseId: 'mcp-start', status: 'blocked', detail: 'Published MCP executable absent' })
      continue
    }
    for (let round = 1; round <= options.rounds; round++) {
      let server: Awaited<ReturnType<typeof ready>> | undefined, client: any
      try {
        const started = performance.now()
        client = new Client({ name: 'agentic-mermaid-unified-bench', version: '1.0.0' })
        const transport =
          transportName === 'stdio'
            ? new StdioClientTransport({ command: 'node', args: [bin], cwd: root, stderr: 'ignore' })
            : transportName === 'http-sse'
              ? ((server = await ready('node', [bin, '--transport', 'http', '--port', '0'], root)), new SSEClientTransport(new URL(server.url + '/sse')))
              : ((server = await ready('node', [hosted!], root)), new StreamableHTTPClientTransport(new URL(server.url + '/mcp')))
        await client.connect(transport)
        rows.push({
          ...invocationRow(`mcp:${transportName}`, workloads[0]!, 'initialize', 'rpc', 'fresh-server'),
          family: '*',
          caseId: 'initialization',
          samplesMs: [performance.now() - started],
          metrics: { round, includesProcessStartup: true, executionHost: transportName === 'hosted-streamable' ? 'Node source-hosted handler; real target WASM; local VM seam' : 'published MCP executable' },
        })
        const ls = performance.now(),
          listed = await client.listTools(),
          tools = new Set<string>(listed.tools.map((tool: any) => tool.name))
        rows.push({ ...invocationRow(`mcp:${transportName}`, workloads[0]!, 'tools/list', 'json', 'discovery'), family: '*', caseId: 'tool-discovery', samplesMs: [performance.now() - ls], bytes: Buffer.byteLength(JSON.stringify(listed)), metrics: { round, toolCount: tools.size } })
        if (tools.has('render_svg')) {
          const group = workloads.slice(0, 3),
            row = invocationRow(`mcp:${transportName}`, group[0]!, 'render_svg', 'svg', 'concurrent-three-client-requests')
          row.caseId = 'concurrent-independent-requests'
          row.family = '*'
          row.metrics = { round, concurrentRequests: group.length, clock: 'Promise.all SDK requests through fully consumed responses; correctness after clock' }
          try {
            const start = performance.now()
            const replies = await Promise.all(
              group.map(async w => {
                const response = await client.callTool({ name: 'render_svg', arguments: { source: w.source } })
                const payload = decodeToolPayload(response)
                return { w, payload, bytes: Buffer.byteLength(JSON.stringify(response)) }
              }),
            )
            row.samplesMs = [performance.now() - start]
            row.bytes = replies.reduce((sum, reply) => sum + reply.bytes, 0)
            row.findings = replies.flatMap(reply => qualifyOutput(reply.w, reply.payload.svg ?? reply.payload, 'svg').findings)
            row.status = row.findings.length ? 'failed' : 'passed'
          } catch (error) {
            row.status = 'failed'
            row.detail = String(error)
          }
          rows.push(row)
        }
        for (const w of workloads) {
          const definitions: Array<{ name: string; format: string; args: Record<string, unknown>; expectedWitness?: boolean }> = []
          if (tools.has('render_svg')) definitions.push({ name: 'render_svg', format: 'svg', args: { source: w.source } })
          if (tools.has('render_ascii')) for (const useAscii of [true, false]) definitions.push({ name: 'render_ascii', format: useAscii ? 'ascii' : 'unicode', args: { source: w.source, useAscii } })
          if (tools.has('render_png') && (options.profile === 'full' || transportName !== 'hosted-streamable')) definitions.push({ name: 'render_png', format: 'png', args: { source: w.source } })
          if (tools.has('describe')) definitions.push({ name: 'describe', format: 'json', args: { source: w.source } })
          if (tools.has('describe_sdk')) definitions.push({ name: 'describe_sdk', format: 'json', args: { family: w.family } })
          if (tools.has('verify')) definitions.push({ name: 'verify', format: 'json', args: { source: w.source } })
          if (tools.has('execute')) definitions.push({ name: 'execute', format: 'svg', args: { code: `return { svg: mermaid.renderMermaidSVG(${JSON.stringify(w.source)}) }` } })
          const mutation = mutationWitnessForFamily(core as any, w.family)
          if (tools.has('mutate') && mutation) definitions.push({ name: 'mutate', format: 'source', args: { source: w.source, ops: [mutation] }, expectedWitness: true })
          const buildOps = structuralBuildWitnessForFamily(core as any, w.family)
          if (tools.has('build') && buildOps) definitions.push({ name: 'build', format: 'source', args: { family: w.family, ops: buildOps }, expectedWitness: true })
          for (const def of definitions) {
            const row = invocationRow(`mcp:${transportName}`, w, def.name, def.format, 'client-roundtrip')
            row.metrics = { round, clock: 'SDK call, transport, server execution and complete returned content consumption' }
            try {
              const start = performance.now(),
                response = await client.callTool({ name: def.name, arguments: def.args }),
                payload = decodeToolPayload(response),
                serialized = JSON.stringify(response)
              row.samplesMs = [performance.now() - start]
              row.bytes = Buffer.byteLength(serialized)
              const artifact = payload?.svg ?? payload?.text ?? (payload?.png_base64 ? new Uint8Array(Buffer.from(payload.png_base64, 'base64')) : undefined) ?? payload?.source ?? payload
              if (['svg', 'ascii', 'unicode', 'png', 'source'].includes(def.format)) {
                const q = qualifyOutput(w, artifact, def.format)
                row.status = q.ok ? 'passed' : 'failed'
                row.findings = q.findings
              }
              if (def.expectedWitness && !String(artifact).includes('UnifiedBenchmarkWitness')) {
                row.status = 'failed'
                row.findings = [...(row.findings ?? []), 'Declarative edit lost independently requested witness value']
              }
            } catch (e) {
              row.status = 'failed'
              row.detail = String(e)
            }
            rows.push(row)
          }
          if (transportName === 'hosted-streamable' && server) {
            // The modern stateless era has per-request metadata and no initialize handshake.
            for (const name of ['render_svg', ...(options.profile === 'full' ? ['render_ascii'] : [])]) {
              if (!tools.has(name)) continue
              const version = '2026-07-28',
                row = invocationRow('mcp:hosted-modern', w, name, name === 'render_svg' ? 'svg' : 'unicode', 'stateless-client-roundtrip')
              try {
                const start = performance.now(),
                  response = await fetch(server.url + '/mcp', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'mcp-protocol-version': version, 'mcp-method': 'tools/call', 'mcp-name': name },
                    body: JSON.stringify({ jsonrpc: '2.0', id: round, method: 'tools/call', params: { name, arguments: { source: w.source }, _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
                  }),
                  text = await response.text()
                row.samplesMs = [performance.now() - start]
                row.bytes = Buffer.byteLength(text)
                if (!response.ok) throw Error(`HTTP ${response.status}: ${text}`)
                const rpc = JSON.parse(text)
                if (rpc.error) throw Error(JSON.stringify(rpc.error))
                const payload = decodeToolPayload(rpc.result),
                  q = qualifyOutput(w, payload.svg ?? payload.text, name === 'render_svg' ? 'svg' : 'unicode')
                row.status = q.ok ? 'passed' : 'failed'
                row.findings = q.findings
                row.metrics = { round, negotiation: 'modern per-request metadata; no handshake' }
              } catch (e) {
                row.status = 'failed'
                row.detail = String(e)
              }
              rows.push(row)
            }
          }
        }
      } catch (e) {
        rows.push({ ...invocationRow(`mcp:${transportName}`, workloads[0]!, 'connect', 'rpc', 'fresh-server'), family: '*', caseId: `connect-${round}`, status: 'failed', detail: String(e) })
      } finally {
        await client?.close().catch(() => {})
        if (server) {
          await stop(server.child)
          const log = join(out, `${transportName}-${round}.log`)
          writeFileSync(log, server.log())
          artifacts.push(log)
        }
      }
    }
  }
  gaps.push(
    'Hosted HTTP adapter uses the actual target handler and resvg-WASM/font bytes on Node over a real socket; Cloudflare workerd scheduling, Dynamic Worker isolate startup and remote network latency require a deployed/runtime-specific campaign.',
    'Hosted compute Cache API is intentionally absent/disabled in local transport probes; warm server reuse and deployed compute-cache hits must not be conflated.',
  )
  return { rows, gaps, artifacts }
}

/** The first real call follows initialize/list immediately. It never inherits
 * the ordinary invocation suite's concurrent probes or warmup portfolio. */
export async function runInvocationMcpStartup(options: InvocationOptions & StartupInvocationOptions, workloads: UnifiedWorkload[]): Promise<{ rows: BenchmarkObservation[]; gaps: string[]; artifacts: string[] }> {
  const root = options.packageRoot ?? options.root, out = join(options.out, 'mcp-startup')
  mkdirSync(out, { recursive: true })
  const harness = options.harnessRoot ?? invocationHarnessRoot
  const require = createRequire(join(harness, existsSync(join(harness, 'eval/benchmark/package.json')) ? 'eval/benchmark/package.json' : 'package.json'))
  const module = async (name: string) => await import(pathToFileURL(require.resolve(name)).href)
  const [{ Client }, { StdioClientTransport }, { SSEClientTransport }] = await Promise.all([module('@modelcontextprotocol/sdk/client/index.js'), module('@modelcontextprotocol/sdk/client/stdio.js'), module('@modelcontextprotocol/sdk/client/sse.js')])
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), rows: BenchmarkObservation[] = [], gaps: string[] = [], artifacts: string[] = []
  const bins = Object.entries(pkg.bin ?? {}).filter(([name]) => name.includes('mcp')) as [string, string][]
  if (!bins.length) return { rows: [{ ...invocationRow('mcp', workloads[0]!, 'entry-inventory', 'rpc', 'declaration'), status: 'not-applicable', detail: 'Package declares no MCP executable.' }], gaps, artifacts }
  const runtimes = options.startupRuntimes ?? [{ name: 'node', executable: options.nodeExecutable ?? 'node', version: 'unobserved' }]
  const definitions = [
    { name: 'render_svg', format: 'svg', options: {} },
    { name: 'render_ascii', format: 'ascii', options: { useAscii: true } },
    { name: 'render_ascii', format: 'unicode', options: { useAscii: false } },
    { name: 'render_png', format: 'png', options: {} },
  ]
  for (const [alias, relative] of bins) for (const runtime of runtimes) for (const transportName of options.startupMcpTransports ?? ['stdio', 'http-sse'] as const) for (const def of definitions) for (let round = 1; round <= options.rounds; round++) for (let sample = 1; sample <= (options.startupSamplesPerRound ?? 1); sample++) for (const resourcePass of options.startupObserverExecutable && sample === 1 ? [false, true] : [false]) {
    const w = workloads[0]!, row = invocationRow(`mcp:${alias}:${transportName}`, w, def.name, def.format, 'process-initialize-first-fully-consumed-tool')
    row.runtime = runtime.name
    row.metrics = { round, sample, runtimeVersion: runtime.version, independentFreshServer: true, executionHost: 'published MCP executable', clock: resourcePass ? 'separate whole-server GNU time diagnostic; not a latency sample' : 'before SDK transport/server creation through initialize, tools/list, first public call, decode and full response serialization; qualification after clock', lifecycleScope: resourcePass ? 'actual GNU time wait4 exit status; owned HTTP group SIGINT requests server graceful shutdown with exit0 while GNU time ignores interactive signal; stdio EOF drains naturally; signal termination/nonzero rejected' : 'first complete tool response qualified; SDK close has no public server exit-status field, so later server lifecycle unmeasured, not a full-process certificate', memoryScope: resourcePass ? 'GNU time peak of actual server process lifetime through initialization/first consumed tool and graceful teardown; parent SDK excluded; server JS heap snapshots unavailable' : 'server resources collected in separate fresh pass; parent SDK memory is not server memory' }
    if (resourcePass) row.mode = 'fresh-mcp-server-resource'
    let server: Awaited<ReturnType<typeof ready>> | undefined, client: any, serverStderr = ''
    const resourceFile = join(out, `${alias}-${runtime.name}-${transportName}-${def.format}-${round}-${sample}.time`)
    try {
      const bin = join(root, relative)
      if (!existsSync(bin)) throw Error('Published MCP executable absent: ' + relative)
      const started = performance.now()
      client = new Client({ name: 'agentic-mermaid-entry-startup', version: '1.0.0' })
      const serverArgs = [bin, ...(transportName === 'http-sse' ? ['--transport', 'http', '--port', '0'] : [])]
      const command = resourcePass ? options.startupObserverExecutable! : runtime.executable
      const args = resourcePass ? ['-f', 'user_seconds=%U\nsystem_seconds=%S\npeak_rss_kib=%M\nexit_code=%x', '-o', resourceFile, '--', runtime.executable, ...serverArgs] : serverArgs
      const transport = transportName === 'stdio' ? new StdioClientTransport({ command, args, cwd: root, stderr: 'pipe', env: { LC_ALL: 'C' } }) : ((server = await ready(command, args, root, resourcePass)), new SSEClientTransport(new URL(server.url + '/sse')))
      if ('stderr' in transport && transport.stderr) transport.stderr.on('data', (chunk: Buffer) => { serverStderr = (serverStderr + chunk.toString()).slice(-6000) })
      await client.connect(transport)
      const initializeMs = performance.now() - started
      const listed = await client.listTools(), listedJson = JSON.stringify(listed), readyMs = performance.now() - started
      const tools = new Set<string>(listed.tools.map((tool: any) => tool.name))
      let tool = def.name, requestArgs: Record<string, unknown> = { source: w.source, ...def.options }
      if (!tools.has(tool) && def.format !== 'png') {
        const execute = ['execute_code', 'execute'].find(name => tools.has(name))
        if (execute) {
          tool = execute
          requestArgs = { code: `return mermaid.${def.format === 'svg' ? 'renderMermaidSVGWithReceipt' : 'renderMermaidASCIIWithReceipt'}(${JSON.stringify(w.source)}${def.format === 'svg' ? '' : ', ' + JSON.stringify({ useAscii: def.format === 'ascii', colorMode: 'none' })})` }
        }
      }
      if (!tools.has(tool)) { row.status = 'unsupported'; row.detail = 'Initialized published tools provide no reviewed public render workflow for ' + def.format }
      else {
      row.operation = tool
      row.metrics = { ...row.metrics, actualTool: tool, requestArguments: JSON.stringify(requestArgs), workflow: tool === def.name ? 'direct advertised render tool' : 'advertised code tool invoking public receipt-bearing SDK; no synthetic render tool' }
      const callStart = performance.now(), response = await client.callTool({ name: tool, arguments: requestArgs }), payload = decodeToolPayload(response), serialized = JSON.stringify(response)
      const firstCallMs = performance.now() - callStart, firstResultMs = performance.now() - started
      row.samplesMs = resourcePass ? undefined : [firstResultMs]; row.bytes = Buffer.byteLength(serialized)
      row.metrics = { ...row.metrics, initializeMs, initializedAndToolsConsumedMs: readyMs, discoveryBytes: Buffer.byteLength(listedJson), firstCallAndConsumptionMs: firstCallMs }
      const artifact = payload?.svg ?? payload?.text ?? (payload?.png_base64 ? new Uint8Array(Buffer.from(payload.png_base64, 'base64')) : payload?.png ? new Uint8Array(payload.png) : undefined) ?? payload
      const q = qualifyOutput(w, artifact, def.format)
      // Receipt-bearing tool envelopes must be retained and qualified after the
      // clock; serializing only their SVG would hide protocol work.
      {
        const { assertInvocationReceipt } = await import('./invocation-receipt.ts')
        try { assertInvocationReceipt(payload.receipt, def.format) } catch (error) { q.findings.push(String(error)); q.ok = false }
      }
      row.metrics = { ...row.metrics, receiptPresent: !!payload?.receipt }
      row.status = q.ok ? 'passed' : 'failed'; row.findings = q.findings
      }
    } catch (error) { row.status = 'failed'; row.detail = String(error) + (serverStderr ? '\n' + serverStderr : '') }
    finally {
      await client?.close().catch(() => {})
      if (server && resourcePass) {
        try { await finishStartupMcpObserver(server.child) } catch (error) { row.status = 'failed'; row.detail = [row.detail, String(error)].filter(Boolean).join('\n') }
      }
      if (server) await stop(server.child)
    }
    if (resourcePass) {
      try {
        const { parseStartupResource } = await import('./entry-startup.ts'), text = readFileSync(resourceFile, 'utf8'), exit = /^exit_code=(\d+)$/m.exec(text)
        artifacts.push(resourceFile)
        row.metrics = { ...row.metrics, ...parseStartupResource(text), serverExitCode: exit ? Number(exit[1]) : null, cpuScope: 'whole server process; 10ms per field resolution, zero censored below observer resolution; no CPU allocation attribution', baselineScope: 'matched empty runtime control in library resource lane; no subtraction or native/JS-heap attribution claimed' }
        if (!exit || Number(exit[1]) !== 0 || /Command terminated by signal|Command exited with non-zero status/.test(text)) throw Error('Observed MCP server lifecycle did not exit0 after graceful shutdown: ' + text.trim())
      } catch (error) { row.status = 'failed'; row.detail = [row.detail, String(error)].filter(Boolean).join('\n') }
    }
    rows.push(row)
  }
  rows.push({ ...invocationRow('mcp:hosted-streamable', workloads[0]!, 'entry-inventory', 'rpc', 'declaration'), status: 'blocked', detail: 'Hosted handler is a source-hosted/deployed interface, not an installed package entry. No package startup or deployment memory sample is manufactured.' })
  gaps.push('MCP server JS heap/per-import checkpoints cannot be observed through its public protocol; GNU time measures whole fresh-server peak RSS/CPU in a separate pass. Parent SDK RSS is never substituted.', 'Hosted/deployed MCP startup remains a separate unmeasured interface; package startup does not claim Cloudflare cold-start coverage.')
  return { rows, gaps, artifacts }
}
