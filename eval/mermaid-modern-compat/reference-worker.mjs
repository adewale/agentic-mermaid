// Run in Node, separate from Agentic Mermaid's runtime and dependency graph.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { writeSync } from 'node:fs';

// JSON leaves U+2028/U+2029 raw, and the parent's Bun readline ends a line at
// either, so a reply holding one would arrive split in two.
const wire = value => '\u0001modern-mermaid\u0001' + JSON.stringify(value).replace(/[\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16)}`) + '\n';

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

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let timing, parseOk;
  try {
    const { source, apiBenchmark } = JSON.parse(line);
    if (apiBenchmark) {
      const samples = Number(apiBenchmark.samples ?? 3);
      if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) throw new Error('Invalid API benchmark samples');
      const attempt = async () => { try { const value = await mermaid.parse(source); return value === false ? { ok: false, error: 'Public parser returned false' } : { ok: true }; } catch (error) { return { ok: false, error: String(error?.message ?? error).slice(0, 3000) }; } };
      const firstStart = performance.now(); let result = await attempt(); const firstMs = performance.now() - firstStart;
      await attempt();
      const samplesMs = [];
      for (let sample = 0; sample < samples; sample++) { const started = performance.now(); result = await attempt(); samplesMs.push(performance.now() - started); }
      timing = { firstMs, samplesMs, boundary: 'public mermaid.parse attempts, including rejected sources; DB projection and IPC excluded' };
      parseOk = result.ok;
      if (!parseOk) { writeSync(1, wire({ ok: false, parseOk: false, error: result.error, timing })); continue; }
    }
    // Public parse applies per-diagram/frontmatter configuration before the DB
    // view. Benchmark timing remains opt-in and ordinary oracle calls unchanged.
    await mermaid.parse(source);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    writeSync(1, wire({ ok: true, type: diagram.type, snapshot: snapshot(diagram.db, diagram.type === 'gantt'), ...(timing ? { parseOk: true, timing } : {}) }));
  } catch (error) {
    writeSync(1, wire({ ok: false, error: String(error?.message ?? error).slice(0, 3000), ...(parseOk === undefined ? {} : { parseOk }), ...(timing ? { timing } : {}) }));
  }
}
