// Write strictly, read generously, warn. Where pinned Mermaid rejects a
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
  // A keyword where a word can start is a token of its own upstream.
  ['a keyword in an unquoted quadrant label', 'quadrantChart\n  quadrant-1 Grow x-axis fast', 'Grow x-axis fast', 'quadrant_unquoted_text', 2],
  ['a quadrant keyword glued to a digit', 'quadrantChart\n  quadrant-1 a quadrant-12', 'a quadrant-12', 'quadrant_unquoted_text', 2],
  ['a keyword after non-ASCII text', 'quadrantChart\n  quadrant-1 拡張 QuaDrant-1 要', '拡張 QuaDrant-1 要', 'quadrant_unquoted_text', 2],
  ['title after an underscore in a point label', 'quadrantChart\n  Low_title: [0.3, 0.4]', 'Low_title', 'quadrant_unquoted_text', 2],
  ['the header keyword in axis text', 'quadrantChart\n  y-axis quadrantChart low --> high', 'quadrantChart low', 'quadrant_unquoted_text', 2],
]

// Unquoted XYChart text (a title, an axis title, a series label or a
// category) takes ASCII letters, digits, whitespace and &+=*.#_- in Mermaid's
// lexer; in an axis title a digit starts a range number. A keyword where a
// word can start ends the text. A single quote opens no string there.
const XYCHART_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['parentheses in an unquoted axis title before a range', 'xychart-beta\n  x-axis [a, b]\n  y-axis Revenue (USD) 0 --> 100\n  bar [10, 20]', 'Revenue (USD)', 'xychart_unquoted_axis_title', 3],
  ['a percent sign in an unquoted axis title', 'xychart-beta\n  y-axis Share in % 0 --> 100\n  bar [10, 20]', 'Share in %', 'xychart_unquoted_axis_title', 2],
  ['a comma in an unquoted axis title', 'xychart-beta\n  x-axis cat, dog\n  bar [10, 20]', 'cat, dog', 'xychart_unquoted_axis_title', 2],
  ['a digit in an unquoted axis title before categories', 'xychart-beta\n  x-axis Q1 [a, b] bar [10, 20]', 'Q1', 'xychart_unquoted_axis_title', 2],
  ['a keyword in an unquoted axis title', 'xychart-beta\n  x-axis Sales by line item [a, b]\n  bar [10, 20]', 'Sales by line item', 'xychart_unquoted_axis_title', 2],
  ['an orientation in an unquoted axis title', 'xychart-beta\n  y-axis Revenue horizontal 0 --> 100\n  bar [10, 20]', 'Revenue horizontal', 'xychart_unquoted_axis_title', 2],
  ['a single-quoted axis title', "xychart-beta\n  x-axis 'Rev' [a, b]\n  bar [10, 20]", 'Rev', 'xychart_unquoted_axis_title', 2],
  ['parentheses in an unquoted chart title', 'xychart-beta\n  title Sales (2024)\n  bar [10, 20]', 'Sales (2024)', 'xychart_unquoted_text', 2],
  ['a comma in an unquoted chart title', 'xychart-beta\n  title Sales, by region\n  bar [10, 20]', 'Sales, by region', 'xychart_unquoted_text', 2],
  ['an orientation in an unquoted chart title', 'xychart-beta\n  title My vertical chart\n  bar [10, 20]', 'My vertical chart', 'xychart_unquoted_text', 2],
  ['a keyword in an unquoted series label', 'xychart-beta\n  bar Product line A [10, 20]', '<svg', 'xychart_unquoted_text', 2],
  ['a keyword after an underscore in a series label', 'xychart-beta\n  bar total_line [10, 20]', '<svg', 'xychart_unquoted_text', 2],
  ['a slash in an unquoted series label', 'xychart-beta\n  line Trend/avg [10, 20]', '<svg', 'xychart_unquoted_text', 2],
  ['parentheses in an unquoted category', 'xychart-beta\n  x-axis [Q1 (a), b]\n  bar [10, 20]', 'Q1 (a)', 'xychart_unquoted_text', 2],
  ['a non-ASCII letter in an unquoted category', 'xychart-beta\n  x-axis [café, b]\n  bar [10, 20]', 'café', 'xychart_unquoted_text', 2],
  ['an orientation in an unquoted category', 'xychart-beta\n  x-axis [a vertical, b]\n  bar [10, 20]', 'a vertical', 'xychart_unquoted_text', 2],
]

// Mermaid's architecture lexer terminals: an (icon) is word characters, -
// and :, an id has dashes only inside. Unquoted titles now accept punctuation.
const ARCHITECTURE_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a nested bracket in an unquoted title', 'architecture-beta\n  service api(server)[Public[API]]', 'Public[API]', 'architecture_title', 2],
  ['a dot in an icon name', 'architecture-beta\n  service api(se.rver)[API]', 'data-icon="se.rver"', 'architecture_icon', 2],
  ['a space in an icon name', 'architecture-beta\n  service api(my server)[API]', 'data-icon="my server"', 'architecture_icon', 2],
  ['an id ending in a dash', 'architecture-beta\n  service api-(server)[API]', 'API', 'architecture_id', 2],
  ['an id starting with a dash', 'architecture-beta\n  junction -hub', '-hub', 'architecture_id', 2],
  ['an id ending in a dash before a title across lines', 'architecture-beta\n  service api-(server)["Public\n  API"]', 'Public', 'architecture_id', 2],
]

// Mermaid's mindmap lexer ends a shape at its first closing delimiter. Ours
// reads delimiters paired inside the text up to the outermost pair's close.
const MINDMAP_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['parentheses paired inside circle text', 'mindmap\n  root((a (b) c))', 'a (b) c', 'mindmap_nested_shape_delimiters', 2],
  ['parentheses inside an anonymous rect', 'mindmap\n  root\n    [text (x)]', 'text (x)', 'mindmap_nested_shape_delimiters', 3],
  ['parentheses paired inside cloud text', 'mindmap\n  root\n    id)a (b) c(', 'a (b) c', 'mindmap_nested_shape_delimiters', 3],
  ['brackets paired in text across lines', 'mindmap\n  root[a\n  [b] c]', '[b] c', 'mindmap_nested_shape_delimiters', 2],
  // Mermaid's lexer reads the space after the header, with its line break,
  // as one token that its grammar accepts there only before a line break.
  ['a blank line after the header', 'mindmap\n  \n    root[The r\r\noot]\n    :::m-4 p-8', 'oot', 'mindmap_space_after_header', 1],
  ['whitespace ending the header line', '%% lead\nmindmap \n  root', 'root', 'mindmap_space_after_header', 2],
  // Mermaid's mindmap has no accessibility statements: before the root, the line is a second root.
  ['an accTitle before the root', 'mindmap\n  accTitle: Ideas\n  root', 'root', 'mindmap_accessibility', 2],
  ['an accDescr block before the root', 'mindmap\n  accDescr {\n    About\n  }\n  root', 'root', 'mindmap_accessibility', 2],
]

// A composite Mermaid's state DB refuses a second label for ("Group nodes can
// only have label"); ours continues the one composite, its labels as lines.
const STATE_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a composite labelled in two blocks', 'stateDiagram-v2\n  state "First" as A {\n    x\n  }\n  state "Second" as A {\n    y\n  }', 'Second', 'state_composite_description', 5],
]

// Mermaid's GitGraph lexer reads id:, msg:, tag: and parent: only with a
// quoted string, and a bare branch name only from its REFERENCE terminal.
const GITGRAPH_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['an apostrophe in an unquoted branch name', "gitGraph\n  commit\n  branch dev's\n  commit", 'dev&#39;s', 'gitgraph_branch_name', 3],
  ['an unquoted commit id', 'gitGraph\n  commit id: abc', 'abc', 'gitgraph_unquoted_value', 2],
  ['an unquoted commit tag', 'gitGraph\n  commit tag: v1', 'v1', 'gitgraph_unquoted_value', 2],
  ['an unquoted merge id', 'gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev id: m1', 'm1', 'gitgraph_unquoted_value', 6],
]

// C4 reader extensions to Mermaid's C4 grammar, each named by a stable code.
const C4_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a semicolon between statements', 'C4Context\n  Person(a, "Ann"); Person(b, "Bob")', 'Bob', 'c4_semicolon_separator', 2],
  ['two statements on one line', 'C4Context\n  Person(a, "Ann") Person(b, "Bob")', 'Bob', 'c4_statements_on_one_line', 2],
  ['a line break between arguments', 'C4Context\n  Person(a,\n    "Ann")', 'Ann', 'c4_multiline_arguments', 2],
  ['an empty named argument', 'C4Context\n  Person(a, "Ann", $descr="")', 'Ann', 'c4_empty_named_argument', 2],
  ['an empty boundary', 'C4Context\n  Person(a, "Ann")\n  System_Boundary(b, "Bank") {\n  }', 'Bank', 'c4_empty_boundary', 3],
  ['a standalone direction', 'C4Context\n  direction LR\n  Person(a, "Ann")', 'Ann', 'c4_direction', 2],
  ['a legend directive', 'C4Context\n  Person(a, "Ann")\n  SHOW_LEGEND()', 'Ann', 'c4_directive_extension', 3],
  // Mermaid's C4 lexer reads unquoted argument text up to the next comma, so
  // after the last comma it takes the closing parenthesis too.
  ['an unquoted last argument', 'C4Context\n  Person(a, Ann Lee)', 'Ann Lee', 'c4_unquoted_argument', 2],
  ['a space before the closing parenthesis', 'C4Context\n  Person(a, "Ann" )', 'Ann', 'c4_unquoted_argument', 2],
  ['a space before a boundary\'s closing parenthesis', 'C4Context\n  System_Boundary(b, "Bank", ) {\n    Person(a, "Ann")\n  }', 'Bank', 'c4_unquoted_argument', 2],
  ['an unquoted named value', 'C4Context\n  Person(a, "Ann", $descr=Banker, $link="https://example.com")', 'Banker', 'c4_unquoted_argument', 2],
]

// C4 arguments whose quotes Mermaid's lexer pairs differently from ours
// have no clear meaning: like an unknown argument, the statement is retained
// as source and the render refuses it. [construct, source, line]
const C4_UNREADABLE: ReadonlyArray<readonly [string, string, number]> = [
  ['text glued to a closing quote', 'C4Container\n  Container(c, "C"web_app $techn="Java")', 2],
  ['text glued to a named value', 'C4Context\n  Person(a, "A")\n  Rel(a, a, "uses", $tags="async"sign)', 3],
  ['a $ without name="text"', 'C4Context\n  System(s, "S", "desc", $tags=tags="cylinder")', 2],
  ['quotes in an unquoted last argument', 'C4Context\n  Person(a, link="https://example.com")', 2],
  ['a comma between quotes in unquoted text', 'C4Context\n  Person(a, "", SMTP"A customer, with accounts.")', 2],
]

// When a comma follows, Mermaid's lexer reads on past the closing parenthesis
// and takes the next statement into the argument: it accepts the diagram but
// reads one element where ours reads two. [construct, source, syntax, line]
const C4_READ_OTHERWISE: ReadonlyArray<readonly [string, string, string, number]> = [
  ['an unquoted last argument before another statement', 'C4Context\n  Person(a, Ann)\n  Person(b, "Bob")', 'c4_unquoted_argument', 2],
  ['text glued to a closing quote before another statement', 'C4Context\n  Person(a, "Ann"x)\n  Person(b, "Bob")', 'c4_argument_quoting', 2],
]

// [family, construct, source]
const ACCEPTED:ReadonlyArray<readonly [BuiltinFamilyId, string, string]> = [
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
  ['quadrant', 'keywords inside longer words, and quoted', 'quadrantChart\n  x-axis Titles --> "Low x-axis"\n  quadrant-1 classDefinitely\n  quadrant-2 subtitle'],
  ['quadrant', 'unquoted punctuation the lexer reads as text', "quadrantChart\n  Q&A #1 isn't 50% off?: [0.3, 0.4]\n  a/b = c+d*e, f.g_h\\i `j` !k: [0.5, 0.5]"],
  ['architecture', 'a <br/> in a double-quoted title', 'architecture-beta\n  service api(server)["Public<br/>API"]'],
  ['architecture', 'a <br/> in a single-quoted title', "architecture-beta\n  service api(server)['Public<br/>API']"],
  ['architecture', 'an escaped quote in a quoted title', 'architecture-beta\n  group edge(cloud)["The \\"edge\\" layer"]'],
  ['architecture', 'a quoted edge title', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R -["fan-out"]-> L:b'],
  ['architecture', 'words, digits, _ and spaces unquoted', 'architecture-beta\n  service db_1(database)[Primary DB 2]\n  junction hub-a'],
  ['architecture', 'an icon with a prefix and dashes', 'architecture-beta\n  service fn(logos:aws-lambda)[Handler]'],
  ['architecture', 'a <br/> in an unquoted service title', 'architecture-beta\n  service api(server)[Public<br/>API]'],
  ['architecture', 'a dash in an unquoted group title', 'architecture-beta\n  group edge(cloud)[Edge-Layer]'],
  ['architecture', 'a non-ASCII letter in an unquoted title', 'architecture-beta\n  service db(database)[Café]'],
  ['architecture', 'a dash in an unquoted edge title', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R -[fan-out]-> L:b'],
  ['architecture', 'text after a quoted title', 'architecture-beta\n  service api(server)["Public" API]'],
  ['xychart', 'unquoted punctuation the lexer reads as axis text', 'xychart-beta\n  x-axis R&D + Sales = *.#_- [a, b]\n  y-axis Monthly totals 0 --> 100\n  bar [10, 20]'],
  ['xychart', 'punctuation and digits in quoted axis titles', 'xychart-beta\n  x-axis "Q1 (est), 50%" [a, b]\n  y-axis "Revenue (USD)" 0 --> 100\n  bar [10, 20]'],
  ['xychart', 'digits, and keywords inside longer words, unquoted', 'xychart-beta\n  title 2024 bars and lines\n  x-axis [1 a, titles, b]\n  bar baseline [10, 20, 30]'],
  ['xychart', 'punctuation in a quoted title, category and series label', 'xychart-beta\n  title "Sales (2024), by region"\n  x-axis ["Q1 (a)", "café"]\n  bar "Product line A" [10, 20]'],
  // A quoted string runs to its closing quote across line breaks.
  ['pie', 'a label across lines', 'pie\n  "multi\n  label" : 1\n  "b" : 2'],
  ['quadrant', 'quoted text across lines', 'quadrantChart\n  x-axis "Low\n  reach" --> High\n  quadrant-1 "Expand\n  now"\n  "Point\n  A": [0.3, 0.6]'],
  ['quadrant', 'a point across lines', 'quadrantChart\n  A: [0.3,\n  0.6]'],
  ['gitgraph', 'quoted attributes and branch names', 'gitGraph\n  commit id: "a" tag: \'v1\'\n  branch "dev x"\n  commit msg: "hi"\n  branch feature/x-1.2\n  commit\n  branch dev-\n  commit'],
  ['gitgraph', 'quoted text across lines', 'gitGraph\n  commit id: "a\n  b" msg: "multi\n  line" tag: "v1\n  rc"\n  commit "bare\n  msg"\n  branch dev\n  commit\n  checkout main\n  merge dev tag: "x\n  y"'],
  ['architecture', 'quoted titles across lines', 'architecture-beta\n  group g(cloud)["G\n  H"]\n  service a(server)["line1\n  line2"] in g\n  service b(server)[\'sq\n  line\'] in g\n  a:R -["multi\n  line"]- L:b'],
  ['radar', 'a quoted axis label across lines', 'radar-beta\n  axis a["A\n  long"], b, c\n  curve x{1, 2, 3}'],
  ['mindmap', 'delimiters Mermaid reads as shape text', 'mindmap\n  (a [b)\n    ["text (x)"]\n    c{{d [e}}'],
  // Mermaid removes a `%%` line with the blank lines before it.
  ['mindmap', 'a blank line before a comment after the header', 'mindmap\n\n%% c\n  root\n\n    a'],
  ['c4', 'an unquoted argument before a comma', 'C4Context\n  Person(a, Ann Lee, "A customer")'],
  ['c4', 'an empty slot before the closing parenthesis', 'C4Context\n  Person(a, "Ann",)'],
  ['c4', 'spaces around a named argument\'s equals sign', 'C4Context\n  Person(a, "Ann", $descr = "A customer")\n  UpdateLayoutConfig($c4ShapeInRow="3")'],
]

describe('read generously what pinned Mermaid rejects, and warn', () => {
  test.each(CLASS_READ_GENEROUSLY)('class: %s is read, drawn and reported', (_construct, source, text, syntax, line) => {
    expect(readGenerously(source, text)).toEqual({ typed: 'class', draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })

  test.each(QUADRANT_READ_GENEROUSLY)('quadrant: %s is read, drawn and reported', (_construct, source, text, syntax, line) => {
    expect(readGenerously(source, text)).toEqual({ typed: 'quadrant', draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })

  test.each(ARCHITECTURE_READ_GENEROUSLY)('architecture: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'architecture', draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })

  test.each(XYCHART_READ_GENEROUSLY)('xychart: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'xychart', draws: true, reported: [`${syntax}@${line}`] })
  })

  // Mermaid accepts this but reads the second `title` as another title
  // statement, so it draws "of the chart". Ours keeps the whole title, and says so.
  test('xychart: a keyword Mermaid reads as another statement inside an unquoted title is reported', async () => {
    const source = 'xychart-beta\n  title The title of the chart\n  bar [10, 20]'
    expect((await upstream.parse(source)).ok).toBe(true)
    expect(readGenerously(source, 'The title of the chart')).toEqual({ typed: 'xychart', draws: true, reported: ['xychart_unquoted_text@2'] })
  })

  test.each(GITGRAPH_READ_GENEROUSLY)('gitgraph: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'gitgraph', draws: true, reported: [`${syntax}@${line}`] })
  })

  test.each(MINDMAP_READ_GENEROUSLY)('mindmap: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'mindmap', draws: true, reported: [`${syntax}@${line}`] })
  })

  test.each(STATE_READ_GENEROUSLY)('state: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'opaque', draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })

  test.each(C4_READ_GENEROUSLY)('c4: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'c4', draws: true, reported: [`${syntax}@${line}`] })
  })

  test.each(C4_UNREADABLE)('c4: %s is retained as source and not drawn', async (_construct, source, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    const { typed, error } = ours(source)
    const reported = verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : [])
    expect({ typed, refused: error?.startsWith('C4 unsupported syntax'), reported })
      .toEqual({ typed: 'c4', refused: true, reported: [`c4_argument_quoting@${line}`] })
  })
})

// Every Mermaid grammar needs the colon after accTitle and accDescr: without
// it, Mermaid rejects the line, reads its words as diagram text, or drops
// them. Ours reads the directive, draws it, and reports it.
const COLONLESS_ACCESSIBILITY: ReadonlyArray<readonly [BuiltinFamilyId, string]> = [
  ['pie', 'pie\n  accTitle Shares\n  "a" : 1'],
  ['flowchart', 'flowchart TD\n  accTitle Shares\n  A --> B'],
  ['sequence', 'sequenceDiagram\n  accDescr Shares\n  A->>B: hi'],
  ['class', 'classDiagram\n  accTitle Shares\n  class A'],
  ['state', 'stateDiagram-v2\n  accDescr Shares\n  A --> B'],
  ['timeline', 'timeline\n  accTitle Shares\n  2020 : a'],
  ['xychart', 'xychart-beta\n  accTitle Shares\n  bar [1, 2]'],
]

describe('accessibility directives without their colon', () => {
  test.each(COLONLESS_ACCESSIBILITY)('%s: is read, drawn and reported, where Mermaid reads no directive', async (family, source) => {
    const mermaid = await upstream.project(source, diagram => [diagram.db.getAccTitle?.() ?? '', diagram.db.getAccDescription?.() ?? ''])
    if (mermaid.ok) expect(mermaid.value).toEqual(['', ''])
    expect(readGenerously(source, 'Shares')).toEqual({ typed: family, draws: true, reported: expect.arrayContaining(['accessibility_colon@2']) })
    expect(verifyMermaid(source.replace(/(acc(?:Title|Descr))/, '$1:')).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
  })
})

describe('accept what pinned Mermaid accepts', () => {
  test.each(ACCEPTED)('%s: %s is accepted, as Mermaid accepts it', async (family, _construct, source) => {
    expect({ mermaid: (await upstream.parse(source)).ok, ...ours(source) })
      .toEqual({ mermaid: true, typed: family, error: undefined })
    if (family === 'architecture' || family === 'quadrant' || family === 'xychart' || family === 'mindmap' || family === 'gitgraph' || family === 'c4') expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
  })

  test.each(C4_READ_OTHERWISE)('c4: %s is drawn and reported, as Mermaid reads it otherwise', async (_construct, source, syntax, line) => {
    const mermaid = await upstream.project(source, diagram => diagram.db.getC4ShapeArray().map((shape: { alias: string }) => shape.alias))
    const parsed = parseRegisteredMermaid(source)
    expect({ mermaid, ours: parsed.ok && parsed.value.body.kind === 'c4' ? parsed.value.body.elements.map(element => element.id) : [], ...readGenerously(source, 'Bob') })
      .toEqual({ mermaid: { ok: true, value: ['a'] }, ours: ['a', 'b'], typed: 'c4', draws: true, reported: [`${syntax}@${line}`] })
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
