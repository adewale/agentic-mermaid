/**
 * Integration tests for sequence diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { Resvg } from '@resvg/resvg-js'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { applyOutputSecurityPolicy, renderMermaidSVG } from '../index.ts'
import { DefaultBackend, getFamily } from '../agent/index.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import type { PositionedSequenceDiagram } from '../sequence/types.ts'

function lowerPublicSequence(positioned: ReturnType<typeof layoutSequenceDiagram>) {
  return getFamily('sequence')!.lowerScene!({ positioned, colors: { bg: '#ffffff', fg: '#111111', embedFontImport: false },
    resolved: { renderOptions: {} } })
}

describe('public Sequence lowering observations', () => {
  it('reads line presentation before marker selection and preserves the independently captured head', () => {
    const positioned = layoutSequenceDiagram(parseSequenceDiagram(['sequenceDiagram', 'A->>B: Hello']))
    const message = positioned.messages[0]!
    const reads: string[] = []
    let heads = 0
    Object.defineProperties(message, {
      lineStyle: { enumerable: true, configurable: true, get() { reads.push('line'); return 'solid' } },
      startHead: { enumerable: true, configurable: true, get() { reads.push('head'); return ++heads === 1 ? 'filled' : 'none' } },
    })
    const svg = DefaultBackend.render(lowerPublicSequence(positioned), { seed: 0 })
    expect(reads.slice(0, 2)).toEqual(['line', 'head'])
    expect(reads.filter(value => value === 'line')).toHaveLength(4)
    expect(svg).toContain('data-start-head="none"')
    expect(svg).toContain('marker-start="url(#seq-arrow)"')
    expect(Object.isFrozen(message)).toBe(false)
  })

  it('reports line-style failure before a competing start-head failure', () => {
    const positioned = layoutSequenceDiagram(parseSequenceDiagram(['sequenceDiagram', 'A->>B: Hello']))
    Object.defineProperties(positioned.messages[0]!, {
      lineStyle: { enumerable: true, get() { throw new Error('authored line-style failure') } },
      startHead: { enumerable: true, get() { throw new Error('later marker failure') } },
    })
    expect(() => lowerPublicSequence(positioned)).toThrow('authored line-style failure')
  })

  it('captures note actor metadata before position and preserves the later actor list value', () => {
    const positioned = layoutSequenceDiagram(parseSequenceDiagram(['sequenceDiagram', 'participant A', 'participant B', 'Note over A,B: note']))
    const note = positioned.notes[0]!
    const reads: string[] = []
    let actors = 0, positions = 0
    Object.defineProperties(note, {
      actors: { enumerable: true, configurable: true, get() { reads.push('actors'); return ++actors === 4 ? ['B'] : ['A'] } },
      position: { enumerable: true, configurable: true, get() { reads.push('position'); return ++positions === 3 ? 'right' : 'over' } },
    })
    const svg = DefaultBackend.render(lowerPublicSequence(positioned), { seed: 0 })
    expect(reads).toEqual(['actors', 'position', 'actors', 'actors', 'actors', 'position', 'position'])
    expect(svg).toContain('data-position="right" data-actors="B"')
    expect(Object.isFrozen(note)).toBe(false)
  })

  it('reads a block label before capturing the current block type', () => {
    const positioned = layoutSequenceDiagram(parseSequenceDiagram(['sequenceDiagram', 'loop Repeat', 'A->>B: Hello', 'end']))
    const block = positioned.blocks[0]!
    Object.defineProperty(block, 'label', { enumerable: true, configurable: true, get() { block.type = 'opt'; return 'Authored & <caption>' } })
    const svg = DefaultBackend.render(lowerPublicSequence(positioned), { seed: 0 })
    expect(svg).toContain('class="block" data-type="opt" data-label="Authored &amp; &lt;caption&gt;"')
    expect(Object.isFrozen(block)).toBe(false)
  })

  it('preserves native sparse actor traversal and escaped authored metadata', () => {
    const positioned = layoutSequenceDiagram(parseSequenceDiagram(['sequenceDiagram', 'participant A', 'participant B', 'Note over A,B: note']))
    const note = positioned.notes[0]!
    const authored: string[] = ['A&"', 'unused', 'B,comma']
    delete authored[1]
    const reads: string[] = []
    const actors = new Proxy(authored, {
      get(target, key, receiver) { reads.push(`get:${String(key)}`); return Reflect.get(target, key, receiver) },
      has(target, key) { reads.push(`has:${String(key)}`); return Reflect.has(target, key) },
    })
    Object.defineProperties(note, {
      actors: { enumerable: true, configurable: true, get() { reads.push('actors'); return actors } },
      position: { enumerable: true, configurable: true, get() { reads.push('position'); return 'over' } },
    })
    const svg = DefaultBackend.render(lowerPublicSequence(positioned), { seed: 0 })
    // Literal a9 observations: the initial identity join reads a hole, while
    // the later native map checks that slot without getting its absent value.
    expect(reads).toEqual(['actors', 'get:join', 'get:length', 'get:0', 'get:1', 'get:2', 'position',
      'actors', 'actors', 'get:length', 'actors', 'get:map', 'get:length', 'get:constructor',
      'has:0', 'get:0', 'has:1', 'has:2', 'get:2', 'position', 'position'])
    expect(svg).toContain('class="note" data-position="over" data-actors="A&amp;&quot;,,B,comma"')
    expect(Object.isFrozen(note)).toBe(false)
    expect(Object.isFrozen(authored)).toBe(false)
  })
})

const MESSAGE_FIELDS = ['label', 'lineStyle', 'startHead', 'endHead', 'centralStart', 'centralEnd', 'isSelf'] as const
type MessageField = typeof MESSAGE_FIELDS[number]
const MESSAGE_BASE = { label: 'Hello', lineStyle: 'solid', startHead: 'none', endHead: 'filled', centralStart: false, centralEnd: false, isSelf: false } as const
const MESSAGE_LEXICAL_GET = { label: 3, lineStyle: 3, startHead: 2, endHead: 2, centralStart: 1, centralEnd: 1, isSelf: 2 } as const
const MESSAGE_COUNTS = { label: 3, lineStyle: 4, startHead: 2, endHead: 2, centralStart: 2, centralEnd: 2, isSelf: 3 }
// Literal public a9 observations, not computed from a Scene recipe or writer.
const MESSAGE_READS = ['get:lineStyle:1', 'get:startHead:1', 'get:endHead:1', 'get:lineStyle:2', 'get:isSelf:1',
  'get:label:1', 'get:label:2', 'get:label:3', 'get:lineStyle:3', 'get:startHead:2', 'get:endHead:2',
  'get:centralStart:1', 'get:centralEnd:1', 'get:isSelf:2', 'get:isSelf:3', 'get:lineStyle:4', 'get:centralStart:2', 'get:centralEnd:2']

function observedPublicMessage(valueAt: (field: MessageField, count: number, reads: string[]) => unknown) {
  const layout = getFamily('sequence')!.layout!({ source: normalizeMermaidSource(
    'sequenceDiagram\n  participant A\n  participant B\n  A->>B: Hello'), renderOptions: {} })
  const positioned = ('positioned' in layout ? layout.positioned : layout) as PositionedSequenceDiagram
  expect(positioned.messages).toHaveLength(1)
  const message = positioned.messages[0]!
  expect(message.points).toHaveLength(2)
  const reads: string[] = []
  const counts = { label: 0, lineStyle: 0, startHead: 0, endHead: 0, centralStart: 0, centralEnd: 0, isSelf: 0 }
  for (const field of MESSAGE_FIELDS) {
    expect(message[field]).toBe(MESSAGE_BASE[field])
    Object.defineProperty(message, field, { enumerable: true, configurable: true, get() {
      const count = ++counts[field]
      reads.push(`get:${field}:${count}`)
      return valueAt(field, count, reads)
    } })
  }
  const descriptors = Object.getOwnPropertyDescriptors(message)
  return { positioned, message, reads, counts, descriptors }
}

function expectMessageCallerUnchanged(fixture: ReturnType<typeof observedPublicMessage>) {
  const { positioned, message, descriptors } = fixture
  for (const value of [positioned, positioned.messages, message, message.points, message.points[0], message.labelPosition]) {
    expect(Object.isFrozen(value)).toBe(false)
  }
  for (const field of MESSAGE_FIELDS) expect(Object.getOwnPropertyDescriptor(message, field)).toEqual(descriptors[field])
}

function securedObservedMessage(fixture: ReturnType<typeof observedPublicMessage>) {
  const svg = DefaultBackend.render(lowerPublicSequence(fixture.positioned), { seed: 0 })
  expect(applyOutputSecurityPolicy(svg, 'strict').diagnostics).toEqual([])
  expectMessageCallerUnchanged(fixture)
  return svg
}

describe('public Sequence message lexical capture', () => {
  const stateful = [
    ['label', 'Lexical & "caption"', 'data-label="Lexical &amp; &quot;caption&quot;"'],
    ['lineStyle', 'dashed', 'data-line-style="dashed"'],
    ['startHead', 'none', 'data-start-head="none"'],
    ['endHead', 'open', 'data-end-head="open"'],
    ['centralStart', true, 'data-central-start="true"'],
    ['centralEnd', true, 'data-central-end="true"'],
    ['isSelf', true, 'data-self="true"'],
  ] as const
  it.each(stateful)('captures lexical %s independently from message semantics', (selected, alternate, attribute) => {
    const fixture = observedPublicMessage((field, count) => {
      if (field === selected && count === MESSAGE_LEXICAL_GET[field]) return alternate
      if (selected === 'startHead' && field === 'startHead') return 'filled'
      return MESSAGE_BASE[field]
    })
    const svg = securedObservedMessage(fixture)
    const wrappers = svg.match(/<g class="message"[^>]*>/g) ?? []
    const connectors = (svg.match(/<(?:line|polyline)\b[^>]*>/g) ?? []).filter(tag => tag.includes('data-role="message"'))
    expect(wrappers).toHaveLength(1)
    expect(connectors).toHaveLength(1)
    expect(wrappers[0]).toContain(attribute)
    expect(fixture.reads).toEqual(MESSAGE_READS)
    expect(fixture.counts).toEqual(MESSAGE_COUNTS)
    const connector = connectors[0]!
    if (selected === 'label') expect(svg).toContain('>Hello<')
    if (selected === 'lineStyle') expect(connector).not.toContain('stroke-dasharray=')
    if (selected === 'startHead') expect(connector).toContain('marker-start="url(#seq-arrow)"')
    if (selected === 'endHead') expect(connector).toContain('marker-end="url(#seq-arrow)"')
    if (selected === 'centralStart' || selected === 'centralEnd') expect(svg).not.toContain('<circle class="sequence-central-connection"')
    if (selected === 'isSelf') expect(connector.startsWith('<line ')).toBe(true)
  })

  const firstErrors = [['label', 8], ['lineStyle', 9], ['startHead', 10], ['endHead', 11],
    ['centralStart', 12], ['centralEnd', 13], ['isSelf', 14]] as const
  it.each(firstErrors)('reports lexical %s failure before the next message read', (selected, prefixLength) => {
    const later = MESSAGE_FIELDS[MESSAGE_FIELDS.indexOf(selected) + 1]
    const fixture = observedPublicMessage((field, count) => {
      if (field === selected && count === MESSAGE_LEXICAL_GET[field]) throw new Error(`authored lexical ${field}`)
      if (field === later && count === MESSAGE_LEXICAL_GET[field] || selected === 'isSelf' && field === 'isSelf' && count === 3) {
        throw new Error(`later lexical ${field}`)
      }
      return MESSAGE_BASE[field]
    })
    expect(() => lowerPublicSequence(fixture.positioned)).toThrow(`authored lexical ${selected}`)
    expect(fixture.reads).toEqual(MESSAGE_READS.slice(0, prefixLength))
    expectMessageCallerUnchanged(fixture)
  })

  it.each([
    ['controls and quotes', 'A&"<tag>\'quote\tB\nC\rD\u0000E', 'data-label="A&amp;&quot;&lt;tag&gt;&#39;quote B&#10;C?D?E"'],
    ['astral and combining characters', '東京 👩‍💻 café e\u0301', 'data-label="東京 👩‍💻 café e\u0301"'],
  ])('retains the captured lexical label with %s', (_name, label, attribute) => {
    const fixture = observedPublicMessage((field, count) => field === 'label' && count === 3 ? label : MESSAGE_BASE[field])
    const svg = securedObservedMessage(fixture)
    expect(svg.match(/<g class="message"[^>]*>/g)).toHaveLength(1)
    expect(svg).toContain(attribute)
    expect(svg).toContain('>Hello<')
    expect(fixture.reads).toEqual(MESSAGE_READS)
    expect(fixture.counts).toEqual(MESSAGE_COUNTS)
  })

  // These deliberately violate PositionedMessage's field types. They retain
  // previously accepted native operations/fault order at the public hook;
  // they do not enlarge the typed Scene grammar or bypass final security.
  const malformedErrors = [
    ['lineStyle-coercion', 'Error', 'authored lexical lineStyle coercion', 9, 'coerce:lineStyle:string'],
    ['lineStyle-symbol', 'TypeError', 'Cannot convert a symbol to a string', 9, null],
    ['endHead-coercion', 'Error', 'authored lexical endHead coercion', 11, 'coerce:endHead:string'],
  ] as const
  it.each(malformedErrors)('preserves type-invalid native %s failure priority', (row, name, message, prefixLength, coercion) => {
    const fixture = observedPublicMessage((field, count, reads) => {
      if (field === 'lineStyle' && row.startsWith('lineStyle-')) {
        if (count === 3) return row === 'lineStyle-symbol' ? Symbol('lexical lineStyle') : {
          [Symbol.toPrimitive](hint: string) { reads.push(`coerce:lineStyle:${hint}`); throw new Error('authored lexical lineStyle coercion') },
        }
        if (count === 4) throw new Error('later child lineStyle')
      }
      if (row === 'endHead-coercion') {
        if (field === 'endHead' && count === 2) return {
          [Symbol.toPrimitive](hint: string) { reads.push(`coerce:endHead:${hint}`); throw new Error('authored lexical endHead coercion') },
        }
        if (field === 'isSelf' && count === 3) throw new Error('later child isSelf')
      }
      return MESSAGE_BASE[field]
    })
    let caught: unknown
    try { lowerPublicSequence(fixture.positioned) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    expect({ name: (caught as Error).name, message: (caught as Error).message }).toEqual({ name, message })
    expect(fixture.reads).toEqual([...MESSAGE_READS.slice(0, prefixLength), ...(coercion ? [coercion] : [])])
    expectMessageCallerUnchanged(fixture)
  })

  it('retains type-invalid native label.split acceptance with safe escaped output', () => {
    const fixture = observedPublicMessage((field, count, reads) => field === 'label' && count === 3 ? {
      split(separator: string) { reads.push(`native:label.split:${JSON.stringify(separator)}`); return ['Lexical & "split"'] },
    } : MESSAGE_BASE[field])
    const svg = securedObservedMessage(fixture)
    expect(svg).toContain('data-label="Lexical &amp; &quot;split&quot;"')
    expect(svg).toContain('>Hello<')
    expect(fixture.reads).toEqual([...MESSAGE_READS.slice(0, 8), 'native:label.split:"\\n"', ...MESSAGE_READS.slice(8)])
    expect(fixture.counts).toEqual(MESSAGE_COUNTS)
  })

  it('keeps a fresh public message independent after failed lexical capture', () => {
    const failed = observedPublicMessage((field, count) => {
      if (field === 'label' && count === 3) throw new Error('failed message capture')
      return MESSAGE_BASE[field]
    })
    expect(() => lowerPublicSequence(failed.positioned)).toThrow('failed message capture')
    expect(failed.reads).toEqual(MESSAGE_READS.slice(0, 8))
    expectMessageCallerUnchanged(failed)
    const fresh = observedPublicMessage(field => MESSAGE_BASE[field])
    const svg = securedObservedMessage(fresh)
    expect(svg).toContain('data-label="Hello" data-line-style="solid"')
    expect(fresh.reads).toEqual(MESSAGE_READS)
    expect(fresh.counts).toEqual(MESSAGE_COUNTS)
    expect(failed.reads).toEqual(MESSAGE_READS.slice(0, 8))
    expectMessageCallerUnchanged(failed)
  })

  it('keeps label display interpretation independent from an inherited display accessor', () => {
    // Separate process confines this authored prototype observation. Other
    // attributes retain their pre-existing optional-field behavior; this
    // accessor throws only when the message data-label loses its own flag.
    const program = `
      const { DefaultBackend, getFamily } = await import('./src/agent/index.ts')
      const { applyOutputSecurityPolicy } = await import('./src/index.ts')
      const { normalizeMermaidSource } = await import('./src/mermaid-source.ts')
      const { sceneAssertionsEnabled } = await import('./src/scene/assertions.ts')
      const expected = process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS
      if (!['0', '1'].includes(expected) || sceneAssertionsEnabled() !== (expected === '1')) throw new Error('actual child Scene mode differs')
      console.log('SEQUENCE_LABEL_DISPLAY_MODE ' + JSON.stringify({ actual: sceneAssertionsEnabled(), expected, environment: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS }))
      const family = getFamily('sequence')
      const layout = family.layout({ source: normalizeMermaidSource('sequenceDiagram\\n  A->>B: Hello'), renderOptions: {} })
      const positioned = 'positioned' in layout ? layout.positioned : layout
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'display')
      Object.defineProperty(Object.prototype, 'display', { configurable: true, get() {
        if (this.name === 'data-label') throw new Error('inherited message-label display')
        return undefined
      } })
      try {
        const scene = family.lowerScene({ positioned, colors: { bg: '#ffffff', fg: '#111111', embedFontImport: false }, resolved: { renderOptions: {} } })
        const svg = DefaultBackend.render(scene, { seed: 0 })
        if (!svg.includes('data-label="Hello"') || applyOutputSecurityPolicy(svg, 'strict').diagnostics.length) throw new Error('missing secured message label')
        console.log('SEQUENCE_LABEL_DISPLAY ' + JSON.stringify({ actual: sceneAssertionsEnabled(), expected, callerFrozen: Object.isFrozen(positioned.messages[0]), label: 'Hello' }))
      } finally {
        if (previous) Object.defineProperty(Object.prototype, 'display', previous)
        else delete Object.prototype.display
      }
    `
    const result = spawnSync(process.execPath, ['--eval', program], { cwd: join(import.meta.dir, '../..'), env: process.env, encoding: 'utf8', timeout: 30_000 })
    console.log('SEQUENCE_LABEL_DISPLAY_CHILD ' + JSON.stringify({ status: result.status, signal: result.signal,
      error: result.error ? { name: result.error.name, message: result.error.message, stack: result.error.stack } : null,
      stdout: result.stdout, stderr: result.stderr }))
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    const lines = result.stdout.split('\n').filter(line => line.startsWith('SEQUENCE_LABEL_DISPLAY '))
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!.slice('SEQUENCE_LABEL_DISPLAY '.length))).toEqual({
      actual: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS === '1', expected: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS, callerFrozen: false, label: 'Hello',
    })
  })
})

describe('renderMermaidSVG – sequence diagrams', () => {
  it('renders a basic sequence diagram to valid SVG', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      Alice->>Bob: Hello
      Bob-->>Alice: Hi there`)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Alice')
    expect(svg).toContain('Bob')
    expect(svg).toContain('Hello')
  })

  it('renders participant declarations', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      participant A as Alice
      participant B as Bob
      A->>B: Message`)
    expect(svg).toContain('Alice')
    expect(svg).toContain('Bob')
    expect(svg).toContain('Message')
  })

  it('renders actor circle-person icons', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      actor U as User
      participant S as System
      U->>S: Click`)
    // Actors use the circle-person icon (three paths inside a scaled <g>)
    expect(svg).toContain('<g transform="translate(')
    expect(svg).toContain('scale(')
    expect(svg).toContain('User')
    expect(svg).toContain('System')
  })

  it('renders dashed return arrows', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Request
      B-->>A: Response`)
    // Select each message's own line: the lifelines are always dashed, so a bare
    // `stroke-dasharray` search would pass for an all-solid diagram.
    const messageLine = (from: string, to: string) =>
      svg.match(new RegExp(`<line [^>]*data-from="${from}" data-to="${to}"[^>]*>`))?.[0]
    const request = messageLine('A', 'B')
    const response = messageLine('B', 'A')
    expect(request).toBeDefined()
    expect(response).toBeDefined()
    expect(request).not.toContain('stroke-dasharray')
    expect(response).toContain('stroke-dasharray="6 4"')
    expect(svg).toContain('Request')
    expect(svg).toContain('Response')
  })

  it('renders loop blocks', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Start
      loop Every 5s
        A->>B: Ping
      end`)
    expect(svg).toContain('loop')
    expect(svg).toContain('Every 5s')
  })

  it('renders alt/else blocks', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Request
      alt Success
        B->>A: 200
      else Error
        B->>A: 500
      end`)
    expect(svg).toContain('alt')
    expect(svg).toContain('Success')
    // Else divider (dashed line)
    expect(svg).toContain('Error')
  })

  it('renders notes', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Hello
      Note right of B: Think about response
      B-->>A: Hi`)
    expect(svg).toContain('Think about response')
  })

  it('renders with dark colors', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Hello`, { bg: '#18181B', fg: '#FAFAFA' })
    expect(svg).toContain('--bg:#18181B')
  })

  it('renders lifeline dashed lines', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Hello`)
    // Lifelines are dashed vertical lines
    const dashedLines = svg.match(/stroke-dasharray="6 4"/g) ?? []
    expect(dashedLines.length).toBeGreaterThanOrEqual(2) // at least 2 lifelines
  })

  it('renders a complex authentication flow', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      participant C as Client
      participant S as Server
      participant DB as Database
      C->>S: POST /login
      S->>DB: SELECT user
      alt User found
        DB-->>S: User record
        S-->>C: 200 OK + token
      else Not found
        DB-->>S: null
        S-->>C: 401 Unauthorized
      end`)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Client')
    expect(svg).toContain('Server')
    expect(svg).toContain('Database')
    expect(svg).toContain('POST /login')
  })

  const participants = 'participant A\nparticipant B\nparticipant C'
  for (const fixture of [
    { name: 'an ordinary message spanning a declared participant', source: `sequenceDiagram\n${participants}\nA->>C: Read Read`, options: {} },
    {
      name: 'numbered bidirectional multiline text with custom metrics',
      source: `sequenceDiagram\nautonumber 10 2\n${participants}\nA<<->>C: Read Read<br/>More More`,
      options: { style: { font: 'DejaVu Sans', roles: { edge: { fontSize: 18, fontWeight: 600, letterSpacing: 1 } } } },
      numbered: true,
    },
    { name: 'an active intervening participant', source: `sequenceDiagram\n${participants}\nA->>+B: Open\nA->>C: Read Read\nB-->>-A: Close`, options: {} },
    {
      name: 'a colored box with nested translucent backgrounds',
      source: `sequenceDiagram\nbox CornflowerBlue Services\n${participants}\nend\nrect rgba(255,0,0,0.25)\nrect rgba(0,200,150,0.3)\nA->>C: Read\u2003Read\nend\nend`,
      options: {},
      preserveSurface: true,
    },
    { name: 'transparent output', source: `sequenceDiagram\n${participants}\nA->>C: Read\u2003Read`, options: { transparent: true }, preserveSurface: true },
    {
      name: 'transparent output with nested translucent backgrounds',
      source: `sequenceDiagram\n${participants}\nrect rgba(255,0,0,0.25)\nrect rgba(0,200,150,0.3)\nA->>C: Read\u2003Read\nend\nend`,
      options: { transparent: true },
      preserveSurface: true,
    },
  ] as const) {
    it(`keeps intervening structural ink out of the full message label envelope for ${fixture.name}`, () => {
      const svg = renderMermaidSVG(fixture.source, { ...fixture.options, embedFontImport: false })
      const label = [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].find(match => match[0].replace(/<[^>]+>/g, '').replace(/\u2003/g, ' ').includes('Read Read'))?.[0]
      expect(label).toBeDefined()
      if ('numbered' in fixture) {
        expect(label!.replace(/<[^>]+>/g, '')).toContain('10. Read Read')
        const arrow = svg.match(/<line\b[^>]*data-from="A"[^>]*data-to="C"[^>]*>/)?.[0]
        expect(arrow).toContain('marker-start=')
        expect(arrow).toContain('marker-end=')
        expect(label!.replace(/<[^>]+>/g, '')).toContain('More More')
      }
      // Measure the emitted glyphs with bundled fonts, independently of the
      // layout's bounds. Remove halos from this ownership raster only.
      const glyphs = label!.replace(/<(?:text|tspan)\b[^>]*>/g, tag => tag
        .replace(/\s(?:stroke|stroke-width|paint-order)="[^"]*"/g, '')
        .replace(/\sfill="[^"]*"/g, ' fill="#000000"'))
      const textOnly = svg.match(/<svg\b[^>]*>/)![0] + [...svg.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(match => match[0]).join('') + glyphs + '</svg>'
      const raster = (source: string) => {
        const image = new Resvg(source, {
          fitTo: { mode: 'zoom', value: 2 },
          font: { loadSystemFonts: false, fontDirs: [join(import.meta.dir, '..', '..', 'assets', 'fonts')], defaultFontFamily: 'Inter' },
        }).render()
        return { width: image.width, height: image.height, pixels: image.pixels }
      }
      const ownership = raster(textOnly)
      let left = ownership.width, right = -1, top = ownership.height, bottom = -1
      for (let y = 0; y < ownership.height; y++) {
        for (let x = 0; x < ownership.width; x++) {
          if (ownership.pixels[(y * ownership.width + x) * 4 + 3]! === 0) continue
          left = Math.min(left, x); right = Math.max(right, x)
          top = Math.min(top, y); bottom = Math.max(bottom, y)
        }
      }
      expect(right).toBeGreaterThan(left)
      expect(bottom).toBeGreaterThan(top)
      const actorB = svg.match(/<g\b[^>]*class="actor"[^>]*data-id="B"[^>]*>\s*<rect\b([^>]*)>/)![1]!
      const actorX = Number(actorB.match(/\bx="([^"]+)"/)![1]) + Number(actorB.match(/\bwidth="([^"]+)"/)![1]) / 2
      expect(actorX * 2).toBeGreaterThan(left)
      expect(actorX * 2).toBeLessThan(right)
      // Hide every B-owned structural mark, including all split spans or a
      // compound activation wrapper. No particular masking strategy is required.
      const withoutB = svg.replace(/<[\w:-]+\b(?=[^>]*\bclass="(?:lifeline|activation)")(?=[^>]*\bdata-actor="B")[^>]*>/g,
        tag => tag.replace(/\s*\/?>$/, ending => ` visibility="hidden"${ending}`))
      const backgroundOnly = withoutB.replace(/<g\b[^>]*\bclass="message"[^>]*>/g,
        tag => tag.replace(/>$/, ' visibility="hidden">'))
      const actual = raster(svg), reference = raster(withoutB), background = raster(backgroundOnly)
      let labelDifferences = 0, outsideDifferences = 0, surfaceDifferences = 0, surfaceSamples = 0
      for (let y = 0; y < actual.height; y++) {
        for (let x = 0; x < actual.width; x++) {
          const offset = (y * actual.width + x) * 4
          const inside = x >= left && x <= right && y >= top && y <= bottom
          const differs = [0, 1, 2, 3].some(channel => actual.pixels[offset + channel] !== reference.pixels[offset + channel])
          if (differs) { if (inside) labelDifferences++; else outsideDifferences++ }
          // Keep the existing authored-surface text halo out of this check.
          // An em-space supplies samples beyond its three-user-unit fringe.
          let clearOfGlyphs = inside && 'preserveSurface' in fixture && ownership.pixels[offset + 3] === 0
          for (let dy = -6; clearOfGlyphs && dy <= 6; dy++) {
            for (let dx = -6; dx <= 6; dx++) {
              const xx = x + dx, yy = y + dy
              if (xx >= 0 && xx < actual.width && yy >= 0 && yy < actual.height && ownership.pixels[(yy * actual.width + xx) * 4 + 3]! > 0) { clearOfGlyphs = false; break }
            }
          }
          if (clearOfGlyphs) {
            surfaceSamples++
            if ([0, 1, 2, 3].some(channel => actual.pixels[offset + channel] !== background.pixels[offset + channel])) surfaceDifferences++
          }
        }
      }
      expect(labelDifferences, 'lifelines and activations must contribute no ink inside the label envelope').toBe(0)
      expect(outsideDifferences, 'the intervening participant remains visible outside the label envelope').toBeGreaterThan(0)
      if ('preserveSurface' in fixture) {
        expect(surfaceSamples).toBeGreaterThan(0)
        expect(surfaceDifferences, 'label whitespace beyond the existing text halo preserves underlying color and alpha').toBe(0)
      }
    })
  }
})
