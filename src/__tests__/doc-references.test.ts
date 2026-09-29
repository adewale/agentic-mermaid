// A doc that names a file, a link target, or a package script makes a claim the
// repository can check. This test holds every maintained doc, outside generated
// blocks, to three rules:
//
// - a relative Markdown link resolves to a file or directory;
// - a backticked repository path exists: a token that starts with a tracked
//   top-level directory (`src/…`, `scripts/…`, `.github/…`), or a `./`/`../`
//   file name, resolved from the repository root or from the doc's own
//   directory, and an all-caps root document name such as `TODO.md`; and
// - `bun run <script>` / `npm run <script>` names a package.json script.
//
// Paths and links into gitignored build output (website/public) are skipped, as
// are placeholders (`<file>`, `…`, `*`, `{a,b}`). Fenced code is read for paths
// only when it is shell; other fences hold example output. A doc that names a
// path on purpose although it does not exist here lists it in NAMED_BUT_ABSENT.
//
// Backticked code symbols (UPPER_SNAKE constants, `camelCase(` calls) are not
// checked: measured over the maintained docs, every one missing from the code
// was a JavaScript builtin, a third-party or upstream API, an illustration, a
// name a plan proposes, or history.

import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, normalize, relative } from 'node:path'
import { handMaintainedText, maintainedMarkdownFiles, REPO_ROOT } from './helpers/maintained-docs.ts'

const TRACKED = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
const TOP_LEVEL_DIRS = [...new Set(TRACKED.filter(path => path.includes('/')).map(path => path.split('/')[0]!))]
const TRACKED_NAMES = new Set(TRACKED.map(path => basename(path)))
const SCRIPTS = new Set(Object.keys((JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts))

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const REPO_PATH = new RegExp(`^(?:${TOP_LEVEL_DIRS.map(escapeRegExp).join('|')})/`)
/** `./x.md`, `../y.ts`; without an extension, `./agent` is as likely a package subpath. */
const RELATIVE_FILE = /^\.{1,2}\/.*\.[A-Za-z0-9]+$/
const ROOT_DOC = /^[A-Z][A-Z0-9_]*\.md$/
const PLACEHOLDER = /[<>…*{}$?|]|\.\.\./
const SHELL_FENCES = new Set(['bash', 'sh', 'shell', 'zsh', 'console'])

/**
 * Paths a doc names on purpose although they do not exist in this checkout,
 * with the reason. An entry that stops matching fails too.
 */
const NAMED_BUT_ABSENT: Readonly<Record<string, string>> = {
  'AGENTS.md': 'the file `am init-agent` writes into a consumer repository',
  'eval/website-payload/baseline.json': 'lessons-learned records the baseline that #357 deleted',
  'src/__tests__/gantt.test.ts': 'a path on the upstream phase1-charts branch, cited as prior art in the Gantt design note',
  'website/source/mcp-registry/server.json': 'the stateless-MCP plan records this copy as removed',
}

interface Reference { line: number; kind: 'link' | 'path' | 'script'; target: string }

/** Hand-maintained text split into prose and shell fences, each keeping its line numbers. */
function regions(markdown: string): { prose: string; shell: string } {
  const prose: string[] = []
  const shell: string[] = []
  let fence: { marker: string; shell: boolean } | undefined
  for (const line of markdown.split('\n')) {
    const open = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(line)
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1]
    const inside = fence !== undefined && !(close && close[0] === fence.marker[0] && close.length >= fence.marker.length)
    prose.push(fence === undefined && !open ? line : '')
    shell.push(inside && fence!.shell ? line : '')
    if (fence === undefined && open) fence = { marker: open[1]!, shell: SHELL_FENCES.has(open[2]!.toLowerCase()) }
    else if (!inside) fence = undefined
  }
  return { prose: prose.join('\n'), shell: shell.join('\n') }
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length

/** Inline code spans, matched within one paragraph so an unclosed backtick cannot run on. */
function codeSpans(prose: string): { index: number; length: number; text: string }[] {
  const spans: { index: number; length: number; text: string }[] = []
  let offset = 0
  for (const paragraph of prose.split(/(\n\s*\n)/)) {
    for (const match of paragraph.matchAll(/(`+)([^`][\s\S]*?)\1(?!`)/g)) spans.push({ index: offset + match.index, length: match[0].length, text: match[2]! })
    offset += paragraph.length
  }
  return spans
}

/** Path-shaped tokens in a span or shell line: repository paths, `./` paths, and root documents. */
function pathTokens(text: string): string[] {
  return text.split(/[\s,;()[\]'"=`]+/)
    .map(token => token.replace(/[.:]+$/, '').replace(/#.*$/, '').replace(/:\d+(?:[-:]\d+)*$/, ''))
    .filter(token => (REPO_PATH.test(token) || RELATIVE_FILE.test(token) || ROOT_DOC.test(token)) && !PLACEHOLDER.test(token))
}

/** Every link, path, and script the doc names, with its line. */
export function docReferences(markdown: string): Reference[] {
  const all = handMaintainedText(markdown)
  const { prose, shell } = regions(all)
  const references: Reference[] = []
  const spans = codeSpans(prose)
  // Link syntax inside a code span is code, not a link.
  let linkText = prose
  for (const span of spans) linkText = linkText.slice(0, span.index) + ' '.repeat(span.length) + linkText.slice(span.index + span.length)
  for (const match of linkText.matchAll(/\]\(\s*<?([^)\s>]+)>?[^)]*\)|^[ \t]*\[(?!\^)[^\]]+\]:\s*<?([^\s>]+)/gm)) {
    references.push({ line: lineAt(prose, match.index), kind: 'link', target: (match[1] ?? match[2])! })
  }
  for (const span of spans) for (const target of pathTokens(span.text)) references.push({ line: lineAt(prose, span.index), kind: 'path', target })
  for (const match of shell.matchAll(/^.*\S.*$/gm)) for (const target of pathTokens(match[0])) references.push({ line: lineAt(shell, match.index), kind: 'path', target })
  for (const match of all.matchAll(/\b(?:bun|npm) run ([^\s`'")|;&]+)/g)) {
    const script = match[1]!.replace(/[.,:;]+$/, '')
    if (/^[<-]/.test(script) || /[/.*]/.test(script)) continue // a file, flag, or placeholder
    references.push({ line: lineAt(all, match.index), kind: 'script', target: script })
  }
  return references
}

/** Directory patterns such as `website/public/` match only the slash form. */
const gitignored = (path: string): boolean => {
  try {
    execFileSync('git', ['check-ignore', '--no-index', path, `${path}/`], { cwd: REPO_ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** The references in a doc that do not resolve, as `file:line kind target`. */
export function brokenReferences(file: string, markdown: string): string[] {
  const directory = join(REPO_ROOT, dirname(file))
  const resolves = (reference: Reference): boolean => {
    if (reference.kind === 'script') return SCRIPTS.has(reference.target)
    if (reference.kind === 'path' && ROOT_DOC.test(reference.target)) {
      return TRACKED_NAMES.has(reference.target) || reference.target in NAMED_BUT_ABSENT
    }
    let target = reference.target.split(/[#?]/)[0]!
    if (reference.kind === 'link') {
      if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) return true // anchor, URL, site route
      target = decodeURIComponent(target)
    }
    const candidates = reference.kind === 'link' ? [join(directory, target)] : [join(REPO_ROOT, target), join(directory, target)]
    if (candidates.some(candidate => existsSync(candidate))) return true
    if (reference.kind === 'path' && target in NAMED_BUT_ABSENT) return true
    return candidates.some(candidate => gitignored(relative(REPO_ROOT, normalize(candidate))))
  }
  return docReferences(markdown).filter(reference => !resolves(reference)).map(reference => `${file}:${reference.line} ${reference.kind} ${reference.target}`)
}

describe('doc references', () => {
  const docs = maintainedMarkdownFiles().map(file => ({ file, markdown: readFileSync(join(REPO_ROOT, file), 'utf8') }))

  test('every link, repository path, and package script in a maintained doc exists', () => {
    expect(docs.flatMap(({ file, markdown }) => brokenReferences(file, markdown))).toEqual([])
  })

  test('every NAMED_BUT_ABSENT entry is still named and still absent', () => {
    const named = new Set(docs.flatMap(({ markdown }) => docReferences(markdown).filter(reference => reference.kind === 'path').map(reference => reference.target)))
    expect(Object.keys(NAMED_BUT_ABSENT).filter(path => !named.has(path) || existsSync(join(REPO_ROOT, path)))).toEqual([])
  })

  test('the checks read a real volume of references', () => {
    const counts = { link: 0, path: 0, script: 0 }
    for (const { markdown } of docs) for (const reference of docReferences(markdown)) counts[reference.kind]++
    expect(counts.link).toBeGreaterThan(200)
    expect(counts.path).toBeGreaterThan(300)
    expect(counts.script).toBeGreaterThan(50)
  })

  test('reports a broken link, path, root document, and script; skips URLs, anchors, placeholders, and ignored output', () => {
    const doc = [
      'See [the guide](./no-such-guide.md), [features](./features.md#tiers), [site](https://example.com), and [top](#top).',
      'Code lives in `src/no-such-dir/x.ts:12-40` and `src/agent/types.ts:10`; run `bun run no-such-script` or `npm run test`.',
      'Read `ROADMAP.md`, `README.md`, and `SKILL.md`; placeholders `src/<family>.ts`, `docs/…`, `src/**/*.ts` are fine.',
      'Build output `website/public/index.html` and `website/public` are gitignored, and `[x](missing.md)` in code is not a link.',
      '',
      '[ref]: ../no-such-ref.md',
      '',
      '```bash',
      'bun run scripts/no-such-script.ts && bun run doc-blocks',
      '```',
      '',
      '```text',
      'scripts/example-output-path.ts',
      '```',
    ].join('\n')
    expect(brokenReferences('docs/doc.md', doc)).toEqual([
      'docs/doc.md:1 link ./no-such-guide.md',
      'docs/doc.md:6 link ../no-such-ref.md',
      'docs/doc.md:2 path src/no-such-dir/x.ts',
      'docs/doc.md:3 path ROADMAP.md',
      'docs/doc.md:9 path scripts/no-such-script.ts',
      'docs/doc.md:2 script no-such-script',
    ])
    expect(brokenReferences('docs/doc.md', 'Generated: <!-- BEGIN GENERATED: x -->`src/gone.ts`<!-- END GENERATED: x -->')).toEqual([])
  })
})
