// Reviewed published API bindings. This module does not parse with Agentic
// Mermaid, install packages or replace missing renderer output with source.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function extraPackagePreparation(name) {
  switch (name) {
    case '@ramtinj95/pi-mermaid-tui': return { entry: 'src/grok-renderer.ts', runtime: 'Bun (published Pi renderer component)', boundary: 'published WASM renderer component; Pi host hooks excluded' }
    case '@yassimba/pi-loom-mermaid': return { entry: 'src/loom-mermaid/index.ts', runtime: 'Bun (published Loom renderer component)', boundary: 'published terminal renderer component; Pi host hooks excluded' }
    case 'opencode-merman': return { entry: 'src/markdown.ts', runtime: 'Bun (OpenTUI headless integration)', companions: ['@opentui/core@0.5.14', '@opentui/solid@0.5.14', 'solid-js@1.9.12', '@opencode/plugin@2.0.22', '@opencode/theme@2.0.22'], boundary: 'published Markdown renderer in real OpenTUI headless host' }
    case '@kitlangton/merman': return { runtime: 'Bun (published terminal renderer)', boundary: 'public render(content,{color:false})' }
    case '@crafter/mermaid-renderer': return { companions: ['@crafter/mermaid-parser@0.0.4', '@crafter/mermaid-layout@0.0.3', '@crafter/mermaid-themes@0.0.3'], boundary: 'public parse → layout → renderToString pipeline' }
    case '@toeverything/mermaid-wasm': return { wasmRelativePath: 'pkg/affine_mermaid_renderer_wasm_bg.wasm', boundary: 'public Rust/WASM renderer' }
    case '@evangwt/xmermaid': return { wasmRelativePath: 'dist/xmermaid_wasm_bg.wasm', boundary: 'public browser XMermaid SVG API; DOM measurement included' }
    case 'dsh-plugin-mermaid-gb-svg': return { subpath: 'engine', boundary: 'public /engine renderDiagram with DEFAULT_OPTIONS' }
    case '@tayomi/termaid-bin': return { nativeResolver: 'termaidPath', boundary: 'published redistributed CLI; use cli:end-to-end, not Node API speed' }
    default: return { boundary: 'published package API' }
  }
}
export async function prepareExtraPublishedArtifact(artifact, context = {}) {
  const pkg = JSON.parse(fs.readFileSync(join(artifact.root, 'package.json'), 'utf8'))
  if (pkg.name !== '@tayomi/termaid-bin') return artifact
  const module = await import(pathToFileURL(artifact.module).href), resolveBinary = module.termaidPath ?? module.default?.termaidPath
  if (typeof resolveBinary !== 'function') throw Error('Published termaidPath resolver is absent')
  const binary = resolveBinary()
  if (typeof binary !== 'string' || !fs.existsSync(binary) || !fs.statSync(binary).isFile()) throw Error('Actual optional termaid platform executable unavailable')
  const nativeRoot = dirname(binary), native = JSON.parse(fs.readFileSync(join(nativeRoot, 'package.json'), 'utf8'))
  if (!Object.hasOwn(pkg.optionalDependencies ?? {}, native.name) || pkg.optionalDependencies[native.name] !== native.version) throw Error('Resolved binary differs from the declared exact optional platform package')
  const integrity = context.installedIntegrity?.(nativeRoot, native.name, native.version)
  if (!integrity) throw Error('Native optional dependency requires real installed npm lock integrity admission')
  const sha256 = createHash('sha256').update(fs.readFileSync(binary)).digest('hex')
  return { ...artifact, kind: 'cli', executable: fs.realpathSync(binary), args: [], input: 'stdin', format: 'terminal', sha256, runtime: 'Nuitka-compiled Python public CLI', apiBoundary: 'Public termaid stdin→Unicode stdout with default non-TTY uncolored output', nativePackage: { name: native.name, version: native.version, integrity, root: nativeRoot }, files: [...(artifact.files ?? []), { path: binary, sha256 }] }
}
const fn = (api, name) => {
  if (typeof api?.[name] !== 'function') throw Error(`Published public API is absent: ${name}`)
  return api[name].bind(api)
}
const requireResult = (value, detail) => { if (value == null) throw Error('Unsupported diagram or no artifact: ' + detail); return value }
const packageName = context => context.config.sourceAdapter === 'opencode-source' ? 'opencode-merman' : context.config.package ?? JSON.parse(fs.readFileSync(join(context.artifact.root, 'package.json'), 'utf8')).name
async function companion(context, name) {
  let entry
  try { entry = context.require.resolve(name) } catch {}
  // An import-only public export is unavailable to createRequire.resolve, and
  // some Bun conditions point at unpublished src/. Resolve its declared ESM
  // export from the actual installed package, never a guessed private module.
  if (!entry || !fs.existsSync(entry)) {
    const root = (context.require.resolve.paths(name) ?? []).map(path => join(path, name)).find(path => fs.existsSync(join(path, 'package.json')))
    if (!root) throw Error('Installed companion package unavailable: ' + name)
    const pkg = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8'))
    const select = value => {
      if (typeof value === 'string') return value
      if (Array.isArray(value)) { for (const child of value) { const found = select(child); if (found) return found }; return }
      if (value && typeof value === 'object') for (const [condition, child] of Object.entries(value)) if (['node', 'import', 'default'].includes(condition)) { const found = select(child); if (found) return found }
    }
    const exported = select(pkg.exports?.['.'] ?? pkg.exports)
    if (!exported || !exported.startsWith('./')) throw Error('Published companion import entry unavailable: ' + name)
    entry = resolve(root, exported)
    if (!fs.existsSync(entry)) throw Error('Declared companion import entry is not published: ' + name + ' ' + exported)
  }
  return import(pathToFileURL(entry).href)
}
const resultErrors = value => value?.errors ?? value?.diagnostics ?? value?.issues
export function diagnosticSummary(value) {
  const typed = typeof value === 'string' ? JSON.parse(value) : value
  if (!typed || typeof typed !== 'object' || !Array.isArray(resultErrors(typed))) throw Error('Diagnostic API returned no typed finding envelope')
  const errors = resultErrors(typed).filter(item => !['warning', 'info', 'hint'].includes(String(item?.severity ?? item?.level ?? '').toLowerCase()))
  const kind = typed.diagramType ?? typed.diagram_type ?? typed.type
  const unknown = typeof kind === 'string' && ['unknown', 'unsupported', 'none'].includes(kind.toLowerCase())
  const rejected = typed.valid === false || typed.isValid === false || typed.ok === false || typed.success === false || errors.length > 0 || unknown
  return { errorCount: errors.length, findingCount: resultErrors(typed).length, accepted: !rejected && !unknown, unknownKind: unknown, kind: typeof kind === 'string' ? kind : null }
}
export function diagnosticQualification(value, workload) {
  const summary = diagnosticSummary(value)
  if (summary.unknownKind) throw Error('Unsupported diagnostic family; unknown/pass-through is not validation')
  if (workload.features.includes('core-graph-batch') && !summary.accepted) {
    const error = Error('Validator rejected independently valid fixed-core source; errors=' + summary.errorCount)
    error.qualification = true
    throw error
  }
  return workload.features.includes('core-graph-batch')
    ? 'independently valid core accepted with zero error findings; negative-control admission required separately'
    : 'diagnostic operation completed; findings/accepted retained without a positive feature oracle'
}
function terminalArt(value) {
  const art = requireResult(value, 'terminal renderer returned no supported drawing')
  if (art.fallback === true) throw Error('Unsupported terminal diagram: renderer returned source-box fallback (' + (art.fallbackReason ?? 'unknown') + ')')
  const lines = art.plain ?? art.plainLines
  if (!Array.isArray(lines) || lines.some(line => typeof line !== 'string')) throw Error('Published renderer returned no owned terminal lines')
  return lines.join('\n')
}

async function bindExtraCommunityApi(context) {
  const { artifact, output, cleanups } = context, name = packageName(context)
  let imported = context.module
  if (!imported) imported = await import(pathToFileURL(artifact.module).href)
  const api = imported.default && typeof imported.default === 'object' ? { ...imported.default, ...imported } : imported
  if (context.config.sourceAdapter === 'ascii-mermaid-source') return { invoke: fn(api, 'renderMermaidAscii'), qualification: 'public source-package renderMermaidAscii' }
  switch (name) {
    case '@woxqaq/mermaid-rs-renderer-js': return { invoke: fn(api, 'renderSync'), qualification: 'public native SVG renderSync' }
    case '@toeverything/mermaid-wasm': {
      const wasm = artifact.wasm ?? join(artifact.root, 'pkg/affine_mermaid_renderer_wasm_bg.wasm')
      if (!fs.existsSync(wasm)) throw Error('Published WASM asset unavailable: ' + wasm)
      await api.default({ module_or_path: fs.readFileSync(wasm) })
      return { invoke: fn(api, 'render_mermaid_svg'), qualification: 'public Rust/WASM render_mermaid_svg' }
    }
    case '@zhenhuaa/mdv': return { invoke: output === 'svg' ? fn(api, 'renderMermaidSVG') : source => fn(api, 'renderMermaidASCII')(source, { useAscii: false }), qualification: 'published SVG/terminal renderer library, markdown browser excluded' }
    case '@aj-archipelago/merval': return { invoke: fn(api, 'validateMermaid'), qualify: diagnosticQualification, diagnosticsCount: value => resultErrors(value)?.length ?? null, qualification: 'typed validator findings; no rendering claim' }
    case 'rusty-mermaid': {
      if (typeof api.default === 'function') await api.default(artifact.wasm ? fs.readFileSync(artifact.wasm) : undefined)
      const validate = api.validateMermaid ?? api.validateMermaidJson
      if (typeof validate !== 'function') throw Error('Published Rusty Mermaid validator API unavailable')
      return { invoke: source => validate(source), qualify: (value, workload) => diagnosticQualification(typeof value === 'string' ? JSON.parse(value) : value, workload), diagnosticsCount: value => resultErrors(typeof value === 'string' ? JSON.parse(value) : value)?.length ?? null, qualification: 'public validator findings; no rendering claim' }
    }
    case 'mermaid-formatter': return {
      invoke: fn(api, 'formatMermaid'),
      qualify(value) { if (typeof value !== 'string' || !value.trim()) throw Error('Formatter returned no source'); return 'formatted-source envelope only; not parser correctness or SVG fidelity' },
      qualification: 'public source formatter, not rendering or equivalent parse assertions',
    }
    case '@crafter/mermaid-renderer': {
      const parser = await companion(context, '@crafter/mermaid-parser'), layout = await companion(context, '@crafter/mermaid-layout')
      const parse = source => { const result = fn(parser, 'parse')(source); if (!result?.ast || result.diagnostics?.some(item => item.severity === 'error')) throw Error('Parser rejected diagram: ' + JSON.stringify(result?.diagnostics)); return result.ast }
      if (output === 'parse') return { invoke: parse, qualification: 'public parser AST, no renderer/layout claim' }
      if (output !== 'svg') throw Error('Unsupported output: this published renderer exports SVG, not terminal art')
      return { invoke: source => fn(api, 'renderToString')(fn(layout, 'layout')(parse(source))), qualification: 'published parser+layout+SVG pipeline; all three API calls included' }
    }
    case 'merslim': {
      if (output === 'terminal') return { invoke: async source => requireResult(await fn(api, 'sourceToAscii')(source), 'sourceToAscii'), qualification: 'public sourceToAscii' }
      if (output === 'parse') return { invoke: fn(api, 'parseToIR'), qualification: 'public native IR parse' }
      if (output !== 'svg') throw Error('Unsupported Node output: actual PNG API requires browser Canvas; browser adapter owns it')
      const builders = { flowchart: 'flowchartToSvg', class: 'classToSvg', er: 'erToSvg', gantt: 'buildGanttSvg', timeline: 'buildTimelineSvg', pie: 'buildPieSvg', quadrant: 'buildQuadrantSvg', journey: 'buildJourneySvg', architecture: 'buildArchitectureSvg', c4: 'buildC4Svg', gitgraph: 'buildGitGraphSvg' }
      return { invoke: async source => { const parsed = await fn(api, 'parseToIR')(source); if (!parsed?.ok || !parsed.ir) throw Error('Unsupported or rejected native IR: ' + JSON.stringify(parsed)); const method = builders[parsed.type]; if (!method) throw Error('Unsupported Node SVG path: this family uses the public React browser renderer'); return fn(api, method)(parsed.ir) }, qualification: 'public parseToIR plus published standalone SVG builder; browser-dependent families remain explicit' }
    }
    case '@evangwt/xmermaid': throw Error('Unsupported Node SVG path: XMermaid public constructor/rendering requires browser HTMLElement; measured in real browser')
    case '@kitlangton/merman': return { invoke: source => fn(api, 'render')(source, { color: false }), qualification: 'public plain-text terminal render' }
    case 'vitepress-plugin-mermaid-diagram': return { invoke: source => requireResult(fn(api, 'render')(source), 'standalone render'), qualification: 'public standalone renderer; Markdown/Vite lifecycle excluded' }
    case 'dsh-plugin-mermaid-gb-svg': return { invoke: source => requireResult(fn(api, 'renderDiagram')(source, { ...api.DEFAULT_OPTIONS }, {}), 'renderDiagram')?.res?.svg, qualification: 'public /engine source→parse→layout→SVG with package defaults' }
    case 'mermaid-reactflow-render': return {
      invoke: fn(api, 'convertMermaidToReactFlow'),
      qualify(value, workload) {
        if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw Error('React Flow API returned no nodes/edges IR')
        const nativeLabels = [...value.nodes.map(node => node?.data?.label ?? node?.label), ...value.edges.map(edge => edge?.label ?? edge?.data?.label)]
        const labels = new Set(nativeLabels.filter(label => typeof label === 'string').map(label => label.replace(/\s+/g, ' ').trim()))
        const missing = (workload.expectedLabels ?? []).filter(label => !labels.has(label.replace(/\s+/g, ' ').trim()))
        if (missing.length) throw Error('React Flow IR lost declared node/edge labels: ' + missing.slice(0, 8).join(', '))
        return 'positioned React Flow nodes/edges plus declared literal labels in native node/edge fields; role correspondence and relationship multiplicity unmeasured; not SVG fidelity'
      },
      qualification: 'public positioned React Flow IR; never represented as SVG or terminal output',
    }
    case 'mermaidtui': return { invoke: source => fn(api, 'renderMermaidToTui')(source, { ascii: false }), qualification: 'public Unicode terminal renderer' }
    case '@tayomi/termaid-ts': return { invoke: fn(api, 'render'), qualify(_value, workload) { if (typeof api.declaredType === 'function' && !api.declaredType(workload.source)) throw Error('Unsupported declared family: raw-source fallback is not a diagram'); return undefined }, qualification: 'public terminal render; raw-source fallback excluded' }
    case 'tui-mermaid':
    case 'lovely-mermaid':
    case '@yassimba/pi-loom-mermaid': return { invoke: source => terminalArt(fn(api, 'render')(source)), qualification: 'published renderer plus its owned plain terminal lines; source-box fallbacks excluded' }
    case '@ramtinj95/pi-mermaid-tui': {
      const renderer = await fn(api, 'loadGrokRenderer')()
      return { invoke: source => fn(api, 'grokHtmlToPlainLines')(renderer.renderHtml(source, 10000)).join('\n'), qualification: 'published WASM renderer component plus public HTML-to-terminal decoder; Pi host excluded' }
    }
    case 'opencode-merman': {
      // This is a real headless OpenTUI host, not a fabricated render context.
      const testing = await companion(context, '@opentui/core/testing')
      const host = await fn(testing, 'createTestRenderer')({ width: 240, height: 160 })
      cleanups.push(async () => { await host.renderer?.destroy?.() })
      return { invoke: async source => {
        const renderNode = fn(api, 'createMermaidCodeBlockRenderer')(host.renderer)
        const node = renderNode({ text: source, lang: 'mermaid', type: 'code' }, { defaultRender: () => undefined })
        if (!node) throw Error('Unsupported diagram or no OpenTUI renderable')
        host.renderer.root.add(node)
        await host.renderOnce()
        const value = typeof host.captureCharFrame === 'function' ? host.captureCharFrame() : typeof host.getTextLines === 'function' ? host.getTextLines().join('\n') : undefined
        host.renderer.root.remove(node); node.destroy?.()
        if (typeof value !== 'string') throw Error('Actual OpenTUI host did not expose captured terminal text')
        return value
      }, qualification: 'actual published Markdown renderer in OpenTUI headless host; plugin install/config hooks excluded' }
    }
    case '@tayomi/termaid-bin': throw Error('Native CLI adapter required: termaidPath resolves executable; no fake in-process Node renderer')
    default: throw Error('No reviewed published-extra API binding for ' + name)
  }
}

export async function createExtraCommunityApi(context) {
  const bound = await bindExtraCommunityApi(context), name = packageName(context)
  const component = ['@ramtinj95/pi-mermaid-tui', '@yassimba/pi-loom-mermaid'].includes(name)
  const runtime = process.versions.bun ? 'bun' : 'node'
  return {
    ...bound,
    surface: name === 'opencode-merman' ? runtime + ':opentui-headless-integration' : component ? runtime + ':published-renderer-component' : runtime + ':public-api',
    boundary: extraPackagePreparation(name).boundary + '; ' + bound.qualification,
  }
}

function publishedEntry(root, name, subpath = '.') {
  let base = root
  for (;;) {
    const directory = join(base, 'node_modules', name), metadata = join(directory, 'package.json')
    if (fs.existsSync(metadata)) {
      const pkg = JSON.parse(fs.readFileSync(metadata, 'utf8'))
      const select = value => typeof value === 'string' ? value : value && typeof value === 'object' ? select(value.browser ?? value.import ?? value.default) : undefined
      const file = select(pkg.exports?.[subpath] ?? (subpath === '.' ? pkg.exports : undefined)) ?? (subpath === '.' ? pkg.module ?? pkg.main : undefined)
      if (!file || !fs.existsSync(resolve(directory, file))) throw Error('Published browser companion entry unavailable: ' + name + '/' + subpath)
      return resolve(directory, file)
    }
    const parent = dirname(base)
    if (parent === base) throw Error('Required browser companion not installed: ' + name)
    base = parent
  }
}
/** Returns actual published-module bundling input. Called during preparation,
 * never within API clocks; assets retain their real fetched-package identity. */
export function extraBrowserEntry(name, artifact) {
  const from = JSON.stringify(artifact.module), root = artifact.root
  if (!root || !artifact.module) throw Error('Browser extra adapter requires an admitted module and package root')
  if (name === '@toeverything/mermaid-wasm') return {
    assets: [{ source: artifact.wasm ?? join(root, 'pkg/affine_mermaid_renderer_wasm_bg.wasm'), name: 'renderer.wasm' }],
    source: `import init,{render_mermaid_svg}from ${from};export async function createRenderer(){await init({module_or_path:await(await fetch('/renderer.wasm')).arrayBuffer()});return source=>render_mermaid_svg(source)}`,
    qualification: 'public Rust/WASM renderer; initialization outside clocks',
  }
  if (name === '@evangwt/xmermaid') return {
    assets: [{ source: artifact.wasm ?? join(root, 'dist/xmermaid_wasm_bg.wasm'), name: 'renderer.wasm' }],
    source: `import{XMermaid,initWasm}from ${from};export async function createRenderer(){await initWasm({wasmUrl:new URL('/renderer.wasm',location.href)});const container=document.createElement('div');container.dataset.communityHost='true';document.body.append(container);const renderer=new XMermaid({container});return source=>renderer.renderToSVGString(source,{wasm:{wasmUrl:new URL('/renderer.wasm',location.href)}})}`,
    qualification: 'public XMermaid browser SVG string API; real DOM measurement included',
  }
  if (name === 'merslim') {
    const react = JSON.stringify(publishedEntry(root, 'react')), dom = JSON.stringify(publishedEntry(root, 'react-dom', './client'))
    return {
      source: `import{DiagramRenderer,bootstrapDiagramRenderers,toSvgString,svgToPngBlob}from ${from};import*as React from ${react};import{createRoot}from ${dom};export async function createRenderer(){bootstrapDiagramRenderers();let pending;globalThis.__communityAfterCall=()=>{if(pending){pending.root.unmount();pending.host.remove();pending=undefined}};return async(source,_id,format='svg')=>{const host=document.createElement('div');host.dataset.communityHost='true';document.body.append(host);const root=createRoot(host),handleRef=React.createRef();pending={root,host};let failure;root.render(React.createElement(DiagramRenderer,{source,handleRef,onError:message=>{failure=message}}));const element=await new Promise((resolve,reject)=>{const started=performance.now();function check(){if(failure){reject(Error(failure));return}const svg=handleRef.current?.getSvgElement();if(svg){resolve(svg);return}if(performance.now()-started>25000){reject(Error('Public React SVG handle unavailable after25s'));return}requestAnimationFrame(check)}requestAnimationFrame(check)});const svg=toSvgString(element,{stripForeignObject:false});return format==='png'?svgToPngBlob(svg):svg}}`,
      outputs: ['svg', 'png'], surface: 'browser:react-component',
      qualification: 'actual React DiagramRenderer through public handle/toSvgString or svgToPngBlob; mount/measurement included, cleanup excluded',
    }
  }
  if (name === '@crafter/mermaid-renderer') {
    const parser = JSON.stringify(publishedEntry(root, '@crafter/mermaid-parser')), layout = JSON.stringify(publishedEntry(root, '@crafter/mermaid-layout'))
    return { source: `import{parse}from ${parser};import{layout}from ${layout};import{renderToString}from ${from};export async function createRenderer(){return source=>{const parsed=parse(source);if(!parsed.ast||parsed.diagnostics.some(d=>d.severity==='error'))throw Error('Parser rejected source: '+JSON.stringify(parsed.diagnostics));return renderToString(layout(parsed.ast))}}`, qualification: 'published parse/layout/renderToString browser pipeline' }
  }
  if (name === '@zhenhuaa/mdv') return { source: `import{renderMermaidSVG}from ${from};export async function createRenderer(){return source=>renderMermaidSVG(source)}`, qualification: 'published renderer library, terminal markdown browser host excluded' }
  if (name === 'vitepress-plugin-mermaid-diagram') return { source: `import{render}from ${from};export async function createRenderer(){return source=>{const svg=render(source);if(svg===null)throw Error('Unsupported diagram');return svg}}`, qualification: 'published standalone render, Vite/Markdown hooks excluded' }
  if (name === 'dsh-plugin-mermaid-gb-svg') return { source: `import{renderDiagram,DEFAULT_OPTIONS}from ${from};export async function createRenderer(){return source=>{const artifact=renderDiagram(source,{...DEFAULT_OPTIONS},{});if(!artifact)throw Error('Unsupported diagram');return artifact.res.svg}}`, qualification: 'published /engine SVG pipeline, plugin install hooks excluded' }
  return null
}
