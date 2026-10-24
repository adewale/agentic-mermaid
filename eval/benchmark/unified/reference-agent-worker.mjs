import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { semanticLabelValues } from './reference-portable.mjs'
const root = process.argv[2], api = await import(pathToFileURL(root + '/dist/agent-core.js'))
const wire = value => '\u0001modern-mermaid\u0001' + JSON.stringify(value).replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16)) + '\n'
const message = error => String(error?.message ?? error).slice(0, 3000)
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let timing, parseOk
  try {
    const { source, apiBenchmark } = JSON.parse(line), samples = Number(apiBenchmark?.samples ?? 3)
    if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) throw Error('Invalid API benchmark samples')
    const attempt = () => { try { return api.parseRegisteredMermaid(source) } catch (error) { return { ok: false, error: message(error) } } }
    const firstStart = performance.now(); let value = attempt(); const firstMs = performance.now() - firstStart
    attempt()
    const samplesMs = []
    for (let n = 0; n < samples; n++) { const started = performance.now(); value = attempt(); samplesMs.push(performance.now() - started) }
    timing = { firstMs, samplesMs, boundary: 'public parseRegisteredMermaid attempts, including rejected sources; projections and IPC excluded' }
    parseOk = value.ok
    if (!value.ok) { process.stdout.write(wire({ ok: false, parseOk: false, error: JSON.stringify(value.error), timing })); continue }
    const d = value.value, structured = !['opaque', 'preserved', 'extension'].includes(d.body.kind)
    process.stdout.write(wire({ ok: true, parseOk: true, type: d.kind, representation: d.body.kind, labels: structured ? semanticLabelValues({ body: d.body, accessibility: d.meta.accessibility }) : [], facts: api.describeMermaidFacts(d), timing }))
  } catch (error) { process.stdout.write(wire({ ok: false, ...(parseOk === undefined ? {} : { parseOk }), error: message(error), ...(timing ? { timing } : {}) })) }
}
