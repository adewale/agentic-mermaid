// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { parserObservationActive, observeParserStatement, observeParserMutation, type ParserObservationSource } from '../shared/parser-observation.ts'
import { accDescr } from '../shared/grammar-acc-descr.ts'
import { ACC_TITLE, DIRECTIVE, NEWLINE, Reader, SINGLE_LINE_COMMENT, STRING, TITLE, WHITESPACE, YAML, accDescrValue, accTitleValue, stringValue, titleValue, tokenize, type Scanner, type TokenType } from '../shared/grammar-reader.ts'

const enum T {
  lbracket,
  comma,
  rbracket,
  at,
  slash,
  lparen,
  rparen,
  minus,
  lbrace,
  rbrace,
  number,
  arrow,
  linkPort,
  linkArrow,
  linkLabel,
  strategy,
  wardley,
  size,
  evolution,
  anchor,
  component,
  label,
  inertia,
  evolve,
  pipeline,
  note,
  annotations,
  annotation,
  accelerator,
  deaccelerator,
  name,
  ws,
  accDescr,
  accTitle,
  title,
  int,
  string,
  id,
  newline,
}

function digits(src: string, from: number): number {
  let i = from
  for (let c = src.charCodeAt(i); c >= 48 && c <= 57; c = src.charCodeAt(i)) i++
  return i
}

// Answers as WARDLEY_NUMBER's pattern does. The pattern reads a whole run of digits before it
// finds there is no fraction, and would do so again from every digit of a long run.
function numberScanner(): Scanner {
  let from = 0
  let end = 0
  return (src, p) => {
    if (p < from || p >= end) {
      from = p
      end = digits(src, p)
    }
    if (end === p || src.charCodeAt(end) !== 46) return -1
    const stop = digits(src, end + 1)
    return stop > end + 1 ? stop : -1
  }
}

const ARROW: TokenType = { name: 'ARROW', pattern: /->/y, first: '-' }
const LINK_ARROW: TokenType = { name: 'LINK_ARROW', pattern: /-->|-\.->|>|\+'[^']*'<>|\+'[^']*'<|\+'[^']*'>/y, first: '->+' }
const word = (name: string, text: string): TokenType => ({ name, pattern: new RegExp(text, 'y'), first: text[0] })

export const WARDLEY_TOKENS: readonly TokenType[] = [
  { name: '[', pattern: '[' },
  { name: ',', pattern: ',' },
  { name: ']', pattern: ']' },
  { name: '@', pattern: '@' },
  { name: '/', pattern: '/' },
  { name: '(', pattern: '(' },
  { name: ')', pattern: ')' },
  { name: '-', pattern: '-', longer: [ARROW, LINK_ARROW, YAML] },
  { name: '{', pattern: '{' },
  { name: '}', pattern: '}' },
  { name: 'WARDLEY_NUMBER', pattern: /[0-9]+\.[0-9]+/y, first: '0123456789', scanner: numberScanner },
  ARROW,
  { name: 'LINK_PORT', pattern: /\+<>|\+>|\+</y, first: '+' },
  LINK_ARROW,
  { name: 'LINK_LABEL', pattern: /;[^\n\r]+/y, first: ';' },
  { name: 'STRATEGY', pattern: /build|buy|outsource|market/y, first: 'bom' },
  word('KW_WARDLEY', 'wardley-beta'),
  word('KW_SIZE', 'size'),
  word('KW_EVOLUTION', 'evolution'),
  word('KW_ANCHOR', 'anchor'),
  word('KW_COMPONENT', 'component'),
  word('KW_LABEL', 'label'),
  word('KW_INERTIA', 'inertia'),
  word('KW_EVOLVE', 'evolve'),
  word('KW_PIPELINE', 'pipeline'),
  word('KW_NOTE', 'note'),
  word('KW_ANNOTATIONS', 'annotations'),
  word('KW_ANNOTATION', 'annotation'),
  word('KW_ACCELERATOR', 'accelerator'),
  word('KW_DEACCELERATOR', 'deaccelerator'),
  {
    name: 'NAME_WITH_SPACES',
    pattern: /(?!title\s|accTitle|accDescr)[A-Za-z](?:[A-Za-z0-9_()&]|-(?!>))*(?:[ \t]+[A-Za-z(](?:[A-Za-z0-9_()&]|-(?!>))*)*/y,
    first: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  },
  { name: 'WS', pattern: /[ \t]+/y, hidden: true, first: '\t ' },
  accDescr(),
  ACC_TITLE,
  TITLE,
  { name: 'INT', pattern: /0|[1-9][0-9]*(?!\.)/y, first: '0123456789' },
  STRING,
  { name: 'ID', pattern: /[\w]([-\w]*\w)?/y, first: '_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
]

export interface LabelAst {
  $type: 'Label'
  negX: boolean
  offsetX: number
  negY: boolean
  offsetY: number
}

export interface StageAst {
  $type: 'EvolutionStage'
  name: string
  boundary?: number
  secondName?: string
}

export interface ComponentAst {
  $type: 'Component'
  name: string
  visibility: number
  evolution: number
  label?: LabelAst
  decorator?: { $type: 'Decorator'; strategy: string }
  inertia: boolean
}

export interface PipelineComponentAst {
  $type: 'PipelineComponent'
  name: string
  evolution: number
  label?: LabelAst
}

export interface LinkAst {
  $type: 'Link'
  from: string
  fromPort?: string
  arrow?: string
  to: string
  toPort?: string
  linkLabel?: string
}

interface Placed {
  name: string
  x: number
  y: number
}

export interface WardleyAst {
  $type: 'Wardley'
  title?: string
  accTitle?: string
  accDescr?: string
  size?: { $type: 'Size'; width: number; height: number }
  evolution?: { $type: 'Evolution'; stages: StageAst[] }
  anchors: { $type: 'Anchor'; name: string; visibility: number; evolution: number }[]
  components: ComponentAst[]
  links: LinkAst[]
  evolves: { $type: 'Evolve'; component: string; target: number }[]
  pipelines: { $type: 'Pipeline'; parent: string; components: PipelineComponentAst[] }[]
  notes: { $type: 'Note'; text: string; visibility: number; evolution: number }[]
  annotations: { $type: 'Annotations'; x: number; y: number }[]
  annotation: { $type: 'Annotation'; number: number; x: number; y: number; text: string }[]
  accelerators: ({ $type: 'Accelerator' } & Placed)[]
  deaccelerators: ({ $type: 'Deaccelerator' } & Placed)[]
}

const authoredSources = new WeakMap<object, ParserObservationSource>()
export const wardleyAstSource = (value: object): ParserObservationSource | undefined => authoredSources.get(value)

export function parseWardley(src: string): WardleyAst {
  const r = new Reader(tokenize(src, WARDLEY_TOKENS, 'wardley'), WARDLEY_TOKENS, 'wardley')
  const ast: WardleyAst = {
    $type: 'Wardley',
    anchors: [],
    components: [],
    links: [],
    evolves: [],
    pipelines: [],
    notes: [],
    annotations: [],
    annotation: [],
    accelerators: [],
    deaccelerators: [],
  }

  const at = (kind: number): boolean => r.kinds[r.i] === kind
  const isName = (): boolean => at(T.string) || at(T.id) || at(T.name)
  const name = (): string => {
    if (at(T.string)) return stringValue(r.take())
    if (at(T.id) || at(T.name)) return r.take()
    return r.fail('a name')
  }
  const number = (): number => Number(r.expect(T.number))
  const int = (): number => parseInt(r.expect(T.int))
  const coordinate = (): number => (at(T.number) ? Number(r.take()) : parseInt(r.expect(T.int)))
  const endOfLine = (): void => {
    if (at(-1)) return
    if (!at(T.newline)) r.fail('a line break or the end of input')
    while (at(T.newline)) r.i++
  }
  const pair = (read: () => number): [number, number] => {
    r.expect(T.lbracket)
    const first = read()
    r.expect(T.comma)
    const second = read()
    r.expect(T.rbracket)
    return [first, second]
  }
  const label = (): LabelAst => {
    r.expect(T.label)
    r.expect(T.lbracket)
    const negX = r.accept(T.minus)
    const offsetX = int()
    r.expect(T.comma)
    const negY = r.accept(T.minus)
    const offsetY = int()
    r.expect(T.rbracket)
    return { $type: 'Label', negX, offsetX, negY, offsetY }
  }
  const stage = (): StageAst => {
    const out: StageAst = { $type: 'EvolutionStage', name: name() }
    if (r.accept(T.at)) out.boundary = number()
    if (r.accept(T.slash)) out.secondName = name()
    return out
  }

  while (at(T.newline)) r.i++
  r.expect(T.wardley)
  const observed = parserObservationActive('wardley')
  const consumedSource = (start: number): ParserObservationSource => {
    let last = r.i - 1
    while (r.kinds[last] === T.newline) last--
    return { offset: start, endOffset: r.tokens.ends[last] ?? start, unit: 'physical' }
  }
  const located = <A extends object>(value: A, start: number): A => {
    if (observed) authoredSources.set(value, consumedSource(start))
    return value
  }
  while (!at(-1)) {
    const kind = r.kind, start = r.tokens.starts[r.i]!
    switch (r.kind) {
      case T.newline:
        r.i++
        break
      case T.accDescr:
        ast.accDescr = accDescrValue(r.take())
        endOfLine()
        break
      case T.accTitle:
        ast.accTitle = accTitleValue(r.take())
        endOfLine()
        break
      case T.title:
        ast.title = titleValue(r.take())
        if (observed) observeParserMutation('wardley', 'set-title', ast.title, consumedSource(start))
        endOfLine()
        break
      case T.size: {
        r.i++
        const [width, height] = pair(int)
        endOfLine()
        ast.size = located({ $type: 'Size' as const, width, height }, start)
        break
      }
      case T.evolution: {
        r.i++
        const stages = [stage()]
        r.expect(T.arrow)
        stages.push(stage())
        while (r.accept(T.arrow)) stages.push(stage())
        endOfLine()
        ast.evolution = located({ $type: 'Evolution' as const, stages }, start)
        break
      }
      case T.anchor: {
        r.i++
        const anchor = name()
        const [visibility, evolution] = pair(number)
        endOfLine()
        ast.anchors.push(located({ $type: 'Anchor' as const, name: anchor, visibility, evolution }, start))
        break
      }
      case T.component: {
        r.i++
        const component: ComponentAst = { $type: 'Component', name: name(), visibility: 0, evolution: 0, inertia: false }
        ;[component.visibility, component.evolution] = pair(number)
        if (at(T.label)) component.label = label()
        if (at(T.lparen) && r.kinds[r.i + 1] === T.strategy) {
          r.i++
          component.decorator = { $type: 'Decorator', strategy: r.take() }
          r.expect(T.rparen)
        }
        if (r.accept(T.inertia)) {
          component.inertia = true
        } else if (r.accept(T.lparen)) {
          r.expect(T.inertia)
          r.expect(T.rparen)
          component.inertia = true
        }
        endOfLine()
        ast.components.push(located(component, start))
        break
      }
      case T.evolve: {
        r.i++
        const component = name()
        const target = number()
        endOfLine()
        ast.evolves.push(located({ $type: 'Evolve' as const, component, target }, start))
        break
      }
      case T.pipeline: {
        r.i++
        const parent = name()
        r.expect(T.lbrace)
        r.expect(T.newline)
        while (at(T.newline)) r.i++
        const components: PipelineComponentAst[] = []
        do {
          const componentStart = r.tokens.starts[r.i]!
          r.expect(T.component)
          const component: PipelineComponentAst = { $type: 'PipelineComponent', name: name(), evolution: 0 }
          r.expect(T.lbracket)
          component.evolution = number()
          r.expect(T.rbracket)
          if (at(T.label)) component.label = label()
          endOfLine()
          components.push(located(component, componentStart))
        } while (at(T.component))
        r.expect(T.rbrace)
        endOfLine()
        ast.pipelines.push(located({ $type: 'Pipeline' as const, parent, components }, start))
        break
      }
      case T.note: {
        r.i++
        const text = stringValue(r.expect(T.string))
        const [visibility, evolution] = pair(number)
        endOfLine()
        ast.notes.push(located({ $type: 'Note' as const, text, visibility, evolution }, start))
        break
      }
      case T.annotations: {
        r.i++
        const [x, y] = pair(coordinate)
        endOfLine()
        ast.annotations.push(located({ $type: 'Annotations' as const, x, y }, start))
        break
      }
      case T.annotation: {
        r.i++
        const n = int()
        r.expect(T.comma)
        const [x, y] = pair(coordinate)
        const text = stringValue(r.expect(T.string))
        endOfLine()
        ast.annotation.push(located({ $type: 'Annotation' as const, number: n, x, y, text }, start))
        break
      }
      case T.accelerator:
      case T.deaccelerator: {
        const slow = r.kind === T.deaccelerator
        r.i++
        const force = name()
        const [x, y] = pair(number)
        endOfLine()
        if (slow) ast.deaccelerators.push(located({ $type: 'Deaccelerator' as const, name: force, x, y }, start))
        else ast.accelerators.push(located({ $type: 'Accelerator' as const, name: force, x, y }, start))
        break
      }
      default: {
        if (!isName()) r.fail('a statement')
        const link: LinkAst = { $type: 'Link', from: name(), to: '' }
        if (at(T.linkPort)) link.fromPort = r.take()
        if (at(T.linkArrow) || at(T.arrow)) link.arrow = r.take()
        link.to = name()
        if (at(T.linkPort)) link.toPort = r.take()
        if (at(T.linkLabel)) link.linkLabel = r.take().substring(1).trim()
        endOfLine()
        ast.links.push(located(link, start))
      }
    }
    if (observed && kind !== T.newline) {
      const endOffset = r.tokens.starts[r.i] ?? src.length
      observeParserStatement('wardley', WARDLEY_TOKENS[kind]!.name, src.slice(start, endOffset), { offset: start, endOffset, unit: 'physical' })
    }
  }
  return ast
}
