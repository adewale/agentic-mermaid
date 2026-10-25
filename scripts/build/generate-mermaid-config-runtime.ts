/** Rebuild the synchronous config compatibility program from the policy pin.
 * Runtime code imports no Mermaid parser, renderer, DOM or Node module.
 * Run reference:mermaid first; the independent reference supplies its actual
 * initialized defaults, including undefined keys and JS font accessors. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { parse } from 'acorn'

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
const mergeEntry = `
import assign from ${JSON.stringify(join(src, 'assignWithDepth.ts'))};
import {sanitizeDirective} from ${JSON.stringify(join(src, 'utils/sanitizeDirective.ts'))};
import {merge} from ${JSON.stringify(join(reference, 'node_modules/es-toolkit/dist/compat/object/merge.mjs'))};
// Native display keeps authored strings that the pin neutralizes. Structural
// removal, null handling and type assignment still belong to the actual policy.
function restoreText(raw,clean){
 if(!raw||!clean||typeof raw!=='object'||typeof clean!=='object')return;
 for(const key of Object.keys(clean)){
  if(typeof raw[key]==='string'&&typeof clean[key]==='string')clean[key]=raw[key];
  else restoreText(raw[key],clean[key]);
 }
}
export function mergeConfig(frontmatter,directives,diagramType,wrap=false,preserveText=false){
 let result={};
 if(directives.length>1){const args=structuredClone(directives);sanitizeDirective(args);if(preserveText)restoreText(directives,args);result=assign(result,args);}
 else if(directives.length)result=structuredClone(directives[0]);
 if(result&&result.config!==undefined){result[diagramType==='flowchart-v2'?'flowchart':diagramType]=result.config;delete result.config;}
 result=result??{};
 if(wrap)result.wrap=true;
 return merge({},structuredClone(frontmatter),result??{});
}
`
const runtimeEntry = mergeEntry + `
import * as config from ${JSON.stringify(join(src, 'config.ts'))};
export function validateConfig(frontmatter,directives,diagramType,metadata={},wrap=false){
 const prepared=structuredClone(frontmatter);
 // frontmatter.ts coerces truthy metadata before preprocess.ts injects it.
 if(metadata.title)metadata.title.toString();
 if(metadata.displayMode){const mode=metadata.displayMode.toString();if(!prepared.gantt)prepared.gantt={};prepared.gantt.displayMode=mode;}
 const combined=mergeConfig(prepared,directives,diagramType,wrap);
 config.reset();config.saveConfigFromInitialize({});config.setSiteConfig({});
 try{config.setDiagramConfigScope(diagramType);config.addDirective(combined);}
 finally{try{config.setDiagramConfigScope(undefined);}finally{config.reset();}}
}
`
const output = join(root, 'src/shared/pinned-mermaid-config')
await mkdir(output, { recursive: true })
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
