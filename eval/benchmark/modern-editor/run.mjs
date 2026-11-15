// Run with Bun; all outputs belong outside the source tree. No peer code is patched.
import { assertBenchmarkExecutionAllowed } from 'trident/ci-policy.ts'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { cpus, release } from 'node:os'
import { extname, join, relative, resolve, sep } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { chromium } from 'playwright'
import { officialCorpusInventory } from '../../shared/official-fences.ts'
import { probeModernThemes } from './themes.mjs'
import { resumeEngineEvidence } from './evidence.mjs'

assertBenchmarkExecutionAllowed()

const [peerArg, outArg] = process.argv.slice(2)
if (!peerArg || !outArg) throw new Error('bun commands.ts agentic --suites modern-editor --modern-editor-root MODERN_CHECKOUT --out OUTPUT_DIRECTORY')
const peer = resolve(peerArg), out = resolve(outArg), repo = resolve(import.meta.dir, '../../..')
if (out.startsWith(repo + sep)) throw new Error('Keep generated evidence outside the repository')
mkdirSync(out, { recursive: true })
const json = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n')
const revision = dir => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const corpus = officialCorpusInventory()
const modernEngine = join(peer, 'node_modules/mermaid/dist')
const referenceEngine = join(repo, 'node_modules/mermaid/dist')
const agenticBundle = join(repo, 'dist/browser.global.js')
const moduleBytes = root => readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(?:mjs|cjs|js)$/.test(entry.name))
  .map(entry => join(entry.parentPath, entry.name)).sort()
  .map(path => ({ path: relative(root, path).split(sep).join('/'), sha256: digest(path) }))
const revisions = { agentic: revision(repo), modern: revision(peer) }
const fetchedArtifacts = { modernLockSha256: digest(join(peer, 'pnpm-lock.yaml')), agenticBundleSha256: digest(agenticBundle),
  modernModules: moduleBytes(modernEngine), referenceModules: moduleBytes(referenceEngine), modernThemesSourceSha256: digest(join(peer, 'src/utils/themes.ts')) }
const resumed = process.env.RESUME_ENGINES === '1'
  ? resumeEngineEvidence(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')), JSON.parse(readFileSync(join(out, 'inventory.json'), 'utf8')),
    { revisions, fetchedArtifacts }, corpus)
  : undefined
json('inventory.json', corpus)
const entry = join(out, 'fixture-entry.ts')
writeFileSync(entry, ['themes', 'examples', 'fonts', 'backgrounds', 'compression'].map((name, i) => `import * as m${i} from ${JSON.stringify(join(peer, 'src/utils', name + '.ts'))};`).join('\n') + '\nglobalThis.modernBench = {...m0,...m1,...m2,...m3,...m4};\n')
const built = await Bun.build({ entrypoints: [entry], outdir: out, naming: 'fixtures.js', target: 'browser', format: 'iife', minify: true })
if (!built.success) throw new Error(built.logs.join('\n'))
const roots = { '/modern-engine/': modernEngine, '/reference-engine/': referenceEngine }
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  if (pathname === '/blank') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body></body></html>'); return }
  let root = join(peer, 'dist'), relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  for (const [prefix, dir] of Object.entries(roots)) if (pathname.startsWith(prefix)) { root = dir; relative = pathname.slice(prefix.length) }
  let file = resolve(root, relative)
  if (pathname === '/agentic.js') file = agenticBundle
  else if (pathname === '/fixtures.js') file = join(out, 'fixtures.js')
  else if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return }
  if (!existsSync(file)) { res.writeHead(404).end(); return }
  res.setHeader('content-type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(file)] ?? 'application/octet-stream')
  res.end(readFileSync(file))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] })
const externalRequests = new Set()
await context.route('**/*', route => {
  const url = route.request().url()
  if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
  externalRequests.add(url)
  return route.abort()
})
const report = { status: 'incomplete', date: new Date().toISOString(), environment: { platform: process.platform, release: release(), cpu: cpus()[0].model, node: process.version, bun: Bun.version, browser: browser.version(), viewport: { width: 1440, height: 1000 }, externalNetwork: 'blocked', serviceWorkers: 'blocked' }, revisions, fetchedArtifacts, corpus,
  ...(resumed ?? { engines: [] }), editor: [], themes: [], examples: [], exports: [], probes: {} }
json('report.json', report)
try {
  // Same-document, serial SVG-return timing. This is the dependency engine with
  // Modern's default config, not the complete editor's debounce/postprocessing.
  const inputs = corpus.occurrences
  for (let round = 1; process.env.RESUME_ENGINES !== '1' && round <= 3; round++) {
    const engines = round % 2 ? ['modern', 'agentic', 'reference'] : ['reference', 'agentic', 'modern']
    for (const engine of engines) {
      const page = await context.newPage()
      await page.goto(origin + '/blank')
      await page.addScriptTag({ url: origin + '/fixtures.js' })
      await page.addScriptTag({ url: origin + (engine === 'agentic' ? '/agentic.js' : engine === 'modern' ? '/modern-engine/mermaid.min.js' : '/reference-engine/mermaid.min.js') })
      await page.evaluate(engine => {
        if (engine !== 'agentic') mermaid.initialize(engine === 'modern' ? { startOnLoad: false, suppressErrorRendering: true, ...modernBench.themes.linearLight.mermaidConfig } : { startOnLoad: false, suppressErrorRendering: true })
      }, engine)
      for (let offset = 0; offset < inputs.length; offset += 50) {
        const rows = await page.evaluate(async ({ engine, inputs, round }) => {
          const rows = []
          for (const [index, input] of inputs.entries()) {
            const start = performance.now()
            let svg, error
            try { svg = engine === 'agentic' ? agenticMermaid.renderMermaidSVG(input.source) : (await mermaid.render(`b${round}_${index}`, input.source)).svg }
            catch (e) { error = String(e) }
            const ms = performance.now() - start
            if (!error && !svg?.includes('<svg')) error = 'No SVG returned'
            rows.push({ engine, round, id: input.id, family: input.family, ms, ok: !error, bytes: svg?.length, ...(error ? { error } : {}) })
            document.body.replaceChildren()
          }
          return rows
        }, { engine, inputs: inputs.slice(offset, offset + 50), round })
        report.engines.push(...rows)
        console.log(`${engine} round ${round}: ${Math.min(offset + 50, inputs.length)}/${inputs.length}`)
        json('report.json', report)
      }
      await page.close()
    }
  }
  const themedPage = await context.newPage()
  await themedPage.goto(origin + '/blank')
  await themedPage.addScriptTag({ url: origin + '/fixtures.js' })
  await themedPage.addScriptTag({ url: origin + '/modern-engine/mermaid.min.js' })
  const representatives = new Map()
  for (const input of inputs) if (!representatives.has(input.family) && report.engines.some(row => row.engine === 'modern' && row.round === 1 && row.id === input.id && row.ok)) representatives.set(input.family, input)
  report.themeFamilyMatrix = await themedPage.evaluate(async inputs => {
    const rows = []
    for (const [theme, config] of Object.entries(modernBench.themes)) for (const input of inputs) {
      try { mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true, ...config.mermaidConfig }); const { svg } = await mermaid.render('matrix', input.source); rows.push({ theme, family: input.family, id: input.id, ok: svg.includes('<svg') }) }
      catch (e) { rows.push({ theme, family: input.family, id: input.id, ok: false, error: String(e) }) }
      document.body.replaceChildren()
    }
    return rows
  }, [...representatives.values()])
  await themedPage.close()
  json('report.json', report)
  const page = await context.newPage()
  const requested = new Map()
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.origin === origin && ['script', 'stylesheet', 'document'].includes(response.request().resourceType())) requested.set(url.pathname, response.request().resourceType())
  })
  await page.addInitScript(() => { localStorage.setItem('cookie_consent_accepted', 'true'); localStorage.setItem('mermaid-language', 'en') })
  const start = Date.now()
  await page.goto(origin)
  await page.locator('div.p-12 > svg').waitFor()
  report.startupMs = Date.now() - start
  await page.screenshot({ path: join(out, 'editor-desktop.png') })
  const payload = []
  for (const [path, type] of requested) {
    const bytes = readFileSync(join(peer, 'dist', path === '/' ? 'index.html' : path.slice(1)))
    payload.push({ path, type, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotliCompressSync(bytes).length })
  }
  report.startupPayload = payload
  await page.addScriptTag({ url: origin + '/fixtures.js' })
  const fixtures = await page.evaluate(() => ({ themes: Object.keys(modernBench.themes), fonts: modernBench.fonts.length, backgrounds: modernBench.backgrounds.length, examples: Object.entries(modernBench.examples).flatMap(([category, examples]) => examples.flatMap(example => Object.entries(example.code).map(([language, source]) => ({ id: example.id + ':' + language, category, source })))) }))
  report.catalog = { themes: fixtures.themes, fonts: fixtures.fonts, backgrounds: fixtures.backgrounds, exampleVariants: fixtures.examples.length }
  const preview = async source => {
    const before = await page.locator('div.p-12 > svg').getAttribute('id').catch(() => null)
    const begin = await page.evaluate(() => { globalThis.maxGap = 0; let last = performance.now(); globalThis.heartbeat = setInterval(() => { const now = performance.now(); globalThis.maxGap = Math.max(globalThis.maxGap, now - last); last = now }, 5); return performance.now() })
    await page.locator('textarea').fill(source)
    try {
      await page.waitForFunction(({ before, begin }) => {
        const svg = document.querySelector('div.p-12 > svg')
        return (svg && svg.id !== before) || (performance.now() - begin > 350 && document.body.innerText.includes('Syntax Error:'))
      }, { before, begin }, { timeout: 30000 })
      return await page.evaluate(async begin => { await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); clearInterval(globalThis.heartbeat); const svg = document.querySelector('div.p-12 > svg'); return { ms: performance.now() - begin, maxTimerGapMs: globalThis.maxGap, ok: !document.body.innerText.includes('Syntax Error:'), text: svg ? [...svg.querySelectorAll('text,.nodeLabel')].map(node => node.textContent).join('|') : null, viewBox: svg?.getAttribute('viewBox') } }, begin)
    } catch (e) { await page.evaluate(() => clearInterval(globalThis.heartbeat)); return { ok: false, error: String(e) } }
  }
  for (const nodes of [5, 50, 150]) for (let rep = 0; rep < 4; rep++) {
    const source = 'flowchart TD\n' + Array.from({ length: nodes - 1 }, (_, i) => `n${Math.floor(i / 3)}[Node ${Math.floor(i / 3)}] --> n${i + 1}[Node ${i + 1}]`).join('\n') + `\nn0[Root ${rep}]`
    report.editor.push({ nodes, rep, ...(await preview(source)) })
    json('report.json', report)
  }
  for (const example of fixtures.examples) {
    // Change whitespace to ensure even identical language variants trigger React.
    report.examples.push({ id: example.id, category: example.category, ...(await preview(example.source + '\n'.repeat(report.examples.length % 2 + 1))) })
    json('report.json', report)
  }
  const themeProbe = await page.evaluate(origin => ({
    catalog: Object.entries(modernBench.themes).map(([id, theme]) => ({ id, name: theme.name })),
    url: `${origin}/?c=${modernBench.compressToURL('flowchart LR\n A[Alpha] --> B[Beta]')}`,
  }), origin)
  Object.assign(report, await probeModernThemes(page, themeProbe.catalog, themeProbe.url, out), { themeMeasuredAt: new Date().toISOString() })
  json('report.json', report)
  await page.goto(origin)
  await page.locator('div.p-12 > svg').waitFor()
  const custom = 'flowchart LR\n A[Unicode café 日本語] --> B[Shared state]'
  await preview(custom)
  await page.getByTitle('Share', { exact: true }).click()
  const share = await page.evaluate(() => navigator.clipboard.readText())
  await page.goto(share)
  await page.locator('div.p-12 > svg').waitFor()
  report.probes.share = { urlLength: share.length, codePreserved: await page.locator('textarea').inputValue() === custom, queryKeys: [...new URL(share).searchParams.keys()] }
  for (const [format, label] of [['jpeg', 'With Background'], ['png', 'Transparent']]) {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const downloadPromise = page.waitForEvent('download', { timeout: 20000 })
    await page.getByRole('button', { name: new RegExp(label, 'i') }).click()
    try { const download = await downloadPromise; const file = join(out, `export.${format}`); await download.saveAs(file); const bytes = readFileSync(file); const dimensions = await page.evaluate(async data => { const image = new Image(); image.src = data; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return { width: image.width, height: image.height, cornerRGBA: [...ctx.getImageData(0, 0, 1, 1).data] } }, `data:image/${format};base64,${bytes.toString('base64')}`); report.exports.push({ format, ok: true, bytes: bytes.length, sha256: digest(file), ...dimensions }) }
    catch (e) { report.exports.push({ format, ok: false, error: String(e) }) }
    json('report.json', report)
  }
  // Annotations live in a sibling overlay. Compare decoded pixels, not just the
  // presence of a download, to establish whether export carries that artwork.
  await page.getByTitle('Annotations', { exact: true }).click()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await page.mouse.move(720, 350); await page.mouse.down(); await page.mouse.move(850, 430, { steps: 8 }); await page.mouse.up()
  const annotationCount = () => page.locator('svg.absolute g rect[rx="4"]').count()
  report.probes.annotations = { drawn: await annotationCount() }
  await page.screenshot({ path: join(out, 'annotated.png') })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const annotatedDownload = page.waitForEvent('download', { timeout: 20000 })
  await page.getByRole('button', { name: /Transparent/i }).click()
  const annotationFile = join(out, 'export-annotated.png')
  await (await annotatedDownload).saveAs(annotationFile)
  report.probes.annotations.exportBytesIdentical = digest(annotationFile) === digest(join(out, 'export.png'))
  const beforePixels = readFileSync(join(out, 'export.png')).toString('base64'), afterPixels = readFileSync(annotationFile).toString('base64')
  report.probes.annotations.exportPixels = await page.evaluate(async ({ beforePixels, afterPixels }) => {
    const decode = async base64 => { const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); return { width: img.width, height: img.height, pixels: ctx.getImageData(0, 0, img.width, img.height).data } }
    const a = await decode(beforePixels), b = await decode(afterPixels)
    let differingChannels = 0
    if (a.pixels.length === b.pixels.length) for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) differingChannels++
    return { sameDimensions: a.width === b.width && a.height === b.height, differingChannels }
  }, { beforePixels, afterPixels })
  await page.getByTitle('Share', { exact: true }).click()
  const annotatedShare = await page.evaluate(() => navigator.clipboard.readText())
  await page.goto(annotatedShare); await page.locator('div.p-12 > svg').waitFor()
  report.probes.annotations.shared = await annotationCount()
  await page.evaluate(() => navigator.clipboard.writeText('benchmark-before-copy'))
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await page.getByRole('button', { name: /Transparent/i }).click()
  await page.getByText('Copy successful!', { exact: true }).waitFor({ timeout: 20000 })
  report.probes.clipboard = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const images = []
    for (const item of items) for (const type of item.types) images.push({ type, bytes: (await item.getType(type)).size })
    return images
  })
  const invalid = await preview('flowchart LR\n A --> [')
  report.probes.invalid = invalid
  report.probes.recovery = await preview('flowchart LR\n A[Recovered] --> B[Valid]')
  await page.reload()
  await page.locator('div.p-12 > svg').waitFor()
  report.probes.reload = { retainsDiagram: (await page.locator('textarea').inputValue()).includes('Recovered') }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(out, 'editor-mobile.png') })
  report.probes.mobile = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, textareaWidth: document.querySelector('textarea').getBoundingClientRect().width }))
  report.externalRequests = [...externalRequests]
  report.status = 'completed'
  json('report.json', report)
} finally { await browser.close(); await new Promise(done => server.close(done)) }
