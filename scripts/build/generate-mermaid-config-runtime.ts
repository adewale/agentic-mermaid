/** Rebuild the synchronous config compatibility program from the policy pin.
 * Runtime code imports no Mermaid parser, renderer, DOM or Node module.
 * Run reference:mermaid first; the independent reference supplies its actual
 * initialized defaults, including undefined keys and JS font accessors. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { parse } from 'acorn'
import ts from 'typescript'

const root = resolve(import.meta.dir, '../..')
const upstream = resolve(process.env.MERMAID_UPSTREAM_DIR ?? join(root, '../mermaid'))
const reference = resolve(process.env.MERMAID_REFERENCE_DIR ?? join(root, '../mermaid-reference'))
const policy = JSON.parse(await readFile(join(root, 'docs/project/upstream-mermaid-policy.json'), 'utf8'))
const revision = (await new Response(Bun.spawn(['git', '-C', upstream, 'rev-parse', 'HEAD'], { stdout: 'pipe' }).stdout).text()).trim()
if (revision !== policy.pin.commit) throw new Error(`Expected policy source ${policy.pin.commit}, found ${revision}`)
const refPackage = JSON.parse(await readFile(join(reference, 'node_modules/mermaid/package.json'), 'utf8'))
if (refPackage.version !== policy.pin.version) throw new Error('Reference version differs from the source policy')

const khromaVersion = JSON.parse(await readFile(join(reference, 'node_modules/khroma/package.json'), 'utf8')).version
const mergeVersion = JSON.parse(await readFile(join(reference, 'node_modules/es-toolkit/package.json'), 'utf8')).version
if (khromaVersion !== '2.1.0' || mergeVersion !== '1.53.0') throw new Error('Config program dependency revision changed; audit before regenerating')

const capture = `
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(${JSON.stringify(join(reference, 'package.json'))});
const {JSDOM}=require('jsdom');const dom=new JSDOM('<html><body></body></html>');
for(const key of ['window','document','navigator','HTMLElement','SVGElement','Element','Node','Option'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
const {default:mermaid}=await import(pathToFileURL(require.resolve('mermaid')).href);
const cfg=mermaid.mermaidAPI.defaultConfig;
function literal(value){
 if(value===undefined)return 'undefined';
 if(typeof value==='function')return '('+value.toString()+')';
 if(Array.isArray(value))return '['+value.map(literal).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).map(([key,entry])=>JSON.stringify(key)+':'+literal(entry)).join(',')+'}';
 return JSON.stringify(value);
}
const keyify=obj=>Object.keys(obj).flatMap(key=>Array.isArray(obj[key])?[]:typeof obj[key]==='object'&&obj[key]!==null?[key,...keyify(obj[key])]:[key]);
process.stdout.write('const config='+literal(cfg)+';export default config;export const configKeys=new Set('+JSON.stringify([...new Set(keyify(cfg))])+');');
`
const captured = Bun.spawn(['node', '--input-type=module', '-e', capture], { stdout: 'pipe', stderr: 'inherit' })
const defaults = await new Response(captured.stdout).text()
if (await captured.exited !== 0) throw new Error('Could not read reference defaults')
const src = join(upstream, 'packages/mermaid/src')
// Copy owned function initializers from trusted pinned TypeScript, avoiding a
// hand-maintained approximation of directive lexing and preprocessing phases.
async function declarations(file: string, names: string[]): Promise<string> {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
  return names.map(name => {
    for (const statement of source.statements) if (ts.isVariableStatement(statement)) {
      for (const item of statement.declarationList.declarations) if (ts.isIdentifier(item.name) && item.name.text === name && item.initializer) return `const ${name}=${item.initializer.getText(source)};`
    }
    throw new Error(`Missing pinned declaration ${name} in ${file}`)
  }).join('\n')
}
async function directiveSelector(file: string, owner: string): Promise<string> {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let selector: string | undefined
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '') === 'detectDirective') selector = node.arguments[1]?.getText(source)
    ts.forEachChild(node, visit)
  }
  for (const statement of source.statements) if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) {
    if (ts.isIdentifier(item.name) && item.name.text === owner && item.initializer) visit(item.initializer)
  }
  if (!selector) throw new Error(`Missing directive selector in ${owner}`)
  return selector
}
const initSelector = await directiveSelector(join(src, 'utils.ts'), 'detectInit')
const wrapSelector = await directiveSelector(join(src, 'preprocess.ts'), 'processDirectives')
const directivePrograms = await declarations(join(src, 'utils.ts'), ['directiveWithoutOpen', 'detectDirective', 'detectInit', 'removeDirectives'])
const directiveRegex = await declarations(join(src, 'diagram-api/regexes.ts'), ['directiveRegex'])
const directivePhase = await declarations(join(src, 'preprocess.ts'), ['processDirectives'])
const mergeEntry = `
import assignWithDepth from ${JSON.stringify(join(src, 'assignWithDepth.ts'))};
import {sanitizeDirective as pinnedSanitize} from ${JSON.stringify(join(src, 'utils/sanitizeDirective.ts'))};
import {merge} from ${JSON.stringify(join(reference, 'node_modules/es-toolkit/dist/compat/object/merge.mjs'))};
const log={debug(){},error(){}};
let activeDiagramType='',preserveStrings=false;
const detectType=()=>activeDiagramType;
function restoreText(raw,clean){
 if(!raw||!clean||typeof raw!=='object'||typeof clean!=='object')return;
 for(const key of Object.keys(clean)){
  if(typeof raw[key]==='string'&&typeof clean[key]==='string')clean[key]=raw[key];
  else restoreText(raw[key],clean[key]);
 }
}
function sanitizeDirective(value){const raw=preserveStrings?structuredClone(value):undefined;pinnedSanitize(value);if(raw)restoreText(raw,value);}
${directiveRegex}
${directivePrograms}
const utils={detectInit,detectDirective};
${directivePhase}
export function configDirective(kind,payload,hasArgs=true){
 if(!/^\\w+$/.test(kind))throw new Error('Invalid directive name');
 if(!hasArgs)return '%%{'+kind+'}%%';
 const json=(Object.is(payload,-0)?'-0':JSON.stringify(payload)).replace(/[&<>#%'\\u2028\\u2029]/g,character=>'\\\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'));
 const code='%%{'+kind+': '+json+'}%%';
 directiveRegex.lastIndex=0;const match=directiveRegex.exec(code);directiveRegex.lastIndex=0;
 const parsed=detectDirective(code,kind);
 if(!match||match[0]!==code||!Object.is(typeof parsed.args,typeof payload))throw new Error('init argument has no complete pinned scalar token');
 return code;
}
export function initDirective(payload){return configDirective('init',payload);}
export function mergeConfigSource(frontmatter,code,diagramType,preserveText=false){
 activeDiagramType=diagramType;preserveStrings=preserveText;
 try{return merge({},structuredClone(frontmatter),processDirectives(code).directive);}
 finally{preserveStrings=false;}
}
export function mergeConfig(frontmatter,directives,diagramType,wrap=false,preserveText=false){
 activeDiagramType=diagramType;preserveStrings=preserveText;
 try{
  const code=directives.map(initDirective).join('\\n')+(wrap?'\\n%%{wrap}%%':'');
  return mergeConfigSource(frontmatter,code,diagramType,preserveText);
 }finally{preserveStrings=false;}
}
`
const runtimeEntry = mergeEntry + `
import * as config from ${JSON.stringify(join(src, 'config.ts'))};
export function validateConfig(frontmatter,directives,diagramType,metadata={},wrap=false){
 return validateConfigSource(frontmatter,directives.map(initDirective).join('\\n')+(wrap?'\\n%%{wrap}%%':''),diagramType,metadata);
}
export function validateConfigSource(frontmatter,code,diagramType,metadata={}){
 const prepared=structuredClone(frontmatter);
 // frontmatter.ts coerces truthy metadata before preprocess.ts injects it.
 if(metadata.title)metadata.title.toString();
 if(metadata.displayMode){const mode=metadata.displayMode.toString();if(!prepared.gantt)prepared.gantt={};prepared.gantt.displayMode=mode;}
 const combined=mergeConfigSource(prepared,code,diagramType);
 config.reset();config.saveConfigFromInitialize({});config.setSiteConfig({});
 try{config.setDiagramConfigScope(diagramType);config.addDirective(combined);}
 finally{try{config.setDiagramConfigScope(undefined);}finally{config.reset();}}
}
`
const output = join(root, 'src/shared/pinned-mermaid-config')
await mkdir(output, { recursive: true })
await writeFile(join(output, 'directive-types.ts'), `// Generated from Mermaid ${policy.pin.version} (${revision}).
// Selectors owned by detectInit and processDirectives. Rebuild with the config generator.
export function isMermaidConfigDirective(raw: string): boolean {
  const kind = /%%\\{\\s*(\\w+)/.exec(raw)?.[1]
  return kind !== undefined && (kind.match(${initSelector}) !== null || kind.match(${wrapSelector}) !== null)
}
`)
const scratch = await mkdtemp(join(tmpdir(), 'mermaid-config-program-'))
try {
  for (const [name, entry] of [['merge', mergeEntry], ['runtime', runtimeEntry]] as const) {
    const entryPath = join(scratch, `${name}.ts`)
    await writeFile(entryPath, entry)
    const result = await Bun.build({
      entrypoints: [entryPath], target: 'browser', minify: true,
      plugins: [{ name: 'pinned-config-program', setup(build) {
        build.onLoad({ filter: /\/defaultConfig\.ts$/ }, () => ({ contents: defaults, loader: 'js' }))
        build.onLoad({ filter: /\/logger\.ts$/ }, () => ({ contents: 'export const log={trace(){},debug(){},info(){},warn(){},error(){},fatal(){}};', loader: 'js' }))
        build.onResolve({ filter: /^khroma$/ }, () => ({ path: join(reference, 'node_modules/khroma/dist/index.js') }))
      } }],
    })
    if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'))
    const program = isolateProgram(await result.outputs[0]!.text())
    const banner = `// Generated from Mermaid ${policy.pin.version} (${revision}), Khroma ${khromaVersion}, es-toolkit ${mergeVersion}.\n// Rebuild: scripts/build/generate-mermaid-config-runtime.ts. MIT notices: LICENSES/{Mermaid,Khroma,es-toolkit}-MIT.txt.\n`
    await writeFile(join(output, `${name}.js`), banner + program)
    console.log(JSON.stringify({ name, bytes: Buffer.byteLength(program), gzip: gzipSync(program).length, brotli: brotliCompressSync(program).length }))
  }
} finally { await rm(scratch, { recursive: true, force: true }) }

/** Every call gets fresh defaults, module state and an execution budget. This
 * makes failures unable to poison any later read/write, including a failure in
 * the pinned cleanup phase. Bound executed loops, not guessed config keys. */
function isolateProgram(bundled: string): string {
  const ast = parse(bundled, { ecmaVersion: 'latest', sourceType: 'module' })
  const edits: { at: number; end?: number; text: string }[] = []
  const exports = new Map<string, string>()
  for (const statement of ast.body) if (statement.type === 'ExportNamedDeclaration') {
    for (const specifier of statement.specifiers) if (specifier.exported.type === 'Identifier' && specifier.local.type === 'Identifier') exports.set(specifier.exported.name, specifier.local.name)
    edits.push({ at: statement.start, end: statement.end, text: '' })
  }
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const node = value as { type?: string; body?: { type: string; start: number; end: number } }
    if (/^(?:ForStatement|ForInStatement|ForOfStatement|WhileStatement|DoWhileStatement)$/.test(node.type ?? '')) {
      const body = node.body!
      edits.push(body.type === 'BlockStatement' ? { at: body.start + 1, text: '__amConfigStep();' } : { at: body.start, text: '{__amConfigStep();' })
      if (body.type !== 'BlockStatement') edits.push({ at: body.end, text: '}' })
    }
    Object.values(value).forEach(visit)
  }
  visit(ast)
  if (!exports.has('mergeConfig')) throw new Error('Missing config merge export')
  let program = bundled
  for (const edit of edits.sort((a, b) => b.at - a.at)) program = program.slice(0, edit.at) + edit.text + program.slice(edit.end ?? edit.at)
  const budget = `let __amConfigSteps=100000;function __amConfigStep(){if(--__amConfigSteps<0){const error=new Error('Configuration validation exceeded 100000 loop steps');error.name='MermaidConfigWorkLimitError';throw error;}}`
  const returned = [...exports].map(([name, local]) => `${name}:${local}`).join(',')
  const facade = [...exports].map(([name]) => `export function ${name}(...args){return __amConfigProgram().${name}(...args);}`).join('\n')
  return `function __amConfigProgram(){${budget}\n${program}\nreturn {${returned}};}\n${facade}\n`
}
