// Reference-only observation of the installed, admitted Mermaid release.
// It never imports Agentic parsers or claims that their token/action hooks exist.
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { readFileSync, readdirSync, writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { build } from 'esbuild';
import { createZenUMLReference } from './zenuml-reference.mjs';

const referenceDir = resolve(process.argv[2]);
const upstreamDir = resolve(process.argv[3]);
const requireReference = createRequire(join(referenceDir, 'package.json'));
const { JSDOM } = requireReference('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option', 'location', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
console.log = console.info = console.debug = console.warn = console.error = () => {};

// Export actual private helpers without copying their implementations. The only
// behavior override is family selection in Diagram.fromText: mutations must
// exercise the prepared family's grammar, including a corrupted header. All
// preprocessing, configuration, fresh DB creation, init and parsing stay in the
// release implementation. Nothing is written into the reference installation.
const corePath = requireReference.resolve('mermaid');
const coreUrl = pathToFileURL(corePath).href;
let releaseSource = readFileSync(corePath, 'utf8');
function replaceExactlyOnce(needle, replacement) {
  if (releaseSource.split(needle).length !== 2) throw new Error(`Unsupported Mermaid release instrumentation seam: ${needle}`);
  releaseSource = releaseSource.replace(needle, replacement);
}
replaceExactlyOnce('const type = detectType(code.cleaned, config);', 'const type = selectedGrammarType ?? detectType(code.cleaned, config);');
replaceExactlyOnce('await parser.parse(textToParse);', 'await (grammarObserver ? grammarObserver(type, parser, db2, textToParse, () => parser.parse(textToParse)) : parser.parse(textToParse));');
releaseSource = releaseSource.replace(/(\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])([^"']+)\2/g, (whole, prefix, quote, specifier) => {
  if (specifier.startsWith('node:')) return whole;
  const url = import.meta.resolve(specifier, coreUrl);
  return `${prefix}${quote}${url}${quote}`;
});
releaseSource += `
let selectedGrammarType;
let grammarObserver;
export async function parseSelectedGrammar(fallbackType, text, observe, chooseType) {
  const processed = processAndSetConfigs(text);
  let detected;
  try { detected = detectType(processed.code.cleaned, getConfig()); } catch {}
  const type = chooseType(detected) ?? fallbackType;
  setDiagramConfigScope(type);
  selectedGrammarType = type;
  grammarObserver = observe;
  try { return await Diagram.fromText(processed.code, { title: processed.title }); }
  finally { selectedGrammarType = undefined; grammarObserver = undefined; setDiagramConfigScope(undefined); }
}
export { getDiagram };
`;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(releaseSource).toString('base64')}`);
const mermaid = runtime.default;
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' });
const zen = createZenUMLReference(mermaid, JSON.parse(readFileSync(requireReference.resolve('mermaid/package.json'), 'utf8')).version);
const langium = await import(import.meta.resolve('@mermaid-js/parser', coreUrl));

function plain(value, seen = new Set(), depth = 0) {
  if (typeof value === 'function' || value === undefined) return undefined;
  if (depth > 30) return '<depth-limit>';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  // Authored IDs and labels may resemble generated commit IDs. Preserve their
  // bytes here; the Git semantic adapter normalizes only AST-proven auto IDs.
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '<circular>';
  seen.add(value);
  let result;
  if (value instanceof Map) result = [...value].map(([key, item]) => [plain(key, seen, depth + 1), plain(item, seen, depth + 1)]).sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
  else if (value instanceof Set) result = [...value].map(item => plain(item, seen, depth + 1));
  else if (Array.isArray(value)) result = value.map(item => plain(item, seen, depth + 1) ?? null);
  else {
    result = {};
    for (const key of Object.keys(value).sort()) {
      // Primitive parent IDs are semantic containment. Langium's $refText is
      // an authored reference operand (Radar keyed axes), not a backreference.
      // Other object backreferences use the ordinary cycle handling.
      if ((key.startsWith('$') && key !== '$type' && key !== '$refText') || ['domId', 'config', 'look', 'themeVariables'].includes(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) continue;
      const item = plain(descriptor.value, seen, depth + 1);
      if (item !== undefined) result[key] = item;
    }
  }
  seen.delete(value);
  return result;
}

function methodsOf(object) {
  const names = new Set();
  for (let current = object; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    for (const name of Object.getOwnPropertyNames(current)) if (name !== 'constructor' && typeof object[name] === 'function') names.add(name);
  }
  return [...names];
}

function snapshot(db) {
  const data = {}, errors = {};
  const collect = (target, prefix = '') => {
    for (const name of methodsOf(target).sort()) {
      if (!/^get[A-Z]|^(?:topAxisEnabled|inclusiveEndDates)$/.test(name) || /Config|Logger|DomId|Tooltip|Mapping|Position/.test(name)) continue;
      // C4 exposes complete collections through optional-parent getters.
      // Calling them without a parent returns their actual whole DB value.
      if (target[name].length !== 0 && !['getC4ShapeArray', 'getBoundaries'].includes(name)) continue;
      try {
        const value = target[name]();
        if (value && typeof value.then === 'function') continue;
        const item = plain(value);
        if (item !== undefined) data[prefix + name] = item;
      } catch (error) { errors[prefix + name] = String(error?.message ?? error).slice(0, 500); }
    }
  };
  collect(db);
  if (typeof db.getCommonDb === 'function') collect(db.getCommonDb(), 'getCommonDb.');
  return { data, errors };
}

function filesBelow(directory, suffix) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(path, suffix));
    else if (entry.name.endsWith(suffix)) found.push(relative(upstreamDir, path));
  }
  return found.sort();
}
const jisonSources = filesBelow(join(upstreamDir, 'packages/mermaid/src/diagrams'), '.jison');
const langiumSources = filesBelow(join(upstreamDir, 'packages/parser/src/language'), '.langium');
const normalized = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const sourceFolder = type => ({ 'flowchart-v2': 'flowchart', flowchart: 'flowchart', classDiagram: 'class', 'classDiagram-v2': 'class', stateDiagram: 'state', 'stateDiagram-v2': 'state', swimlane: 'flowchart', journey: 'user-journey', quadrantChart: 'quadrant-chart' })[type] ?? type;
const familyOfType = type => {
  const key = normalized(type);
  if (key.startsWith('flowchart')) return 'flowchart';
  if (key.startsWith('class')) return 'class';
  if (key.startsWith('state')) return 'state';
  if (key.startsWith('railroad')) return 'railroad';
  return ({ quadrantchart: 'quadrant', sequencediagram: 'sequence' })[key] ?? key;
};
const prepared = new Map();
const definitions = new Map();
let sourceSyntax;

async function sourceSyntaxHelpers() {
  if (sourceSyntax) return sourceSyntax;
  const usecase = join(upstreamDir, 'packages/mermaid/src/diagrams/usecase/parser');
  const tree = join(upstreamDir, 'packages/mermaid/src/diagrams/treeView/boxDrawingPreprocessor.ts');
  const result = await build({
    stdin: { contents: `export { usecaseLexer } from ${JSON.stringify(join(usecase, 'usecase.lexer.ts'))}; export { usecaseParser } from ${JSON.stringify(join(usecase, 'usecase.parser.ts'))}; export { preprocessBoxDrawing } from ${JSON.stringify(tree)};`, resolveDir: upstreamDir, sourcefile: 'modern-grammar-source-entry.ts', loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'independent-reference-dependencies', setup(builder) {
      builder.onResolve({ filter: /^[^./]|^@/ }, args => ({ path: import.meta.resolve(args.path, coreUrl), external: true }));
    } }],
  });
  sourceSyntax = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  return sourceSyntax;
}

function jisonParser(parser) {
  return parser?.lexer ? parser : parser?.parser?.lexer ? parser.parser : undefined;
}

async function definition(type, exposedParser) {
  if (definitions.has(type)) return definitions.get(type);
  if (type === 'zenuml') {
    const value = { type, engine: 'zenuml-core', grammarSources: [] };
    definitions.set(type, value);
    return value;
  }
  const parser = jisonParser(exposedParser);
  const factoryName = Object.keys(langium).find(name => name.startsWith('create') && name.endsWith('Services') && normalized(name.slice(6, -8)) === normalized(type));
  let services;
  if (factoryName) {
    const all = langium[factoryName]();
    services = Object.values(all).find(value => value?.parser?.LangiumParser);
  }
  const engine = parser ? 'jison' : services ? 'langium' : type === 'usecase' ? 'chevrotain' : 'unavailable';
  const grammarSources = engine === 'jison'
    ? jisonSources.filter(path => path.split('/diagrams/')[1]?.split('/')[0] === sourceFolder(type))
    : engine === 'langium'
      ? langiumSources.filter(path => normalized(path.split('/language/')[1]?.split('/')[0] ?? '') === normalized(type))
      : engine === 'chevrotain'
        ? ['packages/mermaid/src/diagrams/usecase/parser/usecase.tokens.ts', 'packages/mermaid/src/diagrams/usecase/parser/usecase.parser.ts']
        : [];
  if (type === 'usecase' || type === 'treeView') await sourceSyntaxHelpers();
  const value = { type, engine, grammarSources, services };
  definitions.set(type, value);
  return value;
}

async function prepare(family, source) {
  // Preparation alone may parse a seed twice; assessed inputs execute the real
  // model builder once. Apply config so configured GitGraph seeds can load.
  if (family === 'zenuml') await zen.load();
  const diagram = await zen.diagram(source);
  const value = await definition(diagram.type, diagram.parser);
  const { engine, grammarSources } = value;
  prepared.set(family, value);
  return {
    family, type: value.type, engine, grammarSources,
    ...(engine === 'zenuml-core' ? { parserIdentity: zen.identity } : {}),
    tokenInstrumentation: engine === 'jison' ? 'actual parse lexer.lex stream' : engine === 'langium' ? 'same upstream Langium Lexer.tokenize on prepared input (separate syntax pass)' : engine === 'chevrotain' ? 'pinned upstream Chevrotain lexer on prepared input (separate syntax pass)' : 'unavailable: no exposed reference lexer',
    actionInstrumentation: engine === 'zenuml-core' ? 'unavailable: public ZenUml.parse exposes acceptance/errorDetails only; the Mermaid addon parser is a no-op and is not an action oracle' : engine === 'jison' ? 'actual grammar yy method calls with original return values' : 'actual Mermaid model-population DB method calls; includes internal builder calls',
    astInstrumentation: engine === 'zenuml-core' ? 'unavailable: public ZenUml.parse returns pass/errorDetails, not an AST' : engine === 'langium' ? 'same upstream LangiumParser AST on prepared input (separate syntax pass)' : engine === 'chevrotain' ? 'actual Mermaid DB getAST plus pinned upstream CST parser' : 'unavailable: Jison grammars expose model actions, not a common AST',
  };
}

const unavailable = reason => ({ status: 'unavailable', reason });
const available = (method, value) => ({ status: 'available', method, value });

function tokenItems(lexed) {
  const items = lexed.tokens.map(token => ({ offset: token.startOffset, pair: [token.tokenType.name, token.image] }));
  for (const error of lexed.errors ?? []) items.push({ offset: error.offset, pair: ['INVALID', error.message] });
  return items.sort((a, b) => a.offset - b.offset).map(item => item.pair);
}

async function observe(reference, parser, db, input, run, reply) {
  reply.preparedSource = input;
  const actions = [];
  const restore = [];
  let preprocessingRejection;
  // Timeline's grammar calls into yy.getCommonDb().setDiagramTitle/AccTitle.
  // Observe those actual nested builder calls as well as the yy access itself.
  const commonObservers = new WeakMap();
  const observeCommonDb = common => {
    if (!common || typeof common !== 'object') return common;
    if (commonObservers.has(common)) return commonObservers.get(common);
    const methods = new Map();
    // ESM namespace methods cannot be redefined in place. This observation
    // view delegates to the real module and leaves every return value intact.
    const view = new Proxy(common, { get(target, name) {
      const original = Reflect.get(target, name);
      if (typeof original !== 'function') return original;
      if (!methods.has(name)) methods.set(name, (...args) => {
        actions.push([`getCommonDb.${String(name)}`, ...args.map(value => plain(value) ?? null)]);
        return Reflect.apply(original, target, args);
      });
      return methods.get(name);
    } });
    commonObservers.set(common, view);
    return view;
  };
  const jison = jisonParser(parser);
  if (jison) {
    const oldYy = jison.yy;
    const yy = Object.assign({}, oldYy);
    for (const name of methodsOf(oldYy)) yy[name] = (...args) => {
      const normalizedArgs = args.map(value => plain(value) ?? null);
      while (normalizedArgs.at(-1) === null && args[normalizedArgs.length - 1] === undefined) normalizedArgs.pop();
      actions.push([name, ...normalizedArgs]);
      const value = Reflect.apply(oldYy[name], oldYy, args);
      return name === 'getCommonDb' ? observeCommonDb(value) : value;
    };
    jison.yy = yy;
    restore.push(() => { jison.yy = oldYy; });
    const lexer = jison.lexer, original = lexer.lex, tokens = [];
    let depth = 0;
    lexer.lex = function (...args) {
      const outer = depth++ === 0;
      try {
        const token = Reflect.apply(original, this, args);
        if (outer) tokens.push([token === 1 ? '$end' : jison.terminals_?.[token] ?? String(token), this.yytext]);
        return token;
      } catch (error) {
        if (outer) tokens.push(['INVALID', this.yytext]);
        throw error;
      } finally { depth--; }
    };
    restore.push(() => { lexer.lex = original; });
    reply.tokens = available('actual Jison lexer.lex calls consumed by this parse; skipped tokens omitted', tokens);
    reply.actions = available('actual grammar yy calls; real DB return values retained', actions);
  } else {
    const failed = [];
    for (const name of methodsOf(db)) {
      const descriptor = Object.getOwnPropertyDescriptor(db, name), original = db[name];
      try {
        Object.defineProperty(db, name, { configurable: true, enumerable: descriptor?.enumerable ?? true, writable: true, value(...args) {
          actions.push([name, ...args.map(value => plain(value) ?? null)]);
          const value = Reflect.apply(original, db, args);
          return name === 'getCommonDb' ? observeCommonDb(value) : value;
        } });
        restore.push(() => { if (descriptor) Object.defineProperty(db, name, descriptor); else delete db[name]; });
      } catch { failed.push(name); }
    }
    reply.actions = failed.length ? unavailable(`DB methods could not be observed: ${failed.join(', ')}`) : available('actual Mermaid DB method calls during population, including internal builder calls', actions);
    try {
      let text = input;
      if (reference.type === 'treeView') {
        try { text = sourceSyntax.preprocessBoxDrawing(input).text; }
        catch (error) {
          preprocessingRejection = String(error?.message ?? error);
          const reason = `Upstream TreeView preprocessing rejected input before lexing: ${preprocessingRejection}`;
          reply.tokens = unavailable(reason);
          reply.ast = unavailable(reason);
        }
      }
      if (preprocessingRejection === undefined && reference.services) {
        const lexed = reference.services.parser.Lexer.tokenize(text);
        reply.tokens = available('upstream Langium Lexer.tokenize on the same prepared grammar input; separate syntax-only pass', tokenItems(lexed));
        const parsed = reference.services.parser.LangiumParser.parse(text);
        reply.ast = parsed.lexerErrors.length || parsed.parserErrors.length ? unavailable('Selected Langium grammar rejected the prepared input; tokens remain available') : available('upstream LangiumParser AST; only $ bookkeeping fields removed', plain(parsed.value));
      } else if (reference.type === 'usecase') {
        const lexed = sourceSyntax.usecaseLexer.tokenize(text);
        reply.tokens = available('pinned source usecase Chevrotain lexer; separate syntax-only pass', tokenItems(lexed));
        sourceSyntax.usecaseParser.input = lexed.tokens;
        sourceSyntax.usecaseParser.start();
        if (lexed.errors.length || sourceSyntax.usecaseParser.errors.length) reply.ast = unavailable('Selected Chevrotain grammar rejected the prepared input; tokens remain available');
      }
    } catch (error) { (reply.instrumentationErrors ??= []).push(String(error?.message ?? error)); }
  }
  try {
    const result = await run();
    if (preprocessingRejection !== undefined) (reply.instrumentationErrors ??= []).push(`Syntax-only TreeView preprocessing rejected input but the actual parser accepted it: ${preprocessingRejection}`);
    return result;
  }
  catch (error) {
    // The source helper is an observation pass, so only the actual release
    // parser decides acceptance. A matching rejection is ordinary invalid
    // input; a disagreement remains an instrumentation failure.
    if (preprocessingRejection !== undefined && String(error?.message ?? error) !== preprocessingRejection) {
      (reply.instrumentationErrors ??= []).push(`Syntax-only TreeView preprocessing disagreed with the actual parser: ${preprocessingRejection}`);
    }
    throw error;
  }
  finally {
    for (const undo of restore.reverse()) undo();
    if (reference.type === 'usecase' && typeof db.getAST === 'function') {
      const ast = db.getAST();
      if (ast) reply.ast = available('actual usecase grammar visitor AST from DB.getAST()', plain(ast));
    }
  }
}

async function parse({ family, source, unobserved = false }) {
  const reference = prepared.get(family);
  if (!reference) throw new Error(`Call prepare(${family}, validSeed) before parsing this family`);
  const reply = {
    requestedFamily: family, type: reference.type, engine: reference.engine, grammarSources: reference.grammarSources,
    accepted: false,
    tokens: unavailable('The selected parser was not reached, or its lexer is not exposed'),
    actions: unavailable('The selected parser was not reached'),
    ast: unavailable(reference.engine === 'jison' ? 'Jison parser has a yy action interface, not a common AST' : 'No accepted AST observed'),
  };
  if (reference.engine === 'zenuml-core') {
    reply.parserIdentity = zen.identity;
    reply.tokens = unavailable('The public ZenUml.parse API exposes no lexer stream');
    reply.actions = unavailable('The public ZenUml.parse API exposes no builder actions; the Mermaid addon parser is a no-op');
    reply.ast = unavailable('The public ZenUml.parse API returns pass/errorDetails, not an AST');
  }
  try {
    const diagram = await runtime.parseSelectedGrammar(reference.type, source, unobserved ? undefined : async (type, parser, db, input, run) => {
      const selected = await definition(type, parser);
      reply.type = type;
      reply.engine = selected.engine;
      reply.grammarSources = selected.grammarSources;
      if (selected.engine === 'zenuml-core') { reply.preparedSource = input; return run(); }
      return observe(selected, parser, db, input, run, reply);
    }, detected => {
      reply.detectedType = detected;
      // Recognized dialects within one family (notably railroad ABNF/EBNF/PEG)
      // use their actual grammar. Invalid or cross-family mutated headers stay
      // in the prepared grammar instead of changing the subject of the test.
      return detected && familyOfType(detected) === familyOfType(reference.type) ? detected : undefined;
    });
    reply.type = diagram.type;
    if (diagram.type === 'zenuml') {
      // Recognized Zen headers are envelope syntax. A mutated header that
      // remains in the selected input is given to the real core as payload;
      // it cannot bypass validation through the addon's no-op parser.
      reply.preparedSource = zen.payload(reply.preparedSource ?? diagram.text);
      await zen.parsePayload(reply.preparedSource);
    }
    reply.accepted = true;
    reply.snapshot = snapshot(diagram.db);
  } catch (error) { reply.error = String(error?.message ?? error).slice(0, 3000); }
  return reply;
}

// JSON leaves U+2028/U+2029 raw, and the parent's Bun readline ends a line at
// either, so a reply holding one would arrive torn in two.
const wire = value => '\u0001modern-grammar\u0001' + JSON.stringify(value).replace(/[\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16)}`) + '\n';

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let request;
  try {
    request = JSON.parse(line);
    let value;
    if (request.operation === 'prepare') value = await prepare(request.payload.family, request.payload.source);
    else if (request.operation === 'parse') value = await parse(request.payload);
    else if (request.operation === 'parseMany') { value = []; for (const item of request.payload) value.push(await parse(item)); }
    else throw new Error(`Unknown grammar operation ${request.operation}`);
    writeSync(1, wire({ id: request.id, value }));
  } catch (error) {
    writeSync(1, wire({ id: request?.id ?? -1, error: String(error?.stack ?? error) }));
  }
}
