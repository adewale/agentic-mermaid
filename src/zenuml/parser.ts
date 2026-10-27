import type { ZenUmlBody, ZenUmlMessage, ZenUmlParticipant, ZenUmlRegion, ZenUmlStatement } from './types.ts'
import type { SequenceActorType } from '../sequence/types.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
const identifier = /^[A-Za-z_$][\w$]*$/
const annotators: Record<string, SequenceActorType> = { Actor: 'actor', Boundary: 'boundary', Control: 'control', Entity: 'entity', Database: 'database', Collections: 'collections', Queue: 'queue', Participant: 'participant' }
interface Token { text: string; kind: 'line' | 'open' | 'close' | 'comment' }
/** Lexical boundaries ignore delimiters in quoted text and call parameters. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [], push = () => { if (text.trim()) tokens.push({ kind: 'line', text: text.trim() }); text = ''; rawText = false; rawReturn = false; returnBraces = 0 }
  let text = '', quote = '', parens = 0, rawText = false, rawReturn = false, returnBraces = 0
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!, n = source[i + 1]
    // Mermaid envelope comments are preserved by the common source layer;
    // unlike ZenUML // comments they do not create diagram statements.
    if (!quote && !parens && !text.trim() && c === '%' && n === '%') {
      let end = source.indexOf('\n', i)
      if (end < 0) end = source.length
      i = end - 1; continue
    }
    if (!rawText && !quote && !parens && (c === ':' || (c === ' ' || c === '\t') && text.length > 0 && !/[\s]/.test(text.at(-1)!))) {
      const prefix = text.trim()
      rawReturn = prefix === 'return'
      rawText = prefix === 'title' || prefix === 'return' || /^(@[A-Za-z]+\s+)?[A-Za-z_$][\w$]*\s+as$/.test(prefix) || c === ':' && /^[A-Za-z_$][\w$]*\s*->\s*[A-Za-z_$][\w$]*$/.test(prefix)
    }
    if (rawText && c !== '\n' && c !== '\r') {
      if (rawReturn && c === '}' && returnBraces === 0) { push(); tokens.push({ kind: 'close', text: c }); continue }
      if (rawReturn && c === '{') returnBraces++
      else if (rawReturn && c === '}') returnBraces--
      text += c; continue
    }
    if (quote) { text += c; if (c === quote) { let slashes = 0; for (let j = i - 1; j >= 0 && source[j] === '\\'; j--) slashes++; if (slashes % 2 === 0) quote = '' } continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; text += c; continue }
    if (c === '/' && n === '/' && !parens) { push(); let end = source.indexOf('\n', i); if (end < 0) end = source.length; tokens.push({ kind: 'comment', text: source.slice(i + 2, end).trim() }); i = end - 1; continue }
    if (c === '/' && n === '*') { const end = source.indexOf('*/', i + 2); if (end < 0) throw Error('Unclosed ZenUML block comment'); i = end + 1; continue }
    if (c === '(') parens++
    if (c === ')') { parens--; if (parens < 0) throw Error('Unexpected ZenUML closing parenthesis') }
    if ((c === '{' || c === '}') && !parens) { push(); tokens.push({ kind: c === '{' ? 'open' : 'close', text: c }); continue }
    if ((c === '\n' || c === '\r' || c === ';') && !parens) push()
    else text += c
  }
  if (quote || parens) throw Error('Unclosed ZenUML quote or call parameters')
  push(); return tokens
}
export function parseZenUml(source: string): ZenUmlBody {
  const tokens = tokenize(source), header = tokens.shift()
  if (header?.text !== 'zenuml') throw Error('Expected zenuml header')
  const body: ZenUmlBody = { kind: 'zenuml', participants: [], statements: [] }
  let at = 0, serial = 0
  const nextId = () => `statement:${serial++}`
  const participant = (id: string, label = id, type: SequenceActorType = 'participant'): ZenUmlParticipant => {
    if (!identifier.test(id)) throw Error(`Invalid ZenUML participant ${id}`)
    const found = body.participants.find(item => item.id === id)
    if (found) return found
    const item = { id, label, type }; body.participants.push(item); return item
  }
  const parseStatements = (nested: boolean, current = '', parent = ''): ZenUmlStatement[] => {
    const out: ZenUmlStatement[] = []
    let pendingReply = false
    while (at < tokens.length) {
      const token = tokens[at++]!
      observeParserStatement('zenuml', token.kind, token.text)
      if (token.kind === 'close') { if (pendingReply) throw Error('Reply annotation needs a message in its own scope'); if (!nested) throw Error('Unexpected ZenUML closing brace'); return out }
      if (token.kind === 'open') throw Error('ZenUML block needs a message or region header')
      if (token.kind === 'comment') { const previous = out.at(-1); if (previous?.kind === 'comment') previous.text += `\n${token.text}`; else out.push({ kind: 'comment', id: nextId(), text: token.text }); continue }
      let line = token.text
      if (line.startsWith('title ')) { if (nested) throw Error('Title cannot be nested'); body.title = line.slice(6); continue }
      if (line === '@return' || line === '@reply') { pendingReply = true; continue }
      if (/^@(?:return|reply)\s+/.test(line)) { pendingReply = true; line = line.replace(/^@(?:return|reply)\s+/, '') }
      const returned = line.match(/^return(?:\s+(.*))?$/)
      if (returned) { if (pendingReply) throw Error('Reply annotation requires an asynchronous message'); if (!nested) throw Error('Return needs an enclosing call'); out.push({ kind: 'return', id: nextId(), text: returned[1] ?? '' }); if (parserObservationActive('zenuml')) observeParserMutation('zenuml', 'append-return', { from: current, to: parent, text: returned[1] ?? '' }); continue }
      const region = line.match(/^(while|for|forEach|foreach|loop|if|opt|par|try)(?=\s|\(|$)(?:\s*\(([\s\S]*)\)|\s+([\s\S]+))?$/)
      if (region && tokens[at]?.kind === 'open') {
        if (pendingReply) throw Error('Reply annotation requires an asynchronous message')
        const keyword = region[1]!, label = (region[2] ?? region[3] ?? '').trim()
        at++
        const type = ['while', 'for', 'forEach', 'foreach', 'loop'].includes(keyword) ? 'loop' : keyword === 'if' ? 'alt' : keyword as ZenUmlRegion['type']
        const item: ZenUmlRegion = { kind: 'region', id: nextId(), type, branches: [{ label, statements: parseStatements(true, current, parent) }] }
        while (tokens[at]?.kind === 'line' && /^(?:else(?=\s|$)|catch(?=\s|\(|$)|finally(?=\s|$))/.test(tokens[at]!.text)) {
          const branch = tokens[at++]!.text
          if (type !== 'alt' && type !== 'try' || tokens[at]?.kind !== 'open') throw Error('Invalid ZenUML branch')
          if (type === 'alt' && !branch.startsWith('else') || type === 'try' && branch.startsWith('else')) throw Error('Invalid branch for region')
          at++; item.branches.push({ label: branch, statements: parseStatements(true, current, parent) })
        }
        out.push(item); continue
      }
      const creation = line.match(/^new\s+([A-Za-z_$][\w$]*)(\([\s\S]*\))?$/)
      const asynchronous = line.match(/^([A-Za-z_$][\w$]*)\s*->\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/)
      const call = line.match(/^(?:(?:[\w$]+\s+)?([\w$]+)\s*=\s*)?(?:([A-Za-z_$][\w$]*)\s*->\s*)?([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*(?:\([\s\S]*\))?)$/)
      if (creation || asynchronous || call) {
        if (pendingReply && !asynchronous) throw Error('Reply annotation requires an asynchronous message')
        const id = nextId(), to = creation?.[1] ?? asynchronous?.[2] ?? call![3]!, from = asynchronous?.[1] ?? call?.[2]
        if (from) participant(from)
        participant(to)
        const message: ZenUmlMessage = { kind: 'message', id, ...(from ? { from } : {}), to, text: creation ? `new ${to}${creation[2] ?? ''}` : asynchronous ? asynchronous[3]! : call![4]!, mode: pendingReply ? 'reply' : creation ? 'create' : asynchronous ? 'async' : 'sync', children: [], ...(call?.[1] ? { assignment: call[1], ...(line.match(/^([\w$]+)\s+[\w$]+\s*=/)?.[1] ? { assignmentType: line.match(/^([\w$]+)\s+[\w$]+\s*=/)![1] } : {}) } : {}) }
        pendingReply = false
        if (tokens[at]?.kind === 'open') { at++; message.children = parseStatements(true, to, from ?? current) }
        out.push(message)
        if (parserObservationActive('zenuml')) observeParserMutation('zenuml', 'append-message', { from: from ?? current, to, text: message.text, mode: message.mode })
        continue
      }
      const declaration = line.match(/^(?:@([A-Za-z]+)\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+(.+))?$/)
      if (declaration && !nested) {
        if (pendingReply) throw Error('Reply annotation requires an asynchronous message')
        while (out.at(-1)?.kind === 'comment') out.pop()
        const type = declaration[1] ? Object.hasOwn(annotators, declaration[1]) ? annotators[declaration[1]] : undefined : 'participant'
        if (!type) throw Error(`Unsupported ZenUML participant annotation ${declaration[1]}`)
        const item = participant(declaration[2]!, declaration[3] ?? declaration[2]!, type)
        if (declaration[3]) item.label = declaration[3]
        item.type = type
        continue
      }
      throw Error(`Unsupported ZenUML statement: ${line}`)
    }
    if (pendingReply) throw Error('Reply annotation needs a message in its own scope')
    if (nested) throw Error('Unclosed ZenUML block')
    return out
  }
  body.statements = parseStatements(false)
  return body
}
export function walkZenUml(statements: readonly ZenUmlStatement[], visit: (statement: ZenUmlStatement) => void): void {
  for (const statement of statements) { visit(statement); if (statement.kind === 'message') walkZenUml(statement.children, visit); else if (statement.kind === 'region') for (const branch of statement.branches) walkZenUml(branch.statements, visit) }
}
