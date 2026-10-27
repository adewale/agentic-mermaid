import { matchMermaidFrontmatter } from '../mermaid-source-wrapper.ts'
import { parseMermaidYaml } from '../shared/mermaid-yaml.ts'
import { accessibilityFields, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { sourceLineStarts, sourcePointAt } from '../shared/source-spans.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import type { ZenUMLAssignment, ZenUMLBody, ZenUMLBranch, ZenUMLFragmentType, ZenUMLParticipant, ZenUMLStatement } from './native-types.ts'

interface Token { kind: 'text' | 'comment' | 'open' | 'close'; text: string; start: number; end: number }
const nameToken = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\p{L}_$][\p{L}\p{N}_$-]*?)`
const namePattern = new RegExp(`^${nameToken}$`, 'u')
const namePrefix = new RegExp(`^(${nameToken})(?![\\p{L}\\p{N}_$-])`, 'u')
const asyncPattern = new RegExp(`^(${nameToken})\\s*(-->|->)\\s*(${nameToken})\\s*:\\s*([\\s\\S]*)$`, 'u')
const declarationPattern = new RegExp(`^(${nameToken})(?:\\s+as\\s+(${nameToken}))?$`, 'u')
const callTargetPattern = new RegExp(`^(?:(${nameToken})\\s*->\\s*)?(${nameToken})\\s*\\.\\s*([\\s\\S]+)$`, 'u')
export function zenName(value: string): string {
  const text = value.trim()
  if (!namePattern.test(text)) throw Error(`Invalid ZenUML identity: ${value}`)
  if (text.startsWith('"')) return JSON.parse(text) as string
  if (text.startsWith("'")) return text.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  return text
}
export function zenNameSource(value: string): string {
  if (!value || /[\r\n]/.test(value)) throw Error('ZenUML identities must be non-empty single-line text')
  return /^[\p{L}_$][\p{L}\p{N}_$-]*$/u.test(value) && !reserved.has(value) ? value : JSON.stringify(value)
}
const reserved = new Set(['title', 'if', 'else', 'while', 'for', 'foreach', 'forEach', 'loop', 'par', 'opt', 'try', 'catch', 'finally', 'return', 'new', 'critical', 'group', 'ref', 'section', 'const', 'readonly', 'static', 'await', 'true', 'false', 'null', 'nil', 'as', 'in'])

/** Lex structural braces only outside parameters, quotes and async payloads.
 * Scan once; an authored URL or a brace in a message is never a delimiter. */
function scan(source: string): Token[] {
  const tokens: Token[] = []
  let start = 0, quote = '', escaped = false, round = 0, square = 0, arrow = false, started = false, payload: false | 'event' | 'title' = false
  const emit = (end: number) => {
    const text = source.slice(start, end).trim()
    if (text) tokens.push({ kind: 'text', text, start: start + source.slice(start, end).indexOf(text), end: end - (source.slice(start, end).length - source.slice(start, end).trimEnd().length) })
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    const first = !started && /\S/.test(c)
    if (first) {
      started = true
      if (!round && !square && /^title(?:[ \t]|$)/.test(source.slice(i, i + 6))) payload = 'title'
    }
    if (quote) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === quote) quote = ''
      continue
    }
    if (!payload && (c === '"' || c === "'")) { quote = c; continue }
    if (!payload && source.startsWith('//', i)) {
      emit(i)
      const end = source.indexOf('\n', i)
      const stop = end < 0 ? source.length : end
      tokens.push({ kind: 'comment', text: source.slice(i + 2, stop).replace(/^ /, ''), start: i, end: stop })
      i = stop - 1; start = stop; started = false; arrow = false; continue
    }
    if (!payload && source.startsWith('%%', i) && first) {
      const end = source.indexOf('\n', i)
      i = end < 0 ? source.length : end - 1; start = i + 1; started = false; arrow = false; continue
    }
    if (!payload) {
      if (c === '(') round++
      if (c === ')') { if (!round) throw Error('Unmatched ZenUML parenthesis'); round-- }
      if (c === '[') square++
      if (c === ']') { if (!square) throw Error('Unmatched ZenUML bracket'); square-- }
      if (c === '>' && source[i - 1] === '-' && !round && !square) arrow = true
      if (c === ':' && !round && !square && arrow) payload = 'event'
    }
    if (!round && !square && ((!payload && (c === '{' || c === '}')) || c === '\n' || c === ';' && payload !== 'title')) {
      emit(i)
      if (c === '{' || c === '}') tokens.push({ kind: c === '{' ? 'open' : 'close', text: c, start: i, end: i + 1 })
      start = i + 1; payload = false; started = false; arrow = false
    }
  }
  if (quote || round || square) throw Error('Unclosed ZenUML quote or parameter list')
  emit(source.length)
  return tokens
}

export function zenUMLStatementEnds(lines: readonly string[]): readonly number[] {
  const text = lines.join('\n'), ends = lines.map((_, index) => index)
  try {
    let line = 0, offset = 0
    for (const token of scan(text)) {
      while (offset < token.start) if (text[offset++] === '\n') line++
      const first = line
      while (offset < token.end) if (text[offset++] === '\n') line++
      for (let i = first; i < line; i++) ends[i] = line
    }
  } catch { /* Malformed grammar is diagnosed by the native parser. */ }
  return ends
}

function assignment(text: string): { assignment?: ZenUMLAssignment; rest: string } {
  // Assignment is a prefix, not an '=' inside a method's argument expression.
  const match = text.match(new RegExp(`^(?:(${nameToken})\\s+)?(${nameToken})\\s*=\\s*(?!=)([\\s\\S]+)$`, 'u'))
  return match ? { assignment: { name: zenName(match[2]!), ...(match[1] ? { type: zenName(match[1]) } : {}) }, rest: match[3]!.trim() } : { rest: text }
}
function participant(text: string): ZenUMLParticipant | undefined {
  const annotations: string[] = []
  let rest = text, stereotype: string | undefined
  while (/^@[\w]+\s+/.test(rest)) {
    const match = rest.match(/^@([\w]+)\s+/)!
    annotations.push(match[1]!); rest = rest.slice(match[0].length)
  }
  if (rest.startsWith('<<')) {
    const end = rest.indexOf('>>')
    if (end < 0) return undefined
    stereotype = zenName(rest.slice(2, end).trim()); rest = rest.slice(end + 2).trim()
  }
  const match = rest.match(declarationPattern)
  if (!match || (!rest.startsWith('"') && reserved.has(match[1]!))) return undefined
  const id = zenName(match[1]!)
  return { id, label: match[2] ? zenName(match[2]) : id, annotations, ...(stereotype ? { stereotype } : {}) }
}

export interface ZenUMLSourceObservation { kind: 'nodes' | 'edges' | 'groups' | 'labels'; id: string; start: number; end: number }
export function parseZenUML(source: string | readonly string[], observe?: (event: ZenUMLSourceObservation) => void): ZenUMLBody {
  const authored = Array.isArray(source) ? source.join('\n') : source as string
  let text = authored.replace(/\r\n?/g, '\n')
  const originalStarts = sourceLineStarts(authored)
  let wrapperLines = 0
  let title: string | undefined
  const wrapper = matchMermaidFrontmatter(text)
  if (wrapper) {
    const metadata = parseMermaidYaml(wrapper.yaml)
    if (!metadata.ok) throw Error(metadata.message)
    if (metadata.value && typeof metadata.value === 'object' && 'title' in metadata.value && typeof metadata.value.title === 'string') title = metadata.value.title
    text = text.slice(wrapper.source.length)
    wrapperLines = wrapper.source.split('\n').length - 1
  }
  const accessibility = scanAccessibilityDirectives(text.split('\n'), zenUMLStatementEnds(text.split('\n')))
  text = accessibility.familyLines.join('\n')
  const header = text.match(/^(?:(?:[^\S\n]*(?:%%[^\n]*)?\n))*[^\S\n]*zenuml\b/)
  if (!header) throw Error('Expected zenuml header')
  const tokens = scan(text.slice(header[0].length))
  const filteredStarts = sourceLineStarts(text)
  const observations: ZenUMLSourceObservation[] = []
  const originalOffset = (offset: number) => {
    const point = sourcePointAt(filteredStarts, offset + header[0].length)
    const originalLine = (accessibility.familyOrigins[point.line - 1] ?? point.line - 1) + wrapperLines
    return (originalStarts[originalLine] ?? authored.length) + point.col - 1
  }
  const report = (kind: ZenUMLSourceObservation['kind'], id: string, token: Token) => { if (observe) observations.push({ kind, id, start: originalOffset(token.start), end: originalOffset(token.end) }) }
  const body: ZenUMLBody = { kind: 'zenuml', participants: [], statements: [], ...accessibilityFields(accessibility.accessibility), ...(title === undefined ? {} : { title }) }
  let cursor = 0, serial = 0, depth = 0, inHead = true
  const id = () => `statement:${++serial}`
  const sourceOf = (token: Token) => ({ offset: originalOffset(token.start), endOffset: originalOffset(token.end), unit: 'physical' as const })
  const consume = () => {
    const token = tokens[cursor++]
    if (token && parserObservationActive('zenuml')) {
      const source = sourceOf(token)
      observeParserStatement('zenuml', token.kind, authored.slice(source.offset, source.endOffset), source)
    }
    return token
  }
  const append = (target: ZenUMLStatement[], statement: ZenUMLStatement, token: Token) => {
    target.push(statement)
    if (parserObservationActive('zenuml')) observeParserMutation('zenuml', 'append-statement', statement, sourceOf(token))
  }
  const parseStatements = (nested: boolean): ZenUMLStatement[] => {
    if (++depth > 128) throw Error('ZenUML nesting exceeds 128 scopes')
    const out: ZenUMLStatement[] = []
    while (cursor < tokens.length) {
      const token = consume()!
      if (token.kind === 'close') {
        if (!nested) throw Error('Unmatched ZenUML closing brace')
        depth--; return out
      }
      if (token.kind === 'open') throw Error('ZenUML scope has no owner')
      if (token.kind === 'comment') { const comment = { kind: 'comment' as const, id: id(), text: token.text }; append(out, comment, token); report('labels', comment.id, token); continue }
      let value = token.text
      if (!nested && (value === 'title' || value.startsWith('title '))) {
        body.title = value.slice(5).trim()
        if (parserObservationActive('zenuml')) observeParserMutation('zenuml', 'set-title', body.title, sourceOf(token))
        report('labels', 'title', token); continue
      }
      const starter = value.match(new RegExp(`^@Starter\\(\\s*(${nameToken})\\s*\\)$`, 'u'))
      if (!nested && starter && inHead) {
        body.starter = zenName(starter[1]!)
        if (parserObservationActive('zenuml')) observeParserMutation('zenuml', 'set-starter', body.starter, sourceOf(token))
        continue
      }
      if (!nested && inHead) {
        const declaration = participant(value)
        if (declaration) {
          if (body.participants.some(p => p.id === declaration.id)) throw Error(`Duplicate ZenUML participant: ${declaration.id}`)
          const comments: string[] = []
          while (out.at(-1)?.kind === 'comment') {
            const comment = out.pop() as Extract<ZenUMLStatement, { kind: 'comment' }>
            comments.unshift(comment.text)
            if (parserObservationActive('zenuml')) observeParserMutation('zenuml', 'claim-participant-comment', { participant: declaration.id, comment })
          }
          if (comments.length) declaration.comments = comments
          if (declaration.annotations.length > 1) body.unsupportedSource = authored
          report('nodes', declaration.id, token)
          body.participants.push(declaration)
          if (parserObservationActive('zenuml')) observeParserMutation('zenuml', 'append-participant', declaration, sourceOf(token))
          continue
        }
      }
      inHead = false
      const statementId = id()
      report('edges', statementId, token)
      let reply = false
      if (/^@(return|reply)(?:\s|$)/.test(value)) {
        reply = true; value = value.replace(/^@(return|reply)\s*/, '')
        if (!value) {
          const next = consume()
          if (!next || next.kind !== 'text') throw Error('ZenUML reply annotation requires a message')
          value = next.text
        }
      }
      const asynchronous = value.match(asyncPattern)
      if (asynchronous) {
        report('nodes', zenName(asynchronous[1]!), token); report('nodes', zenName(asynchronous[3]!), token)
        append(out, { kind: 'message', id: statementId, from: zenName(asynchronous[1]!), to: zenName(asynchronous[3]!), label: asynchronous[4]!, reply: reply || asynchronous[2] === '-->' }, token); continue
      }
      if (reply) throw Error('ZenUML reply annotation requires a directed message')
      const fragment = value.match(/^(if|while|for|forEach|foreach|loop|par|opt|try|critical)\b([\s\S]*)$/)
      if (fragment) {
        if (observe) observations.pop()
        report('groups', statementId, token)
        const type = fragment[1] as ZenUMLFragmentType
        const condition = readCondition(fragment[2]!)
        if (tokens[cursor]?.kind !== 'open') throw Error(`ZenUML ${type} requires a brace-delimited scope`)
        consume()
        const branches: ZenUMLBranch[] = [{ kind: 'body', statements: parseStatements(true) }]
        while (tokens[cursor]?.kind === 'text') {
          const continuation = tokens[cursor]!.text.match(/^(else\s+if|else|catch|finally)\b([\s\S]*)$/)
          if (!continuation) break
          const branchKind = continuation[1] === 'else if' ? 'else-if' : continuation[1] as ZenUMLBranch['kind']
          if (type === 'if' ? !['else-if', 'else'].includes(branchKind) : type === 'try' ? !['catch', 'finally'].includes(branchKind) : true) break
          consume()
          const branchCondition = readCondition(continuation[2]!)
          if (consume()?.kind !== 'open') throw Error('ZenUML branch requires a brace-delimited scope')
          branches.push({ kind: branchKind, ...(branchCondition === undefined ? {} : { condition: branchCondition }), statements: parseStatements(true) })
        }
        append(out, { kind: 'fragment', id: statementId, type, ...(condition === undefined ? {} : { condition }), branches }, token); continue
      }
      if (/^return\b/.test(value)) { append(out, { kind: 'return', id: statementId, label: value.slice(6).trim() }, token); continue }
      const assigned = assignment(value)
      const creation = assigned.rest.match(new RegExp(`^new\\s+(${nameToken})(?:\\s*\\(([\\s\\S]*)\\))?$`, 'u'))
      const takeChildren = () => {
        if (tokens[cursor]?.kind !== 'open') return []
        consume(); return parseStatements(true)
      }
      if (creation) {
        report('nodes', assigned.assignment ? `${assigned.assignment.name}:${zenName(creation[1]!)}` : zenName(creation[1]!), token)
        append(out, { kind: 'create', id: statementId, constructor: zenName(creation[1]!), ...(creation[2] === undefined ? {} : { arguments: creation[2] }), ...(assigned.assignment ? { assignment: assigned.assignment } : {}), children: takeChildren() }, token); continue
      }
      const target = assigned.rest.match(callTargetPattern)
      const label = target ? target[3]! : assigned.rest
      // Method chains and argument expressions remain authored text. Bare
      // names in a message scope mean implicit self calls, not declarations.
      if (namePrefix.test(label) && methodText(label) && (target !== null || !reserved.has(namePrefix.exec(label)![1]!))) {
        if (target?.[1]) report('nodes', zenName(target[1]), token)
        if (target?.[2]) report('nodes', zenName(target[2]), token)
        append(out, { kind: 'call', id: statementId, ...(target?.[1] ? { from: zenName(target[1]) } : {}), ...(target?.[2] ? { to: zenName(target[2]) } : {}), label, ...(assigned.assignment ? { assignment: assigned.assignment } : {}), children: takeChildren() }, token); continue
      }
      // Retain the complete document for anything outside the typed grammar.
      // Consumers must refuse projection; no supported prefix is drawn alone.
      append(out, { kind: 'opaque', id: statementId, source: value }, token)
      body.unsupportedSource = authored
      if (tokens[cursor]?.kind === 'open') { consume(); parseStatements(true) }
    }
    depth--
    if (nested) throw Error('Unclosed ZenUML scope')
    return out
  }
  body.statements = parseStatements(false)
  // A quoted authored name may resemble an editing address. Reserve every
  // actual endpoint before publishing IDs or source observations.
  const actors = new Set(body.participants.map(p => p.id))
  if (body.starter) actors.add(body.starter)
  const statements: ZenUMLStatement[] = []
  const visit = (values: ZenUMLStatement[]) => { for (const s of values) {
    statements.push(s)
    if (s.kind === 'call' || s.kind === 'message') { if (s.from) actors.add(s.from); if (s.to) actors.add(s.to) }
    if (s.kind === 'create') actors.add(s.assignment ? `${s.assignment.name}:${s.constructor}` : s.constructor)
    if (s.kind === 'call' || s.kind === 'create') visit(s.children)
    if (s.kind === 'fragment') for (const branch of s.branches) visit(branch.statements)
  } }
  visit(body.statements)
  const remap = new Map<string, string>()
  let address = 0
  for (const s of statements) {
    const old = s.id
    do { s.id = `statement:${++address}` } while (actors.has(s.id))
    remap.set(old, s.id)
    if (old !== s.id && parserObservationActive('zenuml')) observeParserMutation('zenuml', 'readdress-statement', { from: old, to: s.id })
  }
  for (const event of observations) {
    if (event.kind !== 'nodes' && event.id !== 'title') event.id = remap.get(event.id) ?? event.id
    observe?.(event)
  }
  assertDiagramWorkLimit('nodes', actors.size)
  assertDiagramWorkLimit('edges', serial)
  return body
}
function readCondition(value: string): string | undefined {
  const text = value.trim()
  if (!text) return undefined
  if (!text.startsWith('(') || !text.endsWith(')')) throw Error('ZenUML condition requires parentheses')
  return text.slice(1, -1).trim()
}
function methodText(value: string): boolean {
  // The scanner already establishes balanced parameters/strings. Outside
  // invocation parentheses a method is an identifier or a dotted chain.
  let depth = 0, quote = '', escaped = false, plain = ''
  for (const c of value) {
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") { if (!depth) return false; quote = c; continue }
    if (c === '(') { depth++; if (depth === 1) plain += '()'; continue }
    if (c === ')') { depth--; continue }
    if (!depth) plain += c
  }
  return /^[\p{L}_$][\p{L}\p{N}_$-]*(?:\(\))?(?:\s*\.\s*[\p{L}_$][\p{L}\p{N}_$-]*(?:\(\))?)*$/u.test(plain.trim())
}
