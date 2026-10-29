// Actual installed native entry, explicit upstream and assembled controls.
// bun scripts/pr-assets/zenuml-evidence.ts OUT_DIRECTORY
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { officialCorpusInventory } from '../../eval/shared/official-fences.ts'
const root = resolve(import.meta.dir, '../..'),
  out = resolve(process.argv[2] ?? 'bench-report/zenuml-evidence')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim()) throw Error('Commit tracked source changes before capturing revision-bound ZenUML evidence')
mkdirSync(out, { recursive: true })
const corpus = officialCorpusInventory()
const inputs = corpus.occurrences.filter(input => input.family === 'zenuml')
const reference = await Bun.build({ entrypoints: [join(root, 'scripts/pr-assets/zenuml-reference-entry.ts')], target: 'browser' })
if (!reference.success) throw Error(reference.logs.join('\n'))
const referenceBytes = await reference.outputs[0]!.text()
const server = Bun.serve({
  port: 0,
  fetch: request => {
    const path = new URL(request.url).pathname
    if (path === '/') return new Response('<!doctype html><html><body><div id="output"></div></body></html>', { headers: { 'Content-Type': 'text/html' } })
    if (path === '/reference.js') return new Response(referenceBytes, { headers: { 'Content-Type': 'text/javascript' } })
    if (path.startsWith('/dist/') && !path.includes('..')) return new Response(Bun.file(join(root, path)), { headers: { 'Content-Type': 'text/javascript' } })
    return new Response('missing', { status: 404 })
  },
})
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const rows: Array<Record<string, unknown>> = []
try {
  await page.goto(`http://localhost:${server.port}`)
  for (const [index, input] of inputs.entries()) {
    const row: Record<string, unknown> = { id: input.id, source: input.source }
    for (const role of ['candidate', 'upstream', 'reference'] as const) {
      const result = await page.evaluate(
        async ({ role, source }) => {
          try {
            if (role !== 'reference') {
              const path = '/dist/zenuml.js'
              const api = await import(path)
              return { svg: role === 'candidate' ? await api.renderZenUMLSVG(source, { embedFontImport: false }) : await api.renderUpstreamZenUMLSVG(source, { backendURL: '/dist/zenuml-frame.global.js' }) }
            }
            const path = '/reference.js'
            const api = await import(path)
            return { svg: await api.render(source) }
          } catch (error) {
            return { error: String(error) }
          }
        },
        { role, source: input.source },
      )
      row[role] = result
      if (result.svg) {
        const name = `${index}-${role}`
        writeFileSync(join(out, `${name}.svg`), result.svg)
        await page.locator('#output').evaluate((element, svg) => {
          element.innerHTML = svg
        }, result.svg)
        if (index < 8) await page.locator('#output > svg').screenshot({ path: join(out, `${name}.png`) })
      }
    }
    rows.push(row)
  }
  const complexSource = readFileSync(join(root, 'src/__tests__/testdata/zenuml-checkout.mmd'), 'utf8')
  const complex: Record<string, unknown> = { configuration: 'Explicit upstream paint-only adapter and assembled reference', source: complexSource, outcomes: {} }
  for (const role of ['github-light', 'dracula', 'reference']) {
    const result = await page.evaluate(async ({ role, source }) => {
      const path = role === 'reference' ? '/reference.js' : '/dist/zenuml.js'
      const api = await import(path)
      const svg = role === 'reference' ? await api.render(source) : await api.renderUpstreamZenUMLSVG(source, { backendURL: '/dist/zenuml-frame.global.js', style: role })
      document.getElementById('output')!.innerHTML = svg
      const root = document.querySelector<SVGSVGElement>('#output > svg')!, viewport = root.getBoundingClientRect()
      return {
        svg,
        participants: [...root.querySelectorAll('.participant')].map(node => [node.getAttribute('data-participant'), node.querySelector('.participant-label')!.textContent]),
        messages: [...root.querySelectorAll('.message')].map(node => {
          const line = node.querySelector('line')!
          return { label: node.querySelector('text')!.textContent, direction: Math.sign(Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'))) }
        }),
        replies: [...root.querySelectorAll('.return-label')].map(node => node.textContent),
        fragment: root.querySelector('.fragment')!.textContent,
        clippedText: [...root.querySelectorAll('text')].filter(node => {
          const box = node.getBoundingClientRect()
          return box.left < viewport.left - 0.5 || box.right > viewport.right + 0.5 || box.top < viewport.top - 0.5 || box.bottom > viewport.bottom + 0.5
        }).map(node => node.textContent),
      }
    }, { role, source: complexSource })
    ;(complex.outcomes as Record<string, unknown>)[role] = result
    writeFileSync(join(out, `checkout-${role}.svg`), result.svg)
    await page.locator('#output > svg').screenshot({ path: join(out, `checkout-${role}.png`) })
  }
  const nativeSource = readFileSync(join(root, 'eval/layout-compare/fixtures/zenuml-native-checkout.mmd'), 'utf8')
  const nativeCheckout: Record<string, unknown> = { source: nativeSource, outcomes: {} }
  const combinations = [['patent-drawing', 'github-light'], ['hand-drawn', 'dracula'], ['watercolor', 'solarized-light']]
  for (const style of combinations) {
    const result = await page.evaluate(async ({ source, style }) => {
      const entry = '/dist/zenuml.js', api = await import(entry)
      const svg = await api.renderZenUMLSVG(source, { style, embedFontImport: false })
      document.getElementById('output')!.innerHTML = svg
      const root = document.querySelector<SVGSVGElement>('#output > svg')!, viewport = root.getBoundingClientRect()
      return {
        svg,
        messages: [...root.querySelectorAll('g.message[data-id]')].map(node => {
          const relation = node.querySelector('[data-from][data-to]')!
          return { id: node.getAttribute('data-id'), from: relation.getAttribute('data-from'), to: relation.getAttribute('data-to'), parentId: node.getAttribute('data-parent-id'), label: node.getAttribute('data-label') }
        }),
        clippedText: [...root.querySelectorAll('text')].filter(node => {
          const box = node.getBoundingClientRect()
          return box.left < viewport.left - 0.5 || box.right > viewport.right + 0.5 || box.top < viewport.top - 0.5 || box.bottom > viewport.bottom + 0.5
        }).map(node => node.textContent),
        frames: document.querySelectorAll('iframe').length,
      }
    }, { source: nativeSource, style })
    const name = style.join('.')
    ;(nativeCheckout.outcomes as Record<string, unknown>)[name] = result
    writeFileSync(join(out, `native-checkout-${name}.svg`), result.svg)
    await page.locator('#output > svg').screenshot({ path: join(out, `native-checkout-${name}.png`) })
  }
  writeFileSync(
    join(out, 'report.json'),
    JSON.stringify(
      {
        revision,
        browser: browser.version(),
        candidate: 'Native Zen semantics projected through shared Sequence layout and Scene',
        upstreamControl: '@zenuml/core@3.47.9 in explicit isolated backend',
        reference: 'mermaid@12.2.0 + @mermaid-js/mermaid-zenuml@1.0.1 + @zenuml/core@3.47.9',
        denominator: corpus.occurrenceCount,
        zenumlOccurrences: inputs.length,
        rows,
        complex,
        nativeCheckout,
        limitation: 'SVG acceptance and finite screenshots are separate from semantic fidelity. First eight official occurrences have native/upstream/reference PNG witnesses; every occurrence retains its source and actual outcome. The authored native Checkout shows three full Look/Palette combinations and owned relation identities; the earlier Checkout retains explicit upstream paint-only controls. Neither adds a Dave occurrence. No performance clocks.',
      },
      null,
      2,
    ),
  )
  const panels = rows
    .slice(0, 8)
    .map(
      (row, index) =>
        `<section><h2>${String(row.id)}</h2><p>Native Agentic, explicit upstream and registered Mermaid control. Layout and paint belong to each renderer; inspect retained participant/message meaning.</p><div style="display:flex;gap:24px">${['candidate', 'upstream', 'reference'].map(role => ((row[role] as { svg?: string }).svg ? `<img style="max-width:32%" alt="${role}: ZenUML occurrence ${index}" src="${index}-${role}.png">` : `<pre>${JSON.stringify(row[role])}</pre>`)).join('')}</div></section>`,
    )
    .join('')
  writeFileSync(
    join(out, 'index.html'),
    `<!doctype html><html><meta charset="utf-8"><title>ZenUML native and configured controls</title><body><h1>Native ZenUML and explicit upstream controls</h1><section><h2>Native Checkout</h2><p>Customer alias, nested reserve call, conditional replies and late Ticket creation through existing Sequence geometry, Scene and Looks.</p><div style="display:flex;gap:24px">${combinations.map(style => `<figure><img style="max-width:100%" alt="Native Checkout: ${style.join(' + ')}" src="native-checkout-${style.join('.')}.png"><figcaption>${style.join(' + ')}</figcaption></figure>`).join('')}</div></section><section><h2>Explicit upstream paint controls</h2><div style="display:flex;gap:24px">${['github-light', 'dracula', 'reference'].map(role => `<figure><img style="max-width:100%" alt="Upstream Checkout: ${role}" src="checkout-${role}.png"><figcaption>${role}</figcaption></figure>`).join('')}</div></section>${panels}</body></html>`,
  )
  console.log(`${rows.length} unchanged ZenUML occurrences: ${rows.filter(row => (row.candidate as { svg?: string }).svg).length} candidate SVGs; ${rows.filter(row => (row.reference as { svg?: string }).svg).length} reference SVGs. ${out}`)
} finally {
  await browser.close()
  server.stop(true)
}
