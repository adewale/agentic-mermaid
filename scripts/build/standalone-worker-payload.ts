import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'acorn'
import { brotliCompressSync, brotliDecompressSync, constants, gzipSync } from 'node:zlib'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const budgetPath = realpathSync(new URL('../../src/browser-standalone-budget.ts', import.meta.url))
const binding = '__amStandaloneCodecBudget'

function parseCodecSource(source: string, path: string): ts.SourceFile {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
  if (!Array.isArray(diagnostics) || diagnostics.length) throw new Error(`Standalone codec has parse diagnostics: ${path}`)
  return file
}

function crc32(bytes: Uint8Array): number {
  const gzip = gzipSync(bytes, { level: 0 })
  return gzip.readUInt32LE(gzip.length - 8)
}

export function packStandaloneWorker(source: string): { encoded: string; define: Record<string, string>; workerBytes: number; packedBytes: number } {
  const bytes = Buffer.from(source, 'utf8')
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Standalone worker exceeds the 8 MiB decoded limit')
  const packed = brotliCompressSync(bytes, { params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    [constants.BROTLI_PARAM_LGWIN]: 22,
  } })
  if (packed.length > 4 * 1024 * 1024 || !brotliDecompressSync(packed).equals(bytes)) {
    throw new Error('Standalone worker packing failed its complete byte comparison')
  }
  return { encoded: packed.toString('base64'), workerBytes: bytes.length, packedBytes: packed.length, define: {
    AM_STANDALONE_PACKED_LENGTH: String(packed.length),
    AM_STANDALONE_PACKED_CRC32: String(crc32(packed)),
    AM_STANDALONE_WORKER_LENGTH: String(bytes.length),
    AM_STANDALONE_WORKER_CRC32: String(crc32(bytes)),
  } }
}

/** Instrument original dependency loop bodies before bundling/minification.
 * Source edits preserve directives, comments, labels and continue targets. */
export function boundStandaloneCodec(source: string, path: string, decoder: boolean): string {
  const file = parseCodecSource(source, path)
  const edits: Array<{ start: number; end: number; text: string }> = []
  let output = 0, growth = 0, windows = 0, directiveEnd = 0
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break
    directiveEnd = statement.end
  }
  const insert = (start: number, text: string): void => { edits.push({ start, end: start, text }) }
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === binding) throw new Error('Standalone codec budget binding collision')
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      const body = node.statement
      if (ts.isBlock(body)) insert(body.getStart(file) + 1, `${binding}.chargeCodecLoop();`)
      else {
        insert(body.getStart(file), `{${binding}.chargeCodecLoop();`)
        insert(body.end, '}')
      }
    }
    if (decoder && ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Uint8Array' && node.arguments?.length === 1) {
      const argument = node.arguments[0]!, text = argument.getText(file)
      if (text === 'output_size' || text === 'pos + meta_block_remaining_len') {
        if (text === 'output_size') output++; else growth++
        insert(argument.getStart(file), `${binding}.limitCodecOutput(`)
        insert(argument.end, ')')
      }
    }
    if (decoder && ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
      const expression = node.expression
      if (expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && expression.left.getText(file) === 'window_bits'
        && ts.isCallExpression(expression.right) && expression.right.expression.getText(file) === 'DecodeWindowBits'
        && expression.right.arguments.length === 1 && expression.right.arguments[0]!.getText(file) === 'br') {
        windows++
        insert(node.end, `${binding}.limitCodecWindow(window_bits);`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (decoder && (output !== 1 || growth !== 1 || windows !== 1)) throw new Error('Pinned Brotli decoder allocation shape changed')
  insert(directiveEnd, `\nconst ${binding}=require('am-standalone-codec-budget');\n`)
  let result = source
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  parseCodecSource(result, path)
  return result
}

export function standaloneCodecPlugin(): Bun.BunPlugin {
  const brotliRoot = dirname(require.resolve('brotli/package.json'))
  const brotliRequire = createRequire(join(brotliRoot, 'package.json'))
  const base64Root = dirname(brotliRequire.resolve('base64-js/package.json'))
  const upngRequire = createRequire(require.resolve('upng-js/package.json'))
  const crcPath = realpathSync(upngRequire.resolve('pako/lib/zlib/crc32.js'))
  const pakoRoot = dirname(dirname(dirname(crcPath)))
  for (const [root, version] of [[brotliRoot, '1.3.3'], [base64Root, '1.5.1'], [pakoRoot, '1.0.11']] as const) {
    if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version !== version) throw new Error(`Standalone codec requires pinned ${root}@${version}`)
  }
  const decoderPath = realpathSync(join(brotliRoot, 'dec/decode.js'))
  const base64Path = realpathSync(join(base64Root, 'index.js'))
  const dictionaryPath = realpathSync(join(brotliRoot, 'dec/dictionary-browser.js'))
  return {
    name: 'bounded-standalone-codec',
    setup(build) {
      build.onResolve({ filter: /^am-standalone-codec-budget$/ }, () => ({ path: budgetPath }))
      build.onResolve({ filter: /^am-standalone-(?:brotli|crc32)$/ }, args => ({ path: args.path, namespace: 'standalone-codec' }))
      build.onLoad({ filter: /.*/, namespace: 'standalone-codec' }, args => ({
        contents: args.path === 'am-standalone-brotli'
          ? `module.exports=function(input,expected){return require(${JSON.stringify(join(brotliRoot, 'decompress.js'))})(input,expected)}`
          : `module.exports=function(crc,bytes,len,pos){return require(${JSON.stringify(crcPath)})(crc,bytes,len,pos)}`,
        loader: 'js', resolveDir: brotliRoot,
      }))
      build.onResolve({ filter: /dictionary-data(?:\.js)?$/ }, args => {
        if (realpathSync(join(args.resolveDir, args.path.endsWith('.js') ? args.path : `${args.path}.js`)) !== realpathSync(join(brotliRoot, 'dec/dictionary-data.js'))) return undefined
        return { path: dictionaryPath }
      })
      build.onResolve({ filter: /^base64-js$/ }, args => args.importer.startsWith(brotliRoot) ? { path: base64Path } : undefined)
      build.onLoad({ filter: /\.js$/ }, args => {
        const path = realpathSync(args.path)
        if (path !== crcPath && path !== base64Path && !path.startsWith(`${realpathSync(brotliRoot)}/dec/`)) return undefined
        return { contents: boundStandaloneCodec(readFileSync(path, 'utf8'), path, path === decoderPath), loader: 'js', resolveDir: dirname(path) }
      })
    },
  }
}

/** Opaque worker/decoder packing must not hide upstream attribution. */
export function standaloneCodecNotices(): string {
  const brotli = dirname(require.resolve('brotli/package.json'))
  const base64 = dirname(createRequire(join(brotli, 'package.json')).resolve('base64-js/package.json'))
  const pako = dirname(dirname(dirname(createRequire(require.resolve('upng-js/package.json')).resolve('pako/lib/zlib/crc32.js'))))
  const header = readFileSync(join(pako, 'lib/zlib/crc32.js'), 'utf8').match(/\/\/ \(C\) 1995[\s\S]*?\/\/ 3\.[^\n]*(?:\n|$)/)?.[0]
  if (!header) throw new Error('Pinned Pako CRC attribution missing')
  return [
    'Agentic Mermaid modifies the bundled decoder, base64 and CRC sources by adding loop-budget, output-allocation and window guards; the compressed format is unchanged.',
    'Brotli.js 1.3.3 — package/README declare MIT; author Devon Govett. No upstream LICENSE file is supplied. MIT terms are reproduced below without an invented copyright year.',
    readFileSync(new URL('../../LICENSES/Brotli-MIT.txt', import.meta.url), 'utf8'),
    'Brotli decoder: Copyright 2013 Google Inc. All Rights Reserved. Licensed under Apache License, Version 2.0.',
    readFileSync(new URL('../../LICENSES/Apache-2.0.txt', import.meta.url), 'utf8'),
    'base64-js 1.5.1:', readFileSync(join(base64, 'LICENSE'), 'utf8'),
    'Pako 1.0.11 (MIT AND Zlib):', readFileSync(join(pako, 'LICENSE'), 'utf8'), header,
  ].join('\n\n').replace(/<\//g, '<\\/')
}

export function standaloneWorkerNotices(source: string, inputs: readonly string[], workingDirectory: string): string {
  if (inputs.length > 10_000) throw new Error('Standalone worker notice input limit exceeded')
  const notices = new Set<string>()
  let noticeBytes = 0
  const add = (text: string): void => {
    if (notices.has(text)) return
    noticeBytes += Buffer.byteLength(text)
    if (noticeBytes > 16 * 1024 * 1024) throw new Error('Standalone worker notice byte limit exceeded')
    notices.add(text)
  }
  const readNotice = (path: string): string => {
    if (statSync(path).size > 1024 * 1024) throw new Error(`Standalone license file exceeds 1 MiB: ${path}`)
    return readFileSync(path, 'utf8')
  }
  const comments = (text: string): void => {
    parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true,
      onComment(_block, _text, start, end) {
        const comment = text.slice(start, end)
        if (/^\/\*!|@license|@preserve|copyright|licensed under/i.test(comment)) add(comment)
      },
    })
  }
  comments(source)
  const root = realpathSync(fileURLToPath(new URL('../..', import.meta.url)))
  const packages = new Set<string>()
  for (const input of inputs) {
    const path = realpathSync(resolve(workingDirectory, input))
    if (path.startsWith(`${root}/`)) continue
    if (/\.[cm]?js$/.test(path)) {
      if (statSync(path).size > 16 * 1024 * 1024) throw new Error(`Standalone notice source exceeds 16 MiB: ${input}`)
      comments(readFileSync(path, 'utf8'))
    }
    let directory = dirname(path)
    for (let ancestors = 0; ; ancestors++) {
      if (ancestors >= 64) throw new Error(`Standalone package ancestry limit exceeded: ${input}`)
      const manifest = join(directory, 'package.json')
      if (existsSync(manifest)) {
        const metadata = JSON.parse(readNotice(manifest)) as { name?: string; version?: string }
        if (metadata.name && metadata.version) { packages.add(directory); break }
      }
      const parent = dirname(directory)
      if (parent === directory) throw new Error(`Standalone worker input has no package origin: ${input}`)
      directory = parent
    }
  }
  if (packages.size > 128) throw new Error('Standalone dependency notice package limit exceeded')
  for (const directory of [...packages].sort()) {
    const manifest = JSON.parse(readNotice(join(directory, 'package.json'))) as { name: string; version: string; license?: string }
    const files = readdirSync(directory).filter(name => /^(?:licen[cs]e|copying|notice|copyright)(?:[.-].*)?$/i.test(name) && statSync(join(directory, name)).isFile()).sort()
    if (files.length > 64) throw new Error(`Standalone dependency notice file limit exceeded: ${manifest.name}`)
    if (!files.length) throw new Error(`Standalone worker dependency has no license notice: ${manifest.name}`)
    add(`${manifest.name}@${manifest.version} (${manifest.license ?? 'see terms below'})`)
    for (const name of files) add(readNotice(join(directory, name)))
  }
  // Maintained source adaptations (Pele, Mermaid, icons and pinned config)
  // are part of our source tree rather than separate bundler package roots.
  add(readNotice(join(root, 'LICENSE')))
  add(readNotice(join(root, 'THIRD_PARTY_NOTICES.md')))
  for (const name of readdirSync(join(root, 'LICENSES')).sort()) {
    if (statSync(join(root, 'LICENSES', name)).isFile()) add(readNotice(join(root, 'LICENSES', name)))
  }
  return [...notices].join('\n\n').replace(/<\//g, '<\\/')
}
