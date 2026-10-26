import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { extraBrowserEntry } from './community-extra-adapters.mjs'
import type { CommunityArtifact, PreparedCommunity } from './community-types.ts'
import { familySupportRow, familySupportWorkloads, unsupportedFamilyRow } from './family-support.ts'
import type { BenchmarkObservation, BenchmarkStatus, UnifiedRunOptions, UnifiedSuiteResult, UnifiedWorkload } from './types.ts'

type BrowserKind = 'beautiful' | 'pele' | 'mermaid' | 'function' | 'ondine' | 'franken' | 'merman' | 'extra'
export interface CommunityBrowserEngine {
  root: string
  entry: string
  kind: BrowserKind
  global?: string
  wasm?: string
  version: string
  revision?: string
  artifactSha256: string
  integrity?: string
  output?: 'svg' | 'png'
  legacyMermaid?: boolean
  qualificationHelper?: string
  apiBoundary?: string
  surface?: string
  files?: { path: string; sha256: string }[]
  scriptType?: 'module'
  synchronousLegacyRender?: boolean
  additionalOutputs?: 'png'[]
}
export interface PreparedCommunityBrowser extends PreparedCommunity {
  browser?: CommunityBrowserEngine
  browserStatus: 'prepared' | 'blocked' | 'not-applicable'
  browserDetail?: string
}
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const safe = (id: string): string => encodeURIComponent(id)
/** Seal executable/browser assets, not source-tree inputs or node_modules.
 * Delivery totals still use only observed requests, never this overapproximation. */
function browserFiles(engine: CommunityBrowserEngine): { path: string; sha256: string }[] {
  const paths = new Set<string>([resolve(engine.root, engine.entry)])
  if (engine.wasm) paths.add(resolve(engine.root, engine.wasm))
  if (engine.qualificationHelper) paths.add(engine.qualificationHelper)
  const scope = engine.entry.startsWith('dist/') ? join(engine.root, 'dist') : engine.root
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'test', 'tests', '__tests__'].includes(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        if (entry.name === 'entry.mjs' && path !== resolve(engine.root, engine.entry)) continue
        if (/\.(?:[cm]?js|wasm|woff2?|ttf|otf|css|svg|png|jpe?g|gif|webp|avif|ico|bin|data)$/i.test(entry.name) || (/\.json$/i.test(entry.name) && (engine.integrity || /(?:^|[/\\])(?:dist|assets|fonts)(?:[/\\])/.test(path)))) paths.add(path)
      }
    }
  }
  visit(scope)
  return [...paths].sort().map(path => ({ path, sha256: digest(readFileSync(path)) }))
}
function packageRoot(artifact: CommunityArtifact): string | undefined {
  if (artifact.root && existsSync(join(artifact.root, 'package.json'))) return artifact.root
  if (!artifact.module) return undefined
  let directory = dirname(resolve(artifact.module))
  for (;;) {
    if (existsSync(join(directory, 'package.json'))) return directory
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}
async function installWebMerman(prepared: PreparedCommunity, cache: string): Promise<string> {
  const declared = prepared.node.packages?.find(pkg => pkg.registry === 'npm' && pkg.name === '@mermanjs/web')
  if (!declared) throw new Error('The community node declares no @mermanjs/web browser package')
  const version = prepared.artifact?.version ?? declared.version,
    prefix = join(cache, 'merman-web', version),
    root = join(prefix, 'node_modules/@mermanjs/web')
  if (!existsSync(join(root, 'package.json'))) {
    mkdirSync(prefix, { recursive: true })
    await new Promise<void>((done, reject) => {
      const child = spawn('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', `@mermanjs/web@${version}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? join(cache, 'npm-cache') } })
      let error = ''
      child.stdout.on('data', chunk => {
        error = (error + String(chunk)).slice(-5000)
      })
      child.stderr.on('data', chunk => {
        error = (error + String(chunk)).slice(-5000)
      })
      const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
      child.once('error', cause => {
        clearTimeout(timer)
        reject(cause)
      })
      child.once('close', code => {
        clearTimeout(timer)
        code === 0 ? done() : reject(new Error(`@mermanjs/web acquisition exited ${code}: ${error}`))
      })
    })
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (pkg.version !== version) throw new Error('Merman web installed version differs from the pinned candidate')
  return root
}

/** Preparation is deliberately separate from all API clocks. It may bundle
 * actual published JS entries or acquire the separately published browser SDK. */
export async function prepareCommunityBrowsers(prepared: readonly PreparedCommunity[], options: UnifiedRunOptions): Promise<PreparedCommunityBrowser[]> {
  const harness = options.harnessRoot ?? options.root,
    cache = join(harness, 'node_modules/.cache/unified-community-browser'),
    results: PreparedCommunityBrowser[] = []
  mkdirSync(cache, { recursive: true })
  const helperDirectory = options.communityQualificationAssetDir ?? cache
  mkdirSync(helperDirectory, { recursive: true })
  const helperBuild = await build({
    stdin: {
      contents: `export{isRenderedSourceEcho}from ${JSON.stringify(join(harness, 'eval/benchmark/unified/qualification-visible-source.ts'))};export{inspectSvgText}from ${JSON.stringify(join(harness, 'eval/benchmark/unified/svg-text-inspection.ts'))}`,
      resolveDir: harness,
      sourcefile: 'community-visible-output-qualification.mjs',
    },
    write: false,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'unifiedCommunityQualification',
    external: ['node:*'],
    target: 'es2022',
    minify: true,
    logLevel: 'silent',
  })
  const helperBytes = helperBuild.outputFiles[0]?.contents
  if (!helperBytes) throw Error('Browser qualification helper compilation produced no output')
  const helperDigest = createHash('sha256').update(helperBytes).digest('hex'),
    qualificationHelper = join(helperDirectory, `qualification-visible-content-v3-${helperDigest}.js`)
  if (existsSync(qualificationHelper)) {
    if (options.communityQualificationAssetDir) throw Error('Qualification repair helper already exists; use a fresh asset directory')
    if (!Buffer.from(helperBytes).equals(readFileSync(qualificationHelper))) throw Error('Existing browser qualification helper does not match its compiled-byte identity')
  } else writeFileSync(qualificationHelper, helperBytes, { flag: 'wx' })
  for (const peer of prepared) {
    let result: PreparedCommunityBrowser = { ...peer, browserStatus: 'blocked' }
    try {
      if (!peer.node.benchmark) {
        results.push({ ...peer, browserStatus: 'not-applicable', browserDetail: 'Metadata/lineage/wrapper node: no independent browser renderer adapter is declared.' })
        continue
      }
      const sourceAdapter = (peer.node.benchmark as { sourceAdapter?: string }).sourceAdapter
      const adapter = ['beautiful-source', 'beautiful-fork'].includes(sourceAdapter ?? '') ? 'beautiful' : ['mermaid-source', 'mermaid-fork'].includes(sourceAdapter ?? '') ? 'mermaid' : peer.node.benchmark?.adapter,
        artifact = peer.artifact
      const supported = peer.node.benchmark?.outputs ?? peer.node.outputs
      if (!supported.includes('svg')) {
        results.push({ ...peer, browserStatus: 'not-applicable', browserDetail: 'This community capability does not expose SVG rendering.' })
        continue
      }
      const make = (root: string, entry: string, kind: BrowserKind, global?: string, wasm?: string): CommunityBrowserEngine => {
        const file = resolve(root, entry)
        if (!file.startsWith(resolve(root) + sep) || !existsSync(file)) throw new Error(`Browser entry is missing or outside artifact root: ${file}`)
        return {
          root: resolve(root),
          entry,
          kind,
          ...(global ? { global } : {}),
          ...(wasm ? { wasm } : {}),
          version: artifact?.version ?? peer.node.packages?.find(pkg => pkg.registry === 'npm')?.version ?? peer.node.distribution?.version ?? peer.node.release?.tag ?? 'unavailable',
          ...(artifact?.revision ? { revision: artifact.revision } : {}),
          artifactSha256: digest(readFileSync(file)),
          qualificationHelper,
          ...(artifact?.integrity ? { integrity: artifact.integrity } : {}),
        }
      }
      let engine: CommunityBrowserEngine | undefined
      if (adapter === 'merman') {
        const root = await installWebMerman(peer, cache),
          pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
        engine = make(root, pkg.main, 'merman')
        engine.version = pkg.version
        const lock = JSON.parse(readFileSync(join(root, '../../..', 'package-lock.json'), 'utf8'))
        engine.integrity = lock.packages?.['node_modules/@mermanjs/web']?.integrity
      } else if (!artifact) throw new Error(peer.error ?? 'No prepared browser artifact or published package')
      else if (artifact.kind === 'global') {
        if (!artifact.module) throw new Error('Global artifact has no module path')
        const root = artifact.root ?? dirname(artifact.module),
          entry = relative(root, artifact.module),
          global = artifact.global ?? (adapter === 'dart' ? 'mermaidDartRender' : adapter === 'bezel' ? 'bezelRender' : undefined)
        if (!global) throw new Error('Global artifact must declare its public global symbol')
        engine = make(root, entry, adapter === 'dart' || adapter === 'bezel' ? 'function' : 'beautiful', global)
      } else if (artifact.kind === 'franken') {
        if (!artifact.module) throw new Error('Franken artifact has no JS module')
        const root = artifact.root ?? dirname(artifact.module),
          wasm = artifact.wasm ?? join(dirname(artifact.module), 'frankenmermaid_bg.wasm')
        if (!existsSync(wasm)) throw new Error(`Franken WASM missing: ${wasm}`)
        engine = make(root, relative(root, artifact.module), 'franken', undefined, relative(root, wasm))
      } else if (artifact.kind === 'node') {
        const root = packageRoot(artifact)
        if (!root) throw new Error('Cannot resolve prepared published package root')
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
          zombie = pkg.name === 'zombie-mermaid'
        const browserRecipe = typeof pkg.scripts?.['build:browser'] === 'string' ? (pkg.scripts['build:browser'] as string) : ''
        const declaredBrowser = browserRecipe.match(/--outfile(?:=|\s+)([^\s]+)/)?.[1]?.replace(/^['"]|['"]$/g, '')
        const publicBeautifulBundle =
          adapter === 'beautiful' &&
          sourceAdapter &&
          declaredBrowser?.startsWith('dist/') &&
          existsSync(join(root, declaredBrowser)) &&
          existsSync(join(root, 'README.md')) &&
          readFileSync(join(root, 'README.md'), 'utf8').includes(declaredBrowser) &&
          readFileSync(join(root, declaredBrowser), 'utf8').includes('window.__mermaid')
            ? declaredBrowser
            : undefined
        if (peer.node.id === 'adewale/agentic-mermaid' || adapter === 'agentic') engine = make(root, 'dist/browser.global.js', 'beautiful', 'agenticMermaid')
        else if (publicBeautifulBundle) {
          engine = make(root, publicBeautifulBundle, 'beautiful', '__mermaid')
          engine.scriptType = 'module'
          engine.apiBoundary = 'Documented tracked public browser distribution window.__mermaid; source package entry remains a separate Bun invocation'
        } else if (adapter === 'mermaid') {
          const publicBundle = ['dist/mermaid.min.js', 'dist/mermaid.js'].find(path => existsSync(join(root, path)))
          if (publicBundle) engine = make(root, publicBundle, 'mermaid', 'mermaid')
          else {
            const output = join(cache, safe(peer.node.id), artifact.version)
            mkdirSync(output, { recursive: true })
            const entry = join(output, 'entry.mjs')
            writeFileSync(entry, `import api from ${JSON.stringify(artifact.module)};globalThis.unifiedMermaid=api;`)
            await build({ entryPoints: [entry], outfile: join(output, 'bundle.js'), bundle: true, platform: 'browser', format: 'iife', minify: true, target: 'es2022', logLevel: 'silent' })
            engine = make(output, 'bundle.js', 'mermaid', 'unifiedMermaid')
          }
          engine.legacyMermaid = Number.parseInt(pkg.version, 10) < 10
          engine.synchronousLegacyRender = Number.parseInt(pkg.version, 10) < 1
        } else if (adapter === 'pele' && existsSync(join(root, 'dist/pele.global.js'))) engine = make(root, 'dist/pele.global.js', 'pele', 'pele')
        else if (adapter === 'published-extra') {
          const spec = extraBrowserEntry(pkg.name, artifact) as { source: string; assets?: { source: string; name: string }[]; outputs?: string[]; qualification: string; surface?: string } | null
          if (!spec) {
            results.push({ ...peer, browserStatus: 'not-applicable', browserDetail: 'Reviewed published API is terminal/native/diagnostic/source/IR; no browser SVG API is declared by that entry.' })
            continue
          }
          const output = join(cache, safe(peer.node.id), artifact.version)
          mkdirSync(output, { recursive: true })
          const entry = join(output, 'entry.mjs')
          writeFileSync(entry, spec.source)
          for (const asset of spec.assets ?? []) {
            if (!existsSync(asset.source)) throw new Error(`Published browser asset unavailable: ${asset.source}`)
            copyFileSync(asset.source, join(output, asset.name))
          }
          await build({ entryPoints: [entry], outfile: join(output, 'bundle.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'unifiedExtra', minify: true, external: ['node:*'], target: 'es2022', logLevel: 'silent' })
          engine = make(output, 'bundle.js', 'extra', 'unifiedExtra')
          engine.apiBoundary = spec.qualification
          engine.surface = spec.surface
          if (spec.outputs?.includes('png') && supported.includes('png')) engine.additionalOutputs = ['png']
        } else if (['beautiful', 'zombie', 'pele', 'ondine'].includes(adapter ?? '')) {
          const output = join(cache, safe(peer.node.id), artifact.version)
          mkdirSync(output, { recursive: true })
          const entry = join(output, 'entry.mjs'),
            source = artifact.module && existsSync(artifact.module) ? artifact.module : join(root, typeof pkg.main === 'string' ? pkg.main : 'dist/index.js')
          if (adapter === 'ondine') {
            const renderer = join(root, 'dist/Render.js'),
              wasm = join(root, 'dist/internal/all.generated.wasm')
            if (!existsSync(renderer) || !existsSync(wasm)) throw new Error('Ondine published Render.js/WASM assets unavailable')
            copyFileSync(wasm, join(output, 'all.wasm'))
            writeFileSync(entry, `import{create}from ${JSON.stringify(renderer)};globalThis.unifiedLoadOndine=async()=>create({modules:{all:new WebAssembly.Module(await(await fetch('/all.wasm')).arrayBuffer())}});`)
          } else if (zombie || adapter === 'zombie') {
            const require = createRequire(join(root, 'package.json')),
              elk = require.resolve('elkjs/lib/elk.bundled.js')
            writeFileSync(entry, `import{registerElk}from ${JSON.stringify(source)};import ELK from ${JSON.stringify(elk)};registerElk(ELK);export*from ${JSON.stringify(source)};`)
          } else writeFileSync(entry, `export*from ${JSON.stringify(source)};`)
          await build({ entryPoints: [entry], outfile: join(output, 'bundle.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'unifiedPeer', minify: true, target: 'es2022', logLevel: 'silent' })
          engine = make(output, 'bundle.js', adapter === 'ondine' ? 'ondine' : adapter === 'pele' ? 'pele' : 'beautiful', adapter === 'ondine' ? 'unifiedLoadOndine' : 'unifiedPeer')
        } else {
          results.push({ ...peer, browserStatus: 'not-applicable', browserDetail: 'Prepared package exposes a native/Node transport; no declared browser rendering API adapter.' })
          continue
        }
      } else {
        results.push({ ...peer, browserStatus: 'not-applicable', browserDetail: 'Prepared native CLI/Python/worker has no browser rendering distribution.' })
        continue
      }
      if (!engine) throw new Error('Browser preparation produced no executable engine')
      engine.files = browserFiles(engine)
      result = { ...result, browser: engine, browserStatus: 'prepared' }
    } catch (error) {
      result.browserDetail = String(error)
    }
    results.push(result)
  }
  mkdirSync(options.out, { recursive: true })
  writeFileSync(join(options.out, 'community-browser-prepared.json'), JSON.stringify(results, null, 2) + '\n')
  return results
}

/** Public API calls are timed inside the page, excluding qualification and
 * output encoding. Returned SVG is independently checked outside API clocks. */
export async function runCommunityBrowserSuite(prepared: readonly PreparedCommunityBrowser[], workloads: readonly UnifiedWorkload[], options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  const selectedOutputs = options.communityOutputs
  const selected = (output: string) => !selectedOutputs || selectedOutputs.includes(output)
  const startedAt = new Date().toISOString(),
    observations: BenchmarkObservation[] = [],
    gaps = [
      'SVG XML/canvas and authored-label checks do not establish complete semantic identity, multiplicity, route geometry or visual fidelity. Dedicated family feature assertions remain separate.',
      'Core repeat cases calibrate to20ms/256iterations. With communityCoverageOnce, feature-corpus inputs qualify one actual call in round1 without warm/repeated speed samples; later rounds contain core only. These protocols never share a speed aggregate. API clocks exclude validation/cleanup; internal DOM measurement belongs to the API. JS heap excludes native/WASM/process memory.',
    ],
    raw: unknown[] = []
  const row = (peer: PreparedCommunityBrowser, workload: UnifiedWorkload, mode: string, status: BenchmarkStatus, extra: Partial<BenchmarkObservation> = {}): BenchmarkObservation => ({
    suite: 'community-browser',
    surface: peer.browser?.surface ?? 'browser:public-api',
    runtime: 'chromium',
    family: workload.family,
    caseId: workload.id,
    operation: 'render',
    format: peer.browser?.output ?? 'svg',
    mode,
    status,
    ...extra,
    metrics: { implementation: peer.node.id, apiBoundary: peer.browser?.apiBoundary ?? 'prepared public browser API', ...extra.metrics },
  })
  for (const peer of prepared.filter(peer => peer.browserStatus !== 'prepared' && selected(peer.browser?.output ?? 'svg'))) {
    const unavailable: UnifiedWorkload = { id: 'browser-capability', family: '*', source: '', features: [], provenance: 'community browser capability admission' }
    observations.push({
      ...row(peer, unavailable, 'capability', peer.browserStatus === 'not-applicable' ? 'not-applicable' : 'blocked', { detail: peer.browserDetail ?? 'Browser preparation was not run', metrics: { unmeasuredCases: workloads.length, reason: peer.browserDetail ?? 'Browser preparation required' } }),
      operation: 'capability',
    })
    if (peer.browserStatus === 'blocked') gaps.push(`${peer.node.id}: ${peer.browserDetail ?? 'Browser preparation required'} (${workloads.length} corpus cases unmeasured)`)
  }
  const familyProbes = new Map<string, Map<string, BenchmarkObservation>>()
  const engines = prepared
    .filter(peer => peer.browserStatus === 'prepared' && peer.browser)
    .flatMap(peer => [peer, ...(peer.browser!.additionalOutputs ?? []).map(output => ({ ...peer, browser: { ...peer.browser!, output, additionalOutputs: undefined } }))])
    .filter(peer => selected(peer.browser!.output ?? 'svg'))
  for (let round = 1; round <= options.rounds; round++)
    for (const peer of round % 2 ? engines : [...engines].reverse()) {
      const engine = peer.browser!,
        roundWorkloads = (options.communityCoverageOnce ?? true) && round > 1 ? workloads.filter(workload => workload.features.includes('core-graph-batch')) : workloads,
        fetched = new Set<string>(),
        remote = new Set<string>()
      const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        if (pathname === '/blank') {
          response.setHeader('content-type', 'text/html')
          response.end('<!doctype html><meta charset="utf-8"><body>')
          return
        }
        let file: string
        try {
          file = resolve(engine.root, '.' + decodeURIComponent(pathname))
        } catch {
          response.writeHead(400).end()
          return
        }
        if (!file.startsWith(engine.root + sep) || !existsSync(file)) {
          response.writeHead(404).end()
          return
        }
        response.setHeader('content-type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream')
        response.setHeader('cache-control', 'no-store')
        try {
          response.end(readFileSync(file))
        } catch {
          response.writeHead(404).end()
        }
      })
      await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Browser benchmark server has no TCP address')
      const origin = `http://127.0.0.1:${address.port}`
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, loadStarted: number | undefined
      const record: { id: string; round: number; engine: CommunityBrowserEngine; browser?: string; samples: BenchmarkObservation[]; payload?: unknown; error?: string } = { id: peer.node.id, round, engine, samples: [] }
      try {
        browser = await chromium.launch({ headless: true, executablePath: options.executable })
        record.browser = browser.version()
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
        context.on('request', request => {
          const u = new URL(request.url())
          if (u.origin === origin && u.pathname !== '/blank') fetched.add(u.pathname)
          else if (!['data:', 'blob:'].includes(u.protocol) && u.origin !== origin) remote.add(request.url())
        })
        await context.route('**/*', route => {
          const u = new URL(route.request().url())
          return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort()
        })
        const page = await context.newPage()
        page.setDefaultTimeout(30_000)
        await page.goto(origin + '/blank')
        if (!engine.qualificationHelper) throw new Error('Independent visible-source qualification helper was not prepared')
        await page.addScriptTag({ content: readFileSync(engine.qualificationHelper, 'utf8') })
        await page.evaluate(() => {
          ;(globalThis as any).AGENTIC_MERMAID_ELK_CACHE = '1'
          ;(globalThis as any).AGENTIC_MERMAID_SCENE_ASSERTIONS = '0'
        })
        const importStart = performance.now()
        loadStarted = importStart
        if (engine.kind === 'franken' || engine.kind === 'merman')
          await page.evaluate(
            async ({ kind, url, wasm }) => {
              const api = await import(url)
              if (kind === 'franken') {
                await api.default({ module_or_path: await (await fetch(wasm!)).arrayBuffer() })
                ;(globalThis as any).__communityRender = (source: string) => api.renderSvg(source)
              } else {
                await api.initMerman()
                ;(globalThis as any).__communityRender = (source: string) => api.renderSvg(source)
              }
            },
            { kind: engine.kind, url: origin + '/' + engine.entry, wasm: engine.wasm ? origin + '/' + engine.wasm : undefined },
          )
        else {
          await page.addScriptTag({ url: origin + '/' + engine.entry, ...(engine.scriptType ? { type: engine.scriptType } : {}) })
          await page.evaluate(async ({ kind, global, legacyMermaid, output, synchronousLegacyRender }) => {
            const api = (globalThis as any)[global!]
            if (kind === 'mermaid') {
              api.initialize({ startOnLoad: false })
              const owner = typeof api.render === 'function' ? api : api.mermaidAPI
              if (!owner || typeof owner.render !== 'function') throw new Error('Published Mermaid render API unavailable')
              ;(globalThis as any).__communityRender = legacyMermaid
                ? (source: string, id: string) =>
                    new Promise((resolve, reject) => {
                      try {
                        let callbackInvoked = false
                        const returned = owner.render(id, source, (svg: string) => {
                          callbackInvoked = true
                          resolve(svg)
                        })
                        if (typeof returned === 'string') resolve(returned)
                        else if (returned && typeof returned.then === 'function') returned.then(resolve, reject)
                        else if (synchronousLegacyRender && returned === undefined && !callbackInvoked) reject(new Error('Synchronous public Mermaid render returned no SVG and did not invoke its SVG callback'))
                      } catch (error) {
                        reject(error)
                      }
                    })
                : (source: string, id: string) => owner.render(id, source)
            } else if (kind === 'extra') {
              const render = await api.createRenderer()
              ;(globalThis as any).__communityRender = (source: string, id: string) => render(source, id, output ?? 'svg')
            } else if (kind === 'ondine') {
              const compiler = await api()
              ;(globalThis as any).__communityRender = (source: string) => compiler.render(source).svg
            } else if (kind === 'function') (globalThis as any).__communityRender = (source: string) => api(source)
            else if (kind === 'pele') (globalThis as any).__communityRender = (source: string) => api.render(source).svg
            else {
              const render = api.renderMermaidSVG ?? api.renderMermaidSVGAsync ?? api.renderMermaidSync ?? api.renderMermaid
              if (typeof render !== 'function') throw new Error('Published Beautiful SVG API unavailable')
              ;(globalThis as any).__communityRender = (source: string) => render.call(api, source)
            }
          }, engine)
        }
        record.samples.push({
          suite: 'community-browser',
          surface: engine.surface ?? 'browser:public-api',
          runtime: 'chromium',
          family: '*',
          caseId: 'loader',
          operation: 'load-and-initialize',
          format: engine.output ?? 'svg',
          mode: `cold-round-${round}`,
          status: 'passed',
          samplesMs: [performance.now() - importStart],
          metrics: { implementation: peer.node.id, browser: browser.version(), version: engine.version, artifactSha256: engine.artifactSha256, cache: 'public-default-repeats' },
        })
        // Probe each family once, before its corpus; a rejected canonical source skips that family.
        const supportKey = `${peer.node.id}\n${engine.output ?? 'svg'}`,
          probes = familyProbes.has(supportKey) ? [] : familySupportWorkloads(roundWorkloads),
          rejected = familyProbes.get(supportKey) ?? new Map<string, BenchmarkObservation>()
        familyProbes.set(supportKey, rejected)
        for (const workload of [...probes, ...roundWorkloads]) {
          const probe = probes.includes(workload)
          if (!probe && rejected.has(workload.family)) {
            record.samples.push(unsupportedFamilyRow(row(peer, workload, workload.features.includes('core-graph-batch') ? 'core-api-repeat' : (options.communityCoverageOnce ?? true) ? 'feature-corpus-qualification' : 'feature-corpus-attempt', 'unsupported', { metrics: { round } }), rejected.get(workload.family)!))
            continue
          }
          try {
            const pending = page.evaluate(
              async ({ source, expected, id, core, output, coverageOnly }) => {
                const call = async (suffix: string) => {
                  const start = performance.now()
                  let value: any, error: string | undefined
                  try {
                    value = (globalThis as any).__communityRender(source, id + suffix)
                    if (value && typeof value.then === 'function') value = await value
                  } catch (cause) {
                    error = String(cause)
                  }
                  const ms = performance.now() - start
                  const svg = output === 'png' ? (value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value instanceof Uint8Array ? value : undefined) : typeof value === 'string' ? value : value?.svg
                  ;(globalThis as any).__communityAfterCall?.()
                  for (const node of document.querySelectorAll('body > div:not([data-community-host])')) node.remove()
                  return { ms, svg, error }
                }
                const validate = (svg: unknown): string[] => {
                  if (output === 'png') {
                    if (!(svg instanceof Uint8Array) || svg.length < 33 || [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => svg[index] !== byte)) return ['Invalid PNG signature or truncated PNG']
                    const header = new DataView(svg.buffer, svg.byteOffset, svg.byteLength)
                    return String.fromCharCode(...svg.subarray(12, 16)) === 'IHDR' && header.getUint32(16) > 0 && header.getUint32(20) > 0 ? [] : ['PNG has invalid IHDR or empty dimensions']
                  }
                  if (typeof svg !== 'string') return ['No SVG string returned']
                  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'),
                    element = doc.documentElement
                  if (doc.querySelector('parsererror') || element.localName !== 'svg' || element.namespaceURI !== 'http://www.w3.org/2000/svg') return ['Malformed SVG document or missing SVG namespace']
                  const length = (value: string | null): number => (/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|pt|pc|cm|mm|in|q)?$/i.test(value?.trim() ?? '') ? Number.parseFloat(value!) : NaN)
                  const viewBox = element
                      .getAttribute('viewBox')
                      ?.trim()
                      .split(/[\s,]+/)
                      .map(Number),
                    width = length(element.getAttribute('width')),
                    height = length(element.getAttribute('height'))
                  if (!(viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0) && !(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return ['SVG has no positive finite canvas']
                  const tree = (node: Node): any => {
                    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) return { kind: 'text', value: node.nodeValue ?? '' }
                    if (!(node instanceof Element)) return undefined
                    return { kind: 'element', localName: node.localName, namespaceURI: node.namespaceURI ?? '', attributes: Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value])), children: [...node.childNodes].map(tree).filter(Boolean) }
                  }
                  const helper = (globalThis as any).unifiedCommunityQualification
                  if (typeof helper.inspectSvgText !== 'function') return ['Prepared qualification helper has no namespace-aware SVG text inspector']
                  const inspected = helper.inspectSvgText(tree(element), expected)
                  if (helper.isRenderedSourceEcho(source, svg, 'svg', inspected.primaryRuns)) return ['Visible SVG source-echo fallback is not diagram ink']
                  return inspected.missingLabels.map((label: string) => `Missing authored label: ${label}`)
                }
                const first = await call('_first')
                if (first.error) return { status: 'error', error: first.error, firstMs: first.ms }
                const firstFindings = validate(first.svg)
                if (firstFindings.length) return { status: 'qualification-failed', findings: firstFindings, firstMs: first.ms }
                const bytes = first.svg instanceof Uint8Array ? first.svg.byteLength : new TextEncoder().encode(first.svg).length
                if (!core && coverageOnly) return { status: 'ok', firstMs: first.ms, bytes, findings: [], hasLabelOracle: output !== 'png' && expected.length > 0, coverageOnly: true }
                let iterations = 1
                if (!core) {
                  const warm = await call('_warm')
                  if (warm.error) return { status: 'error', error: warm.error }
                }
                if (core)
                  for (;;) {
                    let total = 0
                    for (let i = 0; i < iterations; i++) {
                      const sample = await call('_warm_' + i)
                      if (sample.error) return { status: 'error', error: sample.error }
                      total += sample.ms
                    }
                    if (total >= 20 || iterations >= 256) break
                    iterations *= 2
                  }
                const samples: number[] = []
                let last = first
                for (let n = 0; n < 3; n++) {
                  let elapsed = 0
                  for (let i = 0; i < iterations; i++) {
                    last = await call(`_sample_${n}_${i}`)
                    if (last.error) return { status: 'error', error: last.error }
                    elapsed += last.ms
                  }
                  samples.push(elapsed / iterations)
                }
                const findings = validate(last.svg)
                return { status: findings.length ? 'qualification-failed' : 'ok', samples, iterations, firstMs: first.ms, bytes, findings, hasLabelOracle: output !== 'png' && expected.length > 0 }
              },
              { source: workload.source, expected: [...(workload.expectedLabels ?? [])], id: `unified_${round}_${record.samples.length}`, core: workload.features.includes('core-graph-batch'), output: engine.output ?? 'svg', coverageOnly: options.communityCoverageOnce ?? true },
            )
            let timer: ReturnType<typeof setTimeout> | undefined
            const measured = await Promise.race([
              pending,
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Browser API workload exceeded 30s')), 30_000)
              }),
            ]).finally(() => clearTimeout(timer))
            const status = measured.status === 'ok' ? 'passed' : 'failed'
            const observation = row(peer, workload, workload.features.includes('core-graph-batch') ? 'core-api-repeat' : (options.communityCoverageOnce ?? true) ? 'feature-corpus-qualification' : 'feature-corpus-attempt', status, {
              ...(measured.samples ? { samplesMs: measured.samples } : {}),
              ...(measured.bytes === undefined ? {} : { bytes: measured.bytes }),
              findings: measured.findings,
              detail: measured.error,
              metrics: {
                round,
                rejected: measured.status === 'error',
                firstMs: measured.firstMs ?? null,
                iterations: measured.iterations ?? null,
                version: engine.version,
                qualification: engine.output === 'png' ? 'PNG-signature-and-positive-dimensions; no pixel-text/fidelity assertion' : measured.hasLabelOracle ? 'XML-canvas-and-authored-labels' : 'XML-and-canvas',
                apiBoundary: engine.apiBoundary ?? 'public browser API',
                cache: 'public-default-repeats',
              },
            })
            if (!probe) record.samples.push(observation)
            else {
              record.samples.push(familySupportRow(observation))
              if (familySupportRow(observation).status === 'unsupported') rejected.set(workload.family, observation)
            }
          } catch (error) {
            record.samples.push(row(peer, workload, workload.features.includes('core-graph-batch') ? 'core-api-repeat' : (options.communityCoverageOnce ?? true) ? 'feature-corpus-qualification' : 'feature-corpus-attempt', 'failed', { detail: String(error), metrics: { round } }))
            throw error
          }
        }
        try {
          const cdp = await context.newCDPSession(page)
          await cdp.send('HeapProfiler.collectGarbage')
          const heap = await cdp.send('Runtime.getHeapUsage')
          await cdp.detach()
          record.samples.push({
            suite: 'community-browser',
            surface: engine.surface ?? 'browser:public-api',
            runtime: 'chromium-v8',
            family: '*',
            caseId: 'post-portfolio-heap',
            operation: 'memory',
            format: engine.output ?? 'svg',
            mode: `after-round-${round}`,
            status: 'passed',
            metrics: {
              implementation: peer.node.id,
              round,
              jsHeapUsedBytes: heap.usedSize,
              portfolioCaseCount: roundWorkloads.length,
              featureCases: roundWorkloads.filter(workload => !workload.features.includes('core-graph-batch')).length,
              note: 'Fresh realm, forced GC after this round portfolio; not native/WASM/process memory',
            },
          })
        } catch (error) {
          gaps.push(`${peer.node.id}: browser JS heap unavailable: ${String(error)}`)
        }
      } catch (error) {
        record.error = String(error)
        if (!record.samples.some(sample => sample.operation === 'load-and-initialize'))
          record.samples.push({
            suite: 'community-browser',
            surface: engine.surface ?? 'browser:public-api',
            runtime: 'chromium',
            family: '*',
            caseId: 'loader',
            operation: 'load-and-initialize',
            format: engine.output ?? 'svg',
            mode: `cold-round-${round}`,
            status: 'blocked',
            ...(loadStarted === undefined ? {} : { samplesMs: [performance.now() - loadStarted] }),
            metrics: { implementation: peer.node.id, round },
            detail: String(error),
          })
        const observed = new Set(record.samples.map(sample => sample.caseId))
        for (const workload of roundWorkloads.filter(workload => !observed.has(workload.id)))
          record.samples.push(
            row(peer, workload, workload.features.includes('core-graph-batch') ? 'core-api-repeat' : (options.communityCoverageOnce ?? true) ? 'feature-corpus-qualification' : 'feature-corpus-attempt', 'blocked', { detail: `Browser realm unavailable after error: ${String(error)}`, metrics: { round } }),
          )
        gaps.push(`${peer.node.id} round ${round}: ${String(error)}`)
      } finally {
        await browser?.close()
        await new Promise<void>(done => server.close(() => done()))
      }
      const files = [...fetched].map(url => {
        const file = resolve(engine.root, '.' + decodeURIComponent(url))
        if (!file.startsWith(engine.root + sep) || !existsSync(file)) return { url, error: 'Fetched file unavailable after timing' }
        const bytes = readFileSync(file)
        return { url, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, sha256: digest(bytes) }
      })
      record.payload = { files, gzip: files.reduce((sum, file) => sum + (file.gzip ?? 0), 0), remoteRequestsBlocked: [...remote] }
      observations.push(...record.samples, {
        suite: 'community-browser',
        surface: engine.surface ?? 'browser:public-api',
        runtime: 'chromium',
        family: '*',
        caseId: 'observed-request-closure',
        operation: 'delivery',
        format: engine.output === 'png' ? 'png:js-wasm-fonts' : 'js-wasm-fonts',
        mode: `round-${round}`,
        status: record.error ? 'blocked' : files.some(file => file.error) ? 'failed' : files.length ? 'passed' : 'blocked',
        bytes: files.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
        metrics: {
          implementation: peer.node.id,
          round,
          gzipBytes: files.reduce((sum, file) => sum + (file.gzip ?? 0), 0),
          requests: files.length,
          remoteRequestsBlocked: remote.size,
          version: engine.version,
          renderedOutput: engine.output ?? 'svg',
          portfolioCaseCount: roundWorkloads.length,
          featureCases: roundWorkloads.filter(workload => !workload.features.includes('core-graph-batch')).length,
        },
      })
      raw.push(record)
      mkdirSync(options.out, { recursive: true })
      writeFileSync(join(options.out, 'community-browser-rounds.json'), JSON.stringify(raw, null, 2) + '\n')
    }
  const status = observations.some(row => row.status === 'failed') ? 'failed' : observations.some(row => row.status === 'blocked') ? 'blocked' : 'passed'
  return { id: 'community-browser', status, startedAt, finishedAt: new Date().toISOString(), observations, gaps, artifacts: [join(options.out, 'community-browser-prepared.json'), join(options.out, 'community-browser-rounds.json')] }
}
