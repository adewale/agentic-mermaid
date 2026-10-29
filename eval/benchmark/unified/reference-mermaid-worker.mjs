// Run in Node. Trident owns public-parser timing; Agentic owns the DB projection.
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

import { snapshot } from '../../mermaid-modern-compat/reference-snapshot.mjs';
import { samplePublicParser } from 'trident/unified/parser-timing.mjs';

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let timing, parseOk;
  try {
    const { source, apiBenchmark } = JSON.parse(line);
    if (apiBenchmark) {
      const result = await samplePublicParser(source => mermaid.parse(source), source, Number(apiBenchmark.samples ?? 3));
      timing = result.timing;
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
