// Write strictly, read generously, warn. Where pinned Mermaid 11.16 rejects a
// construct whose meaning is clear, ours reads it: the typed parser models it,
// the renderer draws it, and verify reports UNSUPPORTED_SYNTAX naming the
// construct on its authored line. The accepted neighbours (the quoted form, a
// statement after the header) must parse typed and render, and the typed
// serializer must write source Mermaid accepts.

import { afterAll, describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import type { BuiltinFamilyId } from '../agent/families.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

/** Ours on one source: the typed body kind, and the render error if any. */
function ours(source: string): { typed: string; error: string | undefined } {
  const parsed = parseRegisteredMermaid(source)
  let error: string | undefined
  try {
    renderMermaidSVG(source)
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  return { typed: parsed.ok ? parsed.value.body.kind : 'parse error', error }
}

/** Ours on source Mermaid rejects: the typed body kind, whether the render
 * draws `text`, and each UNSUPPORTED_SYNTAX verify reports as `syntax@line`. */
function readGenerously(source: string, text: string): { typed: string; draws: boolean; reported: string[] } {
  const parsed = parseRegisteredMermaid(source)
  return {
    typed: parsed.ok ? parsed.value.body.kind : 'parse error',
    draws: renderMermaidSVG(source).includes(text),
    reported: verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : []),
  }
}

// [construct, source, text the render draws, syntax verify reports, its line]
type GenerousRow = readonly [string, string, string, string, number]

const CLASS_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a bare header', 'classDiagram', '<svg', 'class_empty_diagram', 1],
  ['a header followed only by a comment', 'classDiagram\n  %% nothing yet', '<svg', 'class_empty_diagram', 1],
  ['a frontmatter title over a bare header', '---\ntitle: Pets\n---\nclassDiagram', '<svg', 'class_empty_diagram', 4],
  // A `%%` comment where the class lexer reads `%` as punctuation.
  ['a comment after a class declaration', 'classDiagram\n  class Animal %% note', 'Animal', 'class_trailing_comment', 2],
  ['a comment after a labelled declaration', 'classDiagram\n  class Animal["Pet"] %% note', 'Pet', 'class_trailing_comment', 2],
  ['a comment after a class body', 'classDiagram\n  class Animal {\n    +name\n  } %% note', 'Animal', 'class_trailing_comment', 4],
  ['a comment on a namespace line', 'classDiagram\n  namespace Zoo { %% note\n    class Animal\n  }', 'Zoo', 'class_trailing_comment', 2],
  ['a comment inside a namespace', 'classDiagram\n  namespace Zoo {\n    class Animal\n    note "Pets" %% note\n  }', 'Pets', 'class_trailing_comment', 4],
  ['a comment after a namespace', 'classDiagram\n  namespace Zoo {\n    class Animal\n  } %% note', 'Animal', 'class_trailing_comment', 4],
  // A `%%` comment swallows the line break, joining the next statement on.
  ['a commented relationship before another statement', 'classDiagram\n  Animal <|-- Dog %% note\n  class Cat', 'Dog', 'class_trailing_comment', 2],
  ['a commented note before another statement', 'classDiagram\n  note "Pets" %% note\n  class Cat', 'Pets', 'class_trailing_comment', 2],
  ['a commented link before another statement', 'classDiagram\n  class Animal\n  link Animal "https://example.com" %% note\n  class Cat', 'https://example.com', 'class_trailing_comment', 3],
]

// Unquoted quadrant text Mermaid's quadrant lexer does not read as text.
const QUADRANT_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a < in an unquoted point label', 'quadrantChart\n  A < B: [0.3, 0.4]', 'A &lt; B', 'quadrant_unquoted_text', 2],
  ['a < in unquoted axis text', 'quadrantChart\n  x-axis Low < High', 'Low &lt; High', 'quadrant_unquoted_text', 2],
  ['a <br/> in an unquoted quadrant label', 'quadrantChart\n  quadrant-1 Grow<br/>fast', 'fast', 'quadrant_unquoted_text', 2],
  ['brackets in an unquoted point label', 'quadrantChart\n  A [x]: [0.3, 0.4]', 'A [x]', 'quadrant_unquoted_text', 2],
  ['parentheses in unquoted axis text', 'quadrantChart\n  y-axis Low (cheap) --> High', 'Low (cheap)', 'quadrant_unquoted_text', 2],
  ['a second arrow in axis text', 'quadrantChart\n  x-axis Low --> Mid --> High', 'Mid --&gt; High', 'quadrant_unquoted_text', 2],
  ['a colon in an unquoted quadrant label', 'quadrantChart\n  quadrant-1 Grow: fast', 'Grow: fast', 'quadrant_unquoted_text', 2],
  ['a string after unquoted text', 'quadrantChart\n  title Growth\n  quadrant-1 Grow "fast"', 'Grow', 'quadrant_unquoted_text', 3],
]

// Mermaid's architecture lexer terminals: an unquoted [title] is words and
// spaces, an (icon) is word characters, - and :, an id has dashes only inside.
const ARCHITECTURE_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a <br/> in an unquoted service title', 'architecture-beta\n  service api(server)[Public<br/>API]', 'Public', 'architecture_title', 2],
  ['a dash in an unquoted group title', 'architecture-beta\n  group edge(cloud)[Edge-Layer]', 'Edge-Layer', 'architecture_title', 2],
  ['a non-ASCII letter in an unquoted title', 'architecture-beta\n  service db(database)[Café]', 'Café', 'architecture_title', 2],
  ['a dash in an unquoted edge title', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R -[fan-out]-> L:b', 'fan-out', 'architecture_title', 4],
  ['text after a quoted title', 'architecture-beta\n  service api(server)["Public" API]', 'API', 'architecture_title', 2],
  ['a dot in an icon name', 'architecture-beta\n  service api(se.rver)[API]', 'data-icon="se.rver"', 'architecture_icon', 2],
  ['a space in an icon name', 'architecture-beta\n  service api(my server)[API]', 'data-icon="my server"', 'architecture_icon', 2],
  ['an id ending in a dash', 'architecture-beta\n  service api-(server)[API]', 'API', 'architecture_id', 2],
  ['an id starting with a dash', 'architecture-beta\n  junction -hub', '-hub', 'architecture_id', 2],
]

// [family, construct, source]
const ACCEPTED: ReadonlyArray<readonly [BuiltinFamilyId, string, string]> = [
  ['class', 'one class after the header', 'classDiagram\n  class Animal'],
  ['class', 'an accTitle after the header', 'classDiagram\n  accTitle: Pets'],
  ['class', 'a comment after the last relationship', 'classDiagram\n  class Cat\n  Animal <|-- Dog %% note'],
  ['class', 'a comment after the last note', 'classDiagram\n  class Animal\n  note for Animal "Pets" %% note'],
  ['class', 'a comment after the last separate annotation', 'classDiagram\n  class Animal\n  <<interface>> Animal %% note'],
  ['class', '%% inside a quoted class label', 'classDiagram\n  class Animal["50 %% off"]\n  class Cat'],
  ['class', '%% inside a member', 'classDiagram\n  class Animal {\n    +name %% note\n  }\n  class Cat'],
  ['class', '%% inside a relationship label', 'classDiagram\n  Animal <|-- Dog : is a %% note\n  class Cat'],
  ['quadrant', 'a < in a quoted point label', 'quadrantChart\n  "A < B": [0.3, 0.4]'],
  ['quadrant', 'a < in quoted axis text', 'quadrantChart\n  x-axis "Low < x" --> "High"'],
  ['quadrant', 'a <br/> in a quoted quadrant label', 'quadrantChart\n  quadrant-1 "Grow<br/>fast"'],
  ['quadrant', 'text after a leading string', 'quadrantChart\n  quadrant-1 "Grow" fast'],
  ['quadrant', 'a < in a title, which runs to the end of its line', 'quadrantChart\n  title Cost < Value'],
  ['quadrant', 'unquoted punctuation the lexer reads as text', "quadrantChart\n  Q&A #1 isn't 50% off?: [0.3, 0.4]\n  a/b = c+d*e, f.g_h\\i `j` !k: [0.5, 0.5]"],
  ['architecture', 'a <br/> in a double-quoted title', 'architecture-beta\n  service api(server)["Public<br/>API"]'],
  ['architecture', 'a <br/> in a single-quoted title', "architecture-beta\n  service api(server)['Public<br/>API']"],
  ['architecture', 'an escaped quote in a quoted title', 'architecture-beta\n  group edge(cloud)["The \\"edge\\" layer"]'],
  ['architecture', 'a quoted edge title', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R -["fan-out"]-> L:b'],
  ['architecture', 'words, digits, _ and spaces unquoted', 'architecture-beta\n  service db_1(database)[Primary DB 2]\n  junction hub-a'],
  ['architecture', 'an icon with a prefix and dashes', 'architecture-beta\n  service fn(logos:aws-lambda)[Handler]'],
]

describe('read generously what pinned Mermaid rejects, and warn', () => {
  test.each(CLASS_READ_GENEROUSLY)('class: %s is read, drawn and reported', (_construct, source, text, syntax, line) => {
    expect(readGenerously(source, text)).toEqual({ typed: 'class', draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })

  test.each(QUADRANT_READ_GENEROUSLY)('quadrant: %s is read, drawn and reported', (_construct, source, text, syntax, line) => {
    expect(readGenerously(source, text)).toEqual({ typed: 'quadrant', draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })

  test.each(ARCHITECTURE_READ_GENEROUSLY)('architecture: %s is read, drawn and reported', (_construct, source, text, syntax, line) => {
    expect(readGenerously(source, text)).toEqual({ typed: 'architecture', draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })
})

describe('accept what pinned Mermaid accepts', () => {
  test.each(ACCEPTED)('%s: %s is accepted, as Mermaid accepts it', async (family, _construct, source) => {
    expect({ mermaid: (await upstream.parse(source)).ok, ...ours(source) })
      .toEqual({ mermaid: true, typed: family, error: undefined })
  })

  // The typed serializer must write what Mermaid reads: text that is only
  // legal quoted stays quoted, and the body reads back unchanged.
  test.each(ACCEPTED)('%s: %s serializes to source Mermaid accepts', async (_family, _construct, source) => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`)
    const serialized = serializeMermaid(parsed.value)
    const reparsed = parseRegisteredMermaid(serialized)
    expect({ serialized, mermaid: (await upstream.parse(serialized)).ok, body: reparsed.ok && reparsed.value.body })
      .toEqual({ serialized, mermaid: true, body: parsed.value.body })
  })

  test('typed architecture titles are what Mermaid reads: no quotes, escapes resolved', async () => {
    const source = 'architecture-beta\n  group edge(cloud)["The \\"edge\\" layer"]\n  service api(server)[\'Public-API\'] in edge\n  service db(database)[ Primary DB ] in edge\n  api:R -["reads, writes"]-> L:db'
    const mermaid = JSON.parse((await upstream.database(source)) ?? '{}') as {
      getGroups?: Array<{ id: string; title: string }>
      getServices?: Array<{ id: string; title: string }>
      getEdges?: Array<{ title?: string }>
    }
    const parsed = parseRegisteredMermaid(source)
    const body = parsed.ok && parsed.value.body.kind === 'architecture' ? parsed.value.body : undefined
    expect({
      groups: body?.groups.map(group => [group.id, group.label]),
      services: body?.services.map(service => [service.id, service.label]),
      edges: body?.edges.map(edge => edge.label),
    }).toEqual({
      groups: mermaid.getGroups?.map(group => [group.id, group.title]),
      services: mermaid.getServices?.map(service => [service.id, service.title]),
      edges: mermaid.getEdges?.map(edge => edge.title),
    })
  })
})
