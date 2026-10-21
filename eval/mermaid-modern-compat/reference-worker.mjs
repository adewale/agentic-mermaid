// Run in Node, separate from Agentic Mermaid's runtime and dependency graph.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { writeSync } from 'node:fs';

const require = createRequire(resolve(process.argv[2], 'package.json'));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
// Diagram DBs emit diagnostic logs. Only the prefixed JSON protocol goes to stdout.
console.log = console.info = console.debug = console.warn = console.error = () => {};
const { default: mermaid } = await import(pathToFileURL(require.resolve('mermaid')).href);
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' });

const omittedKeys = new Set(['domId', 'parent', 'config', 'look', 'themeVariables']);
function plain(value, seen = new Set(), depth = 0) {
  if (typeof value === 'function' || typeof value === 'undefined') return undefined;
  if (depth > 14) return '<depth-limit>';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '<circular>';
  seen.add(value);
  let out;
  if (value instanceof Map) out = [...value].map(([key, entry]) => [plain(key, seen, depth + 1), plain(entry, seen, depth + 1)]).sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
  else if (value instanceof Set) out = [...value].map(entry => plain(entry, seen, depth + 1));
  else if (Array.isArray(value)) out = value.map(entry => plain(entry, seen, depth + 1));
  else {
    out = {};
    for (const key of Object.keys(value).sort()) {
      if (omittedKeys.has(key) || key.startsWith('$')) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) continue;
      const entry = plain(descriptor.value, seen, depth + 1);
      if (entry !== undefined) out[key] = entry;
    }
  }
  seen.delete(value);
  return out;
}

function snapshot(db) {
  const names = new Set();
  for (let proto = db; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  const data = {}, errors = {};
  for (const name of [...names].sort()) {
    if (!/^get[A-Z]|^(?:topAxisEnabled|inclusiveEndDates)$/.test(name)) continue;
    if (/Config|Logger|DomId|Tooltip|Mapping|Position/.test(name)) continue;
    const getter = db[name];
    // These C4 getters take an optional parent filter. Calling them without
    // one returns the complete authored collection, needed for label census.
    const optionalFilter = name === 'getC4ShapeArray' || name === 'getBoundaries';
    if (typeof getter !== 'function' || (getter.length !== 0 && !optionalFilter)) continue;
    try {
      const value = getter.call(db);
      if (value && typeof value.then === 'function') continue;
      const normalized = plain(value);
      if (normalized !== undefined) data[name] = normalized;
    } catch (error) { errors[name] = String(error?.message ?? error).slice(0, 500); }
  }
  return { data, errors };
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const { source } = JSON.parse(line);
    // The public parser resets per-diagram configuration and applies frontmatter
    // and init directives. getDiagramFromText alone strips wrappers without
    // applying their config, which would incorrectly reject configured GitGraph.
    await mermaid.parse(source);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    writeSync(1, '\u0001modern-mermaid\u0001' + JSON.stringify({ ok: true, type: diagram.type, snapshot: snapshot(diagram.db) }) + '\n');
  } catch (error) {
    writeSync(1, '\u0001modern-mermaid\u0001' + JSON.stringify({ ok: false, error: String(error?.message ?? error).slice(0, 3000) }) + '\n');
  }
}
