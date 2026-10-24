import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mutationWitnessForFamily, structuralBuildWitnessForFamily } from './family-suite.ts'
import { decodeToolPayload, type InvocationOptions, invocationHarnessRoot, invocationRow } from './invocation.ts'
import { qualifyOutput } from './qualification.ts'
import type { BenchmarkObservation, UnifiedWorkload } from './types.ts'

async function ready(command: string, args: string[], cwd: string): Promise<{ child: ChildProcess; url: string; log: () => string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
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
export async function runInvocationMcp(options: InvocationOptions, workloads: UnifiedWorkload[]): Promise<{ rows: BenchmarkObservation[]; gaps: string[]; artifacts: string[] }> {
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
