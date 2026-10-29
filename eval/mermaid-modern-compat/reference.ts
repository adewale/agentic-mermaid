import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

/** One JSON request line to a reference worker. JSON leaves U+2028/U+2029
 * raw, and Node 24's readline (unlike Node 22's) ends a line at either, so a
 * source holding one would reach the worker split in two. */
export const wireLine = (value: unknown): string =>
  JSON.stringify(value).replace(/[\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16)}`) + '\n'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type ReferenceReply = { ok: false; error: string } | { ok: true; type: string; parserIdentity?: Record<string, string>; parserAst?: { origin: string; value?: Json; error?: string; unavailable?: string }; renderedLabels?: { kind: 'rendered-svg-text'; origin: string; limitations: string; labels?: Array<{ path: string; text: string }>; error?: string }; snapshot: { data: Record<string, Json>; errors: Record<string, string> } }

export interface ReferenceProvenance {
  version: string
  commit: string
  tags: string[]
  parserVersion: string
  domVersion: string
}

export const currentReferencePin = (JSON.parse(readFileSync(new URL('../../docs/project/upstream-mermaid-policy.json', import.meta.url), 'utf8')) as { pin: { version: string; commit: string } }).pin

export function admitCurrentReference(upstream: string, referenceDir: string): ReferenceProvenance {
  const reference = admitModernReference(upstream, referenceDir)
  if (reference.version !== currentReferencePin.version || reference.commit !== currentReferencePin.commit) {
    throw new Error(`Reviewed assertions require Mermaid ${currentReferencePin.version} at ${currentReferencePin.commit}`)
  }
  return reference
}

export function admitModernReference(upstream: string, referenceDir: string): ReferenceProvenance {
  const require = createRequire(join(referenceDir, 'package.json'))
  const installed = JSON.parse(readFileSync(require.resolve('mermaid/package.json'), 'utf8')) as { version: string }
  const mermaidRequire = createRequire(require.resolve('mermaid/package.json'))
  const parserPath = mermaidRequire.resolve
    .paths('@mermaid-js/parser')
    ?.map(directory => join(directory, '@mermaid-js/parser/package.json'))
    .find(existsSync)
  if (!parserPath) throw new Error('The independent Mermaid reference must install its @mermaid-js/parser dependency')
  const parser = JSON.parse(readFileSync(parserPath, 'utf8')) as { version: string }
  const sourceParser = JSON.parse(readFileSync(join(upstream, 'packages/parser/package.json'), 'utf8')) as { version: string }
  const dom = JSON.parse(readFileSync(require.resolve('jsdom/package.json'), 'utf8')) as { version: string }
  const source = JSON.parse(readFileSync(join(upstream, 'packages/mermaid/package.json'), 'utf8')) as { version: string }
  if (Number(installed.version.split('.')[0]) < 12 || source.version !== installed.version) {
    throw new Error(`Use matching Mermaid >=12: source=${source.version}, installed=${installed.version}`)
  }
  if (sourceParser.version !== parser.version) {
    throw new Error(`Use matching @mermaid-js/parser source and installed reference: source=${sourceParser.version}, installed=${parser.version}`)
  }
  const git = (...args: string[]): string => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' }).trim()
  const commit = git('rev-parse', 'HEAD')
  const tags = git('tag', '--points-at', 'HEAD').split('\n').filter(Boolean)
  if (!tags.includes(`mermaid@${installed.version}`)) throw new Error(`The source checkout must be at release tag mermaid@${installed.version}`)
  if (git('status', '--porcelain')) throw new Error('The Mermaid source checkout must be clean to bind the corpus to its recorded commit')
  return { version: installed.version, commit, tags, parserVersion: parser.version, domVersion: dom.version }
}

/** One independent Node/jsdom process; no sanitizer shim or runtime dependency bump. */
export function startModernReference(referenceDir: string): { parse(source: string): Promise<ReferenceReply>; close(): void } {
  const child = spawn('node', [join(dirname(fileURLToPath(import.meta.url)), 'reference-worker.mjs'), referenceDir], { stdio: ['pipe', 'pipe', 'pipe'] })
  const pending: Array<{ resolve(value: ReferenceReply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }> = []
  let stderr = ''
  let stopped: Error | undefined
  function stop(error: Error): void {
    stopped ??= error
    for (const request of pending.splice(0)) {
      clearTimeout(request.timer)
      request.reject(stopped)
    }
  }
  child.stderr.on('data', chunk => {
    stderr = (stderr + String(chunk)).slice(-4000)
  })
  child.on('error', error => stop(error))
  child.stdin.on('error', error => stop(error))
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
    const prefix = '\u0001modern-mermaid\u0001'
    if (!line.startsWith(prefix)) return
    const request = pending.shift()
    if (!request) return
    clearTimeout(request.timer)
    try {
      request.resolve(JSON.parse(line.slice(prefix.length)) as ReferenceReply)
    } catch (error) {
      request.reject(error as Error)
    }
  })
  child.on('exit', code => {
    stop(new Error(`Reference exited ${code}: ${stderr}`))
  })
  return {
    parse(source) {
      if (stopped) return Promise.reject(stopped)
      return new Promise((resolveReply, reject) => {
        const timer = setTimeout(() => {
          stop(new Error(`Reference timeout after 30s: ${source.slice(0, 80)}`))
          child.kill()
        }, 30_000)
        pending.push({ resolve: resolveReply, reject, timer })
        child.stdin.write(wireLine({ source }))
      })
    },
    close() {
      stop(new Error('Reference closed'))
      child.stdin.end()
      child.kill()
    },
  }
}
