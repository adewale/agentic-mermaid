// The pinned Mermaid oracle: one JSON source per stdin line, one verdict per stdout line.
// Runs in Node against the installed reference, separate from any measured artifact.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const write = process.stdout.write.bind(process.stdout)
const require = createRequire(resolve(process.argv[2], 'package.json'))
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
// Diagram DBs log diagnostics; only verdict lines reach stdout.
console.log = console.info = console.debug = console.warn = console.error = () => {}
const { default: mermaid } = await import(pathToFileURL(require.resolve('mermaid')).href)
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' })
for await (const line of createInterface({ input: process.stdin })) {
  let verdict
  try {
    const parsed = await mermaid.parse(JSON.parse(line))
    verdict = { accepted: true, diagramType: parsed?.diagramType ?? null, error: null }
  } catch (error) {
    verdict = { accepted: false, diagramType: null, error: String(error?.message ?? error).split('\n')[0] }
  }
  write(JSON.stringify(verdict).replace(/[\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16)}`) + '\n')
}
dom.window.close()
