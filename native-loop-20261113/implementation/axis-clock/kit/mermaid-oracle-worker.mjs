// The pinned Mermaid oracle: one JSON request per stdin line, one reply per stdout line.
// Runs in Node against the installed reference, separate from any measured artifact.
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const write = process.stdout.write.bind(process.stdout)
const require = createRequire(resolve(process.argv[2], 'package.json'))
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'location', 'localStorage', 'sessionStorage', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
// Diagram DBs log diagnostics; only verdict lines reach stdout.
console.log = console.info = console.debug = console.warn = console.error = () => {}
const { default: mermaid } = await import(pathToFileURL(require.resolve('mermaid')).href)
// The parser package exports ESM only. Resolve its reviewed import entry from the
// same dependency root as Mermaid, rather than accidentally using Trident's deps.
const mermaidRequire = createRequire(require.resolve('mermaid'))
const parserManifest = mermaidRequire.resolve.paths('@mermaid-js/parser').map(root => join(root, '@mermaid-js/parser/package.json')).find(existsSync)
const parserEntry = JSON.parse(readFileSync(parserManifest, 'utf8')).exports['.'].import
const { parse: parseAst } = await import(pathToFileURL(resolve(dirname(parserManifest), parserEntry)).href)
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' })
if (process.argv[3]) {
  const { default: plugin } = await import(pathToFileURL(process.argv[3]).href)
  await mermaid.registerExternalDiagrams([plugin])
}
// Ported verbatim from Agentic's eval/mermaid-modern-compat/reference-worker.mjs: plain-data DB getters.
const omittedKeys = new Set(['domId', 'config', 'look', 'themeVariables']);
function plain(value, seen = new Map(), path = '$') {
  if (typeof value === 'function' || typeof value === 'undefined') return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return { $ref: seen.get(value) };
  seen.set(value, path);
  let out;
  if (value instanceof Map) {
    const entries = [...value];
    // Sort primitive-keyed DB collections before assigning reference paths.
    // Object keys retain insertion order and need no recursive sort probe.
    if (entries.every(([key]) => key === null || typeof key !== 'object')) entries.sort((a, b) => String(JSON.stringify(a[0])).localeCompare(String(JSON.stringify(b[0]))));
    out = entries.map(([key, entry], index) => [plain(key, seen, `${path}[${index}][0]`), plain(entry, seen, `${path}[${index}][1]`)]);
  }
  else if (value instanceof Set) out = [...value].map((entry, index) => plain(entry, seen, `${path}[${index}]`));
  else if (Array.isArray(value)) out = value.map((entry, index) => plain(entry, seen, `${path}[${index}]`));
  else {
    out = {};
    for (const key of Object.keys(value).sort()) {
      if (omittedKeys.has(key) || key.startsWith('$')) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) continue;
      const entry = plain(descriptor.value, seen, `${path}[${JSON.stringify(key)}]`);
      if (entry !== undefined) out[key] = entry;
    }
  }
  seen.delete(value);
  return out;
}

function snapshot(db, includeConfig = false) {
  const names = new Set();
  for (let proto = db; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  const data = {}, errors = {};
  for (const name of [...names].sort()) {
    if (!/^get[A-Z]|^(?:topAxisEnabled|inclusiveEndDates)$/.test(name)) continue;
    if (/Logger|DomId|Tooltip|Mapping|Position/.test(name) || /Config/.test(name) && !includeConfig) continue;
    const getter = db[name];
    // These C4 getters take an optional parent filter. Calling them without
    // one returns the complete authored collection, needed for label census.
    const optionalFilter = name === 'getC4ShapeArray' || name === 'getBoundaries';
    if (typeof getter !== 'function' || (getter.length !== 0 && !optionalFilter)) continue;
    try {
      const value = getter.call(db);
      if (value && typeof value.then === 'function') continue;
      const normalized = name === 'getCommonDb' ? snapshot(value).data : plain(value);
      if (normalized !== undefined) data[name] = normalized;
    } catch (error) { errors[name] = String(error?.message ?? error).slice(0, 500); }
  }
  return { data, errors };
}

// One JSON request per line: { source } asks for a verdict; { source, snapshot: true } also
// returns the diagram DB's getter values, from which authored labels are read.
for await (const line of createInterface({ input: process.stdin })) {
  let reply
  const request = JSON.parse(line)
  try {
    const parsed = await mermaid.parse(request.source)
    reply = { accepted: true, diagramType: parsed?.diagramType ?? null, error: null }
    if (request.snapshot) {
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(request.source)
      reply.snapshot = snapshot(diagram.db, diagram.type === 'gantt')
      // Event Modeling's getState computes SVG dimensions and fails in jsdom.
      // Its independent, pinned parser still exposes authored frame identities.
      if (diagram.type === 'eventmodeling') reply.snapshot.data.eventModelAst = plain(await parseAst('eventmodeling', diagram.text))
    }
  } catch (error) {
    reply = { accepted: false, diagramType: null, error: String(error?.message ?? error).split('\n')[0] }
  }
  write(JSON.stringify(reply).replace(/[\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16)}`) + '\n')
}
dom.window.close()
