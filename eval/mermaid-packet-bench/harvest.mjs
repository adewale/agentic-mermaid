// Refresh only from the exact reviewed syntax pin. Expectations come from an
// isolated official Mermaid process, never from Agentic Mermaid's parser.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = process.cwd();
const upstream = resolve(process.env.MERMAID_UPSTREAM_DIR ?? '../mermaid');
const reference = resolve(process.env.MERMAID_REFERENCE_DIR ?? '../mermaid-reference');
const pin = '1fb7869866dd619168d840291c9c54b4f129758b';
const head = readFileSync(join(upstream, '.git/HEAD'), 'utf8').trim();
const revision = head.startsWith('ref: ') ? readFileSync(join(upstream, '.git', head.slice(5)), 'utf8').trim() : head;
if (revision !== pin) throw new Error('Upstream checkout does not match Mermaid 12.2.0 pin');

function harvest(family) {
  const paths = [`packages/mermaid/src/diagrams/${family}/${family}.spec.ts`];
  const files = [], cases = [], rendererAccounting = [];
  for (const path of paths) {
    const text = readFileSync(join(upstream, path), 'utf8');
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    let blocks = 0;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'it') {
        blocks++;
        const callback = node.arguments[1];
        let source;
        function find(current) {
          if (ts.isVariableDeclaration(current) && current.name.getText(ast) === 'str' && current.initializer && ts.isStringLiteralLike(current.initializer)) source = current.initializer.text;
          if (ts.isBinaryExpression(current) && current.left.getText(ast) === 'str' && current.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isStringLiteralLike(current.right)) source = current.right.text;
          ts.forEachChild(current, find);
        }
        find(callback);
        if (source === undefined) throw new Error(`Unaccounted test: ${node.arguments[0].getText(ast)}`);
        const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
        cases.push({ id: `${family}-spec-${blocks}`, origin: path, line, upstreamTest: node.arguments[0].text, source, assertions: callback.getText(ast) });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    files.push({ path, sha256: createHash('sha256').update(text).digest('hex'), blocks });
  }
  if (family === 'packet') {
    const path = 'packages/parser/tests/packet.test.ts';
    const text = readFileSync(join(upstream, path), 'utf8');
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'it.each') {
        const table = node.arguments[0];
        for (const [index, literal] of table.elements.entries()) cases.push({ id: `packet-header-${index}`, origin: path, upstreamTest: 'should handle regular packet', source: literal.text, assertions: 'expectNoErrorsOrAlternatives(result); expect(result.value.$type).toBe(Packet.$type)' });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    files.push({ path, sha256: createHash('sha256').update(text).digest('hex'), blocks: 1, tableRows: 8 });
    const rendererPath = 'packages/mermaid/src/diagrams/packet/renderer.spec.ts';
    const rendererText = readFileSync(join(upstream, rendererPath), 'utf8');
    const rendererAst = ts.createSourceFile(rendererPath, rendererText, ts.ScriptTarget.Latest, true);
    const directTests = ['Packet word bit numbering follows the configured direction and single-bit anchors', 'Packet mirrors each word, including partial final words, without changing field widths', 'Packet showBits:false hides numbering while retaining %s word geometry'];
    function rendererVisit(node) {
      if (ts.isCallExpression(node) && (node.expression.getText(rendererAst) === 'it' || ts.isCallExpression(node.expression) && node.expression.expression.getText(rendererAst) === 'it.each')) {
        const name = node.arguments[0].text;
        const each = ts.isCallExpression(node.expression);
        rendererAccounting.push({ origin: rendererPath, line: rendererAst.getLineAndCharacterOfPosition(node.getStart(rendererAst)).line + 1, upstreamTest: name, executions: each ? 2 : 1, assertions: node.arguments[1].getText(rendererAst), status: 'portable-invariants-adapted', nativeTests: name.includes('showBits') || name.includes('no bit numbers') || name.includes('still mirrors') ? [directTests[2]] : name.includes('width') || name.includes('multi-row') || name.includes('part-filled') ? [directTests[1]] : [directTests[0]], implementationSpecific: 'Mermaid DOM selectors, classes and exact pixel constants remain implementation-specific; native tests assert the portable numbering, ordering, inclusive coverage and reflection invariants.' });
      }
      ts.forEachChild(node, rendererVisit);
    }
    rendererVisit(rendererAst);
    if (rendererAccounting.length !== 10) throw new Error('Unaccounted Packet renderer tests');
    files.push({ path: rendererPath, sha256: createHash('sha256').update(rendererText).digest('hex'), blocks: 10, executions: 11, scope: 'renderer-adapter-portable-invariants' });
  }
  // Public rendering fixtures are source inputs; their DOM/byte assertions
  // belong to Mermaid. Our independent geometry invariants cover the metaphor.
  const fixtureDir = join(upstream, 'e2e/diagrams', family);
  const renderingFiles = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.mmd')) {
        const source = readFileSync(path, 'utf8'), origin = relative(upstream, path);
        renderingFiles.push(origin);
        cases.push({ id: `${family}-render-${renderingFiles.length}`, origin, upstreamTest: entry.name, source });
      }
    }
  }
  walk(fixtureDir);
  // Keep each docs fence including the main example, without replacing it by
  // a smaller example that happens to work.
  const doc = `packages/mermaid/src/docs/syntax/${family}.md`;
  let fence = 0;
  for (const match of readFileSync(join(upstream, doc), 'utf8').matchAll(/^```mermaid(?:-example)?[^\n]*\n([\s\S]*?)^```/gm)) cases.push({ id: `${family}-docs-${++fence}`, origin: doc, upstreamTest: `fence ${fence}`, source: match[1] });
  const input = cases.map(({ source }) => JSON.stringify({ source })).join('\n') + '\n';
  const directory = join(root, `eval/mermaid-${family}-bench`);
  mkdirSync(directory, { recursive: true });
  if (process.argv.includes('--inputs')) { writeFileSync(`/tmp/mermaid-${family}-reference-input.jsonl`, input); return; }
  const output = readFileSync(`/tmp/mermaid-${family}-reference-output.jsonl`, 'utf8');
  const replies = output.split('\n').filter(line => line.startsWith('\u0001modern-mermaid\u0001')).map(line => JSON.parse(line.slice('\u0001modern-mermaid\u0001'.length)));
  if (replies.length !== cases.length) throw new Error('Reference did not answer every case');
  cases.forEach((entry, index) => { entry.reference = replies[index]; });
  writeFileSync(join(directory, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
  writeFileSync(join(directory, 'provenance.json'), JSON.stringify({ version: '12.2.0', commit: pin, license: 'MIT', files, rendererAccounting, renderingFiles, docs: doc }, null, 2) + '\n');
  console.log(`${family}: ${cases.length} pinned cases (${files.filter(file => file.scope !== 'renderer-adapter-portable-invariants').reduce((sum, file) => sum + file.blocks, 0)} upstream parser/semantics blocks)`);
}
harvest('packet');
harvest('kanban');
