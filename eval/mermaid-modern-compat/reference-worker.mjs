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
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://reference.invalid' });
for (const key of ['window', 'document', 'location', 'localStorage', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
// Diagram DBs emit diagnostic logs. Only the prefixed JSON protocol goes to stdout.
console.log = console.info = console.debug = console.warn = console.error = () => {};
const { default: mermaid } = await import(pathToFileURL(require.resolve('mermaid')).href);
const { default: zenAddon } = await import(import.meta.resolve('@mermaid-js/mermaid-zenuml', pathToFileURL(resolve(process.argv[2], 'package.json')).href));
await mermaid.registerExternalDiagrams([zenAddon]);
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' });

import { snapshot, snapshotValue } from './reference-snapshot.mjs';
import { loadZenReference } from './reference-zenuml.mjs';
const zen = await loadZenReference(process.argv[2]);
const langium = await import(import.meta.resolve('@mermaid-js/parser', pathToFileURL(require.resolve('mermaid')).href));

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const { source } = JSON.parse(line);
    await mermaid.parse(source);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    const result = snapshot(diagram.db, diagram.type === 'gantt');
    if (diagram.type === 'eventmodeling') result.data.getEventModel = snapshotValue(await langium.parse('eventmodeling', source));
    if (diagram.type === 'zenuml') result.data.getZenModel = zen.parse(source).model;
    writeSync(1, wire({ ok: true, type: diagram.type, snapshot: result }));
  } catch (error) {
    writeSync(1, wire({ ok: false, error: String(error?.message ?? error).slice(0, 3000) }));
  }
}
dom.window.close();
