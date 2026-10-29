// Run in Node, separate from Agentic Mermaid's runtime and dependency graph.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { readFileSync, writeSync } from 'node:fs';
import { createZenUMLReference } from './zenuml-reference.mjs';

// JSON leaves U+2028/U+2029 raw, and the parent's Bun readline ends a line at
// either, so a reply holding one would arrive split in two.
const wire = value => '\u0001modern-mermaid\u0001' + JSON.stringify(value).replace(/[\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16)}`) + '\n';

const require = createRequire(resolve(process.argv[2], 'package.json'));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option', 'location', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
// Diagram DBs emit diagnostic logs. Only the prefixed JSON protocol goes to stdout.
console.log = console.info = console.debug = console.warn = console.error = () => {};
const { default: mermaid } = await import(pathToFileURL(require.resolve('mermaid')).href);
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' });
const zen = createZenUMLReference(mermaid, JSON.parse(readFileSync(require.resolve('mermaid/package.json'), 'utf8')).version);

import { snapshot } from './reference-snapshot.mjs';

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const { source } = JSON.parse(line);
    const diagram = await zen.diagram(source);
    let parserAst;
    if (diagram.type === 'eventmodeling') {
      const origin = '@mermaid-js/parser public parse: actual Event Modeling frame-label AST projection';
      try {
        const parserRoot = resolve(process.argv[2], 'node_modules/@mermaid-js/parser');
        const metadata = JSON.parse(readFileSync(resolve(parserRoot, 'package.json'), 'utf8'));
        const entry = metadata.exports?.['.']?.import;
        if (typeof entry !== 'string') throw Error('The admitted parser has no public ESM entry');
        const { parse } = await import(pathToFileURL(resolve(parserRoot, entry)).href);
        const ast = await parse('eventmodeling', source);
        parserAst = { origin, value: { frames: ast.frames.map(frame => ({ entityIdentifier: frame.entityIdentifier })) } };
      } catch (error) { parserAst = { origin, error: String(error?.message ?? error) }; }
    }
    writeSync(1, wire({ ok: true, type: diagram.type, ...(diagram.type === 'zenuml' ? { parserIdentity: zen.identity, parserAst: { origin: zen.identity.parser, unavailable: 'The public parse API returns pass/errorDetails, not an AST' }, renderedLabels: await zen.renderedLabels(diagram.text) } : parserAst ? { parserAst } : {}), snapshot: snapshot(diagram.db, diagram.type === 'gantt') }));
  } catch (error) {
    writeSync(1, wire({ ok: false, error: String(error?.message ?? error).slice(0, 3000) }));
  }
}
dom.window.close();
