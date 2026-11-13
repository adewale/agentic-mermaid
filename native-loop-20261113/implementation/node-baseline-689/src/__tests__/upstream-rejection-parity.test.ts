// Write strictly, read generously, warn. Where pinned Mermaid rejects a
// construct whose meaning is clear, ours reads it: the typed parser models it,
// the renderer draws it, and verify reports UNSUPPORTED_SYNTAX naming the
// construct on its authored line. The accepted neighbours (the quoted form, a
// statement after the header) must parse typed and render, and the typed
// serializer must write source Mermaid accepts.

import { afterAll, describe, expect, test } from 'bun:test'
import { decodeXML } from 'entities'
import { parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import type { BuiltinFamilyId } from '../agent/families.ts'
import { renderMermaidASCII } from '../index.ts'
import { parseMermaid } from '../parser.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
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
    // mermaid_cleanup, that Mermaid's cleanup changed a line, is the shared
    // cleanup step's, tested where it is owned.
    reported: verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax !== 'mermaid_cleanup' ? [`${warning.syntax}@${warning.line}`] : []),
  }
}

// [construct, source, text the render draws, syntax verify reports, its line]
type GenerousRow = readonly [string, string, string, string, number]

const CLASS_READ_GENEROUSLY: ReadonlyArray<[...GenerousRow, ('class' | 'opaque')?]> = [
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
  // Mermaid's text after `Class :` is one LABEL token, which ends at a colon or `;`.
  ['a colon in member text after the class name', 'classDiagram\n  class BankAccount\n  BankAccount : t : +String owner', 't : +String owner', 'class_member_text', 3],
  ['a colon right after the member colon', 'classDiagram\n  A::B', ':B', 'class_member_text', 2],
  ['a semicolon in member text', 'classDiagram\n  A : x; y', 'x; y', 'class_member_text', 2],
  ['a second header', 'classDiagram\n  classDiagram\n  class Animal', 'Animal', 'class_repeated_header', 2],
  // Mermaid reads a link only as `click A href "…"` or `link A "…"`.
  ['`click` without `href`', 'classDiagram\n  class Shape\n  click Shape "https://example.com" "tip"', 'https://example.com', 'class_link_form', 3],
  ['`link` with `href`', 'classDiagram\n  class Shape\n  link Shape href "https://example.com"', 'https://example.com', 'class_link_form', 3],
  ['an unquoted URL', 'classDiagram\n  class Shape\n  link Shape https://example.com', 'https://example.com', 'class_link_form', 3],
  ['a link keyword in upper case', 'classDiagram\n  class Shape\n  CLICK Shape href "https://example.com"', 'https://example.com', 'class_link_form', 3],
  // Mermaid reads a member holding `)` as a method, and fails on one with no name and `(…)` before it.
  ['a `)` with no `(` in a body member', 'classDiagram\n  class A {\n    +deposimount)\n  }', 'deposimount)', 'class_member_parenthesis', 3],
  ['a method with no name in a member statement', 'classDiagram\n  class A\n  A : (x)', '(x)', 'class_member_parenthesis', 3],
  ['a second header inside a namespace', 'classDiagram\n  namespace Zoo {\n    classDiagram\n    class Animal\n  }', 'Animal', 'class_repeated_header', 3],
  // Before the first colon of a classDef or style, Mermaid's class grammar takes only words, `#`, `%` and commas.
  ['a hyphen before the first colon of a classDef', 'classDiagram\n  class A:::thick\n  classDef thick stroke-width:4px', 'stroke-width="4"', 'class_style_text', 3, 'class'],
  ['a hyphen before the first colon of a style', 'classDiagram\n  class A\n  style A stroke-width:4px', 'stroke-width="4"', 'class_style_text', 3, 'class'],
]

// Unquoted quadrant text Mermaid's quadrant lexer does not read as text.
const QUADRANT_READ_GENEROUSLY: ReadonlyArray<[...GenerousRow, ('quadrant' | 'opaque')?]> = [
  ['a < in an unquoted point label', 'quadrantChart\n  A < B: [0.3, 0.4]', 'A &lt; B', 'quadrant_unquoted_text', 2],
  ['a < in unquoted axis text', 'quadrantChart\n  x-axis Low < High', 'Low &lt; High', 'quadrant_unquoted_text', 2],
  ['a <br/> in an unquoted quadrant label', 'quadrantChart\n  quadrant-1 Grow<br/>fast', 'fast', 'quadrant_unquoted_text', 2],
  ['brackets in an unquoted point label', 'quadrantChart\n  A [x]: [0.3, 0.4]', 'A [x]', 'quadrant_unquoted_text', 2],
  ['parentheses in unquoted axis text', 'quadrantChart\n  y-axis Low (cheap) --> High', 'Low (cheap)', 'quadrant_unquoted_text', 2],
  ['a second arrow in axis text', 'quadrantChart\n  x-axis Low --> Mid --> High', 'Mid --&gt; High', 'quadrant_unquoted_text', 2],
  ['a colon in an unquoted quadrant label', 'quadrantChart\n  quadrant-1 Grow: fast', 'Grow: fast', 'quadrant_unquoted_text', 2],
  ['a string after unquoted text', 'quadrantChart\n  title Growth\n  quadrant-1 Grow "fast"', 'Grow', 'quadrant_unquoted_text', 3, 'opaque'],
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

// C4 reader extensions to Mermaid's C4 grammar, each named by a stable code.
const C4_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a semicolon between statements', 'C4Context\n  Person(a, "Ann"); Person(b, "Bob")', 'Bob', 'c4_semicolon_separator', 2],
  ['two statements on one line', 'C4Context\n  Person(a, "Ann") Person(b, "Bob")', 'Bob', 'c4_statements_on_one_line', 2],
  ['a line break between arguments', 'C4Context\n  Person(a,\n    "Ann")', 'Ann', 'c4_multiline_arguments', 2],
  ['an empty named argument', 'C4Context\n  Person(a, "Ann", $descr="")', 'Ann', 'c4_empty_named_argument', 2],
  ['an empty boundary', 'C4Context\n  Person(a, "Ann")\n  System_Boundary(b, "Bank") {\n  }', 'Bank', 'c4_empty_boundary', 3],
  ['a standalone direction', 'C4Context\n  direction LR\n  Person(a, "Ann")', 'Ann', 'c4_direction', 2],
  ['a legend directive', 'C4Context\n  Person(a, "Ann")\n  SHOW_LEGEND()', 'Ann', 'c4_directive_extension', 3],
  // Mermaid's lexer reads only "(" straight after a macro's name.
  ['a space before the argument list', 'C4Context\n  Person (a, "Ann")', 'Ann', 'c4_space_before_arguments', 2],
  ['a line break before a boundary\'s argument list', 'C4Context\n  System_Boundary\n  (b, "Bank") {\n    Person(a, "Ann")\n  }', 'Bank', 'c4_space_before_arguments', 2],
]

// Mermaid's database throws when a participant that is not active is
// deactivated; ours ignores that deactivation.
const SEQUENCE_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a message deactivating its inactive sender', 'sequenceDiagram\n  Alice->>+Bob: Hi\n  Bob-->>-Alice: Hello\n  Bob-->>-Alice: Again', 'Again', 'sequence_inactive_deactivation', 4],
  ['deactivating a participant never activated', 'sequenceDiagram\n  Alice->>Bob: Hi\n  deactivate Bob', 'Hi', 'sequence_inactive_deactivation', 3],
]

// Ours keeps local arrow spellings Mermaid's lexer does not have; each draws
// what one of Mermaid's arrows draws, which ours writes instead.
// [construct, source, the source with Mermaid's arrow, line]
const SEQUENCE_LOCAL_ARROWS: ReadonlyArray<readonly [string, string, string, number]> = [
  ['a solid stick end written with a bar', 'sequenceDiagram\n  Alice-|Bob: Hi', 'sequenceDiagram\n  Alice-\\\\Bob: Hi', 2],
  ['a dashed stick end written with one slash', 'sequenceDiagram\n  Alice--/Bob: Hi', 'sequenceDiagram\n  Alice--//Bob: Hi', 2],
  ['a stick start written with a bar', 'sequenceDiagram\n  Alice|-Bob: Hi', 'sequenceDiagram\n  Alice\\\\-Bob: Hi', 2],
  ['a dashed stick start written with one backslash', 'sequenceDiagram\n  Alice\\--Bob: Hi', 'sequenceDiagram\n  Alice\\\\--Bob: Hi', 2],
  // A fragment keeps its authored lines, but with Mermaid's arrow.
  ['a stick start inside a loop', 'sequenceDiagram\n  loop Every minute\n    Alice|-Bob: Hi\n  end', 'sequenceDiagram\n  loop Every minute\n    Alice\\\\-Bob: Hi\n  end', 3],
  ['a stick end inside a critical block', 'sequenceDiagram\n  critical Connect\n    Alice-/Bob: Hi\n  end', 'sequenceDiagram\n  critical Connect\n    Alice-//Bob: Hi\n  end', 3],
]

// Mermaid's lexer reads a message's sender and receiver as one ID each. Where
// that ID ends inside ours, arrow tokens follow where Mermaid wants message
// text; what was meant is unclear, so, like any statement ours cannot read,
// it is kept as source and the render refuses it. Both renderers name the
// line verify reports. [construct, source, line]
const SEQUENCE_UNREAD: ReadonlyArray<readonly [string, string, number]> = [
  ['an arrow inside the receiver', 'sequenceDiagram\n  Alice->>Bob->>Carol: Hi', 2],
  ['an arrow inside the receiver after frontmatter and a blank line', '---\ntitle: T\n---\nsequenceDiagram\n\n  Alice->>Bob->>Carol: Hi', 6],
  ['an arrow inside the receiver after a semicolon', 'sequenceDiagram\n  Alice->>Bob: x; Bob->>Al->>Carol: Hi', 2],
  ['an arrow inside the receiver after an accDescr block', 'sequenceDiagram\n  accDescr {\n    About\n  }\n  Alice->>Bob->>Carol: Hi', 5],
  ['an arrow ending the receiver', 'sequenceDiagram\n  Alice->Bob->>: Hi', 2],
  ['an arrow inside a central-connection receiver', 'sequenceDiagram\n  Alice()->>Bo->>Bob: Hi', 2],
  ['a sender starting with an arrow', 'sequenceDiagram\n  accDescr {\n    About\n  }-xAlice->Bob: Hi', 4],
  ['a dash before the arrow', 'sequenceDiagram\n  Alice--->>Bob: Hi', 2],
  ['a comma in the receiver', 'sequenceDiagram\n  Alice->>Bob,Carol: Hi', 2],
]

// Mermaid's Timeline lexer reads the word `timeline` starting a line as the
// header. Ours reads the line as a period.
const TIMELINE_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a period starting with the word timeline', 'timeline\n  Timeline of A : Launch', 'Timeline of A', 'timeline_header_in_body', 2],
  ['a repeated header with a direction', 'timeline\n  title History\n  timeline TD\n  2002 : LinkedIn', 'LinkedIn', 'timeline_header_in_body', 3],
]

// Mermaid's Sankey CSV lexer reads only printable ASCII in a row, quoted or
// not, apart from the whitespace it trims from the end of the source. Its
// entity prepass turns `#…;` codes into non-ASCII markers first; ours draws
// the code as written.
const SANKEY_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  ['a tab inside a quoted field', 'sankey\nGrid,"Heating\tcooling",1', 'Heating', 'sankey_unsupported_character', 2],
  ['a tab indenting a row', 'sankey\nGrid,Homes,1\n\tGrid,Shops,2', 'Shops', 'sankey_unsupported_character', 3],
  ['a non-ASCII letter in an unquoted field', 'sankey\nÉlectricité,Homes,1', 'Électricité', 'sankey_unsupported_character', 2],
  ['a numeric entity code in an unquoted field', 'sankey\nCaf#233;,Homes,1', 'Caf#233;', 'sankey_unsupported_character', 2],
  ['an entity code in a quoted field', 'sankey\nGrid,"A#35;B",1', 'A#35;B', 'sankey_unsupported_character', 2],
  ['a named entity code', 'sankey\nGrid,Homes,1\nA#amp;B,Shops,2', 'A#amp;B', 'sankey_unsupported_character', 3],
]

// Mermaid's cleanup strips the last `;` of a line where `style` or `classDef`
// comes before a `:` and a `#` ahead of it, labels included; ours keeps the
// label as written, and the shared cleanup step reports the line.
// [construct, source, Mermaid's nodes, ours, syntax, line]
const SANKEY_READ_OTHERWISE: ReadonlyArray<readonly [string, string, readonly string[], readonly string[], string, number]> = [
  ['a `style` label whose `#` run ends at a semicolon', 'sankey\nstyle:x#a;,B,1', ['style:x#a', 'B'], ['style:x#a;', 'B'], 'mermaid_cleanup', 2],
  ['a quoted `classDef` label with a semicolon inside it', 'sankey\nGrid,Homes,1\nGrid,"classDef:#a;b",2', ['Grid', 'Homes', 'classDef:#ab'], ['Grid', 'Homes', 'classDef:#a;b'], 'mermaid_cleanup', 3],
]

// Mermaid's Sankey CSV lexer reads a quote after unquoted text as the start
// of a quoted field, which its grammar rejects there. Whether the quote was
// literal or meant to open a field is unclear, so, like text after a closing
// quote, ours refuses the row. [construct, source]
const SANKEY_UNREAD: ReadonlyArray<readonly [string, string]> = [
  ['a quote ending an unquoted field', 'sankey\nPumped hea","Heating, commercial",70.672'],
  ['a quote inside an unquoted field', 'sankey\nElectricity gr"d,Losses,56.691'],
  ['an unquoted field running into a quoted one', 'sankey\nPumped heat"Heating, homes",193.026'],
]

// Flowchart spellings Mermaid's lexer reads otherwise, where what the author
// meant is clear.
const FLOWCHART_READ_GENEROUSLY: ReadonlyArray<GenerousRow> = [
  // Mermaid's text state ends unquoted label text at any of `[](){}|"`; its
  // trapezoid text at a bracket; its edge text at a `"`.
  ['parentheses in shape text', 'flowchart LR\n  A[a (b) c]', '>a (b) c<', 'flowchart_label_delimiter', 2],
  ['an unpaired `)` in shape text', 'flowchart LR\n  node[hello ) world] --> works', '>hello ) world<', 'flowchart_label_delimiter', 2],
  // The lexer leaves these open; they are label text, reported once.
  ['an unpaired `(` in shape text', 'flowchart LR\n  A[a ( b]', '>a ( b<', 'flowchart_label_delimiter', 2],
  ['a `"` ending shape text', 'flowchart LR\n  A[a"]', '>a&quot;<', 'flowchart_label_delimiter', 2],
  ['a `"` inside rounded text', 'flowchart LR\n  A(a "b" c)', '>a &quot;b&quot; c<', 'flowchart_label_delimiter', 2],
  ['a `"` after a leading string', 'flowchart LR\n  A["a""b"]', '>a&quot;&quot;b<', 'flowchart_label_delimiter', 2],
  ['parentheses in trapezoid text', 'flowchart LR\n  A[/a (b) c/]', '>a (b) c<', 'flowchart_label_delimiter', 2],
  ['a `[` in a pipe label', 'flowchart LR\n  A -->|a [b| B', '>a [b<', 'flowchart_label_delimiter', 2],
  ['a `"` inside a text-arrow label', 'flowchart LR\n  A -- a "b" --> B', '>a &quot;b&quot;<', 'flowchart_label_delimiter', 2],
  ['parentheses in a subgraph bracket title', 'flowchart LR\n  subgraph S[x (y) z]\n    A\n  end', '>x (y) z<', 'flowchart_label_delimiter', 2],
  // Mermaid's string token needs a character.
  ['an empty quoted shape label', 'flowchart LR\n  A[""] --> B', '>B<', 'flowchart_empty_string', 2],
  ['an empty quoted trapezoid label', 'flowchart LR\n  A[/""/] --> B', '>B<', 'flowchart_empty_string', 2],
  ['an empty quoted pipe label', 'flowchart LR\n  A -->|""| B', '>B<', 'flowchart_empty_string', 2],
  ['an empty quoted text-arrow label', 'flowchart LR\n  A -- "" --> B', '>B<', 'flowchart_empty_string', 2],
  ['an empty quoted subgraph bracket title', 'flowchart LR\n  subgraph S[""]\n    B\n  end', '>B<', 'flowchart_empty_string', 2],
  ['an empty quoted subgraph title', 'flowchart LR\n  subgraph ""\n    B\n  end', '>B<', 'flowchart_empty_string', 2],
  // Its pipe label needs text, a blank at least.
  ['an empty pipe label', 'flowchart LR\n  A -->|| B', '>B<', 'flowchart_empty_pipe_label', 2],
  ['an empty pipe label on an open link', 'flowchart LR\n  A ---|| B', '>B<', 'flowchart_empty_pipe_label', 2],
  ['an empty pipe label on a dotted link', 'flowchart LR\n  A -.->|| B', '>B<', 'flowchart_empty_pipe_label', 2],
  ['an empty pipe label on a thick link, glued to its nodes', 'flowchart LR\n  A==>||B', '>B<', 'flowchart_empty_pipe_label', 2],
  ['an empty pipe label after a blank, on a named link', 'flowchart LR\n  A e1@--> || B', 'data-id="e1"', 'flowchart_empty_pipe_label', 2],
  // Mermaid reads a run without blanks or `"` from a node's start to an `@`
  // as an edge id.
  ['an `@` the node text runs on to', 'flowchart LR\n  A[a@b.com]', '>a@b.com<', 'flowchart_node_edge_id', 2],
  ['a link after an `@` in shape text', 'flowchart LR\n  A[x@--> B]', '>x@--&gt; B<', 'flowchart_node_edge_id', 2],
  ['a subgraph id running on to an `@` in its title', 'flowchart LR\n  subgraph This is the id[Some1@ Title]\n    A\n  end', '>Some1@ Title<', 'flowchart_node_edge_id', 2],
  // Its edge-id token is tried before a pipe, so the run may start there.
  ['a link after an `@` in a pipe label glued to a shape', 'flowchart LR\n  A["x"]-->|a@-->b|B', '>a@--&gt;b<', 'flowchart_node_edge_id', 2],
  ['an `@` a pipe label runs on to', 'flowchart LR\n  A -->|me@example.com| B', '>me@example.com<', 'flowchart_node_edge_id', 2],
  ['an `@` ending a pipe label', 'flowchart LR\n  A ==>|a@| B', '>a@<', 'flowchart_node_edge_id', 2],
  ['an `@` before a blank in a pipe label after a blank', 'flowchart LR\n  A --> |x@--> y| B', '>x@--&gt; y<', 'flowchart_node_edge_id', 2],
  // Without quotes or brackets, Mermaid's subgraph title holds letters,
  // digits, blanks and !#$%&'*+-./:?\^_` alone, with no link or inner string.
  ['parentheses in a subgraph title', 'flowchart LR\n  subgraph a(b)\n    A\n  end', '>a(b)<', 'flowchart_subgraph_title', 2],
  ['brackets in a subgraph title with blanks', 'flowchart LR\n  subgraph old styl]]e that is broken\n    c --> d\n  end', '>old styl]]e that is broken<', 'flowchart_subgraph_title', 2],
  ['a bracket title no `]` closes', 'flowchart LR\n  subgraph S[Stage one\n    A\n  end', '>S[Stage one<', 'flowchart_subgraph_title', 2],
  ['a `,` in a subgraph title', 'flowchart LR\n  subgraph a,b\n    A\n  end', '>a,b<', 'flowchart_subgraph_title', 2],
  ['a link in a subgraph title', 'flowchart LR\n  subgraph a-->b\n    A\n  end', '>a--&gt;b<', 'flowchart_subgraph_title', 2],
  ['a string after subgraph title text', 'flowchart LR\n  subgraph a "b"\n    A\n  end', '>a &quot;b&quot;<', 'flowchart_subgraph_title', 2],
  // Mermaid's entity prepass reads `#fff;` as an entity code, and drops the
  // last `;` of a line where `style` comes before `:…#`.
  ['a `;` after a style color, before another style', 'flowchart LR\n  A --> D\n  style A background:#fff;style D border:1px solid red;', '>D<', 'flowchart_entity_semicolon', 3],
  ['a `;` after a linkStyle color', 'flowchart LR\n  A --> B\n  linkStyle 0 stroke:#f00;', '>B<', 'flowchart_entity_semicolon', 3],
  ['a style line\'s last `;` before a link', 'flowchart LR\n  style A color:#fff;A-->B', '>B<', 'flowchart_entity_semicolon', 2],
]

// Flowchart labels Mermaid's lexer reads otherwise than as written: its text
// joins a leading string to the text after it (`"a" b` is `a b`), and after
// a blank `x--` opens a link label even before an `@`.
// [construct, source]
const FLOWCHART_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['marker link labels holding `@`', 'flowchart LR\n  A x--e1@--x B\n  B o--e2@--o C'],
  ['a string then text in shape, pipe, text-arrow and subgraph labels', 'flowchart LR\n  A["a" b] -->|"c" d| B -- "e" f --> C\n  subgraph S["g" h]\n    A\n  end\n  subgraph "i"j\n    B\n  end'],
]

// Flowchart subgraphs whose Mermaid id no statement can name: ours derives
// one, and reads the same title and members. [construct, source]
const FLOWCHART_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['a bracket title after an id holding blanks, repeated', 'flowchart LR\n  subgraph a b[c]\n    A\n  end\n  subgraph a b[d]\n    B\n  end'],
]

// The render path decodes entities before it reads a source. Where Mermaid
// reads the authored text, ours draws what Mermaid and the typed body read:
// an entity in label text shows its character, and one outside ends at `;`.
// [construct, source, label text the render draws]
const FLOWCHART_ENTITY_READINGS: ReadonlyArray<readonly [string, string, string]> = [
  ['entity quotes around a shape label', 'flowchart LR\n  A[&quot;x&quot;] --> B', '>&quot;x&quot;<'],
  ['entity quotes in a subgraph title, which `;` ends', 'flowchart LR\n  subgraph &quot;x\n  y&quot;\n    A\n  end', '>&amp;quot<'],
  // A link holds no label: its `&amp;` is the `&` of the URL.
  ['entities in a click link', 'flowchart LR\n  A --> B\n  click A "https://example.com/?a=1&amp;b=2"', 'data-href="https://example.com/?a=1&amp;b=2"'],
]

// Flowchart source Mermaid accepts but reads otherwise than its author meant.
// [construct, source, Mermaid's nodes, ours, text the render draws, syntax verify reports, its line]
const FLOWCHART_READ_OTHERWISE: ReadonlyArray<readonly [string, string, readonly string[], readonly string[], string, string, number]> = [
  // Mermaid's entity prepass drops a style line's last `;`, reading `B` into
  // A's style.
  ['a style line\'s last `;` before a node', 'flowchart LR\n  style A fill:#f00;B', ['A'], ['A', 'B'], '>B<', 'flowchart_entity_semicolon', 2],
  // Mermaid ends the statement at a `;` and reads the next property as a
  // node, or, after a `#` color, joins the two into one declaration.
  ['a `;` between style properties', 'flowchart LR\n  style A fill:red;stroke:blue', ['A', 'stroke:blue'], ['A'], 'fill="red" stroke="blue"', 'flowchart_style_semicolon', 2],
  ['a `;` between classDef properties after a color', 'flowchart LR\n  A:::c\n  classDef c fill:#f9f; stroke:#0a0', ['A'], ['A'], 'fill="#f9f" stroke="#0a0"', 'flowchart_style_semicolon', 3],
  ['a `;` between linkStyle properties', 'flowchart LR\n  A --> B\n  linkStyle 0 stroke:red;stroke-width:2px', ['A', 'B', 'stroke-width:2px'], ['A', 'B'], 'stroke="red"', 'flowchart_style_semicolon', 3],
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
  ['class', 'an entity code ending in `;` in member text', 'classDiagram\n  Animal : x #59; y'],
  ['class', 'a `)` Mermaid reads in a method, as text, or as an entity code', 'classDiagram\n  class A {\n    +f(a) b)\n    )x\n    +x #41;\n  }'],
  ['class', 'keywords in backticks and words that only start like one', 'classDiagram\n  class `class`\n  `class` : x\n  classes : y\n  call: z\n  class call\n  A --> `_self`'],
  ['class', '`call` with no blank after it in a relationship', 'classDiagram\n  call-->A\n  B --> call: uses\n  call<|--C'],
  ['class', 'colons and `;` in accessibility text', 'classDiagram\n  class A\n  accTitle: a:b; c\n  accDescr {\n    x : y : z\n  }'],
  ['class', 'a hyphenated property after the first colon', 'classDiagram\n  class A:::thick\n  classDef thick fill:#fff,stroke-width:4px\n  style A fill:#eee, stroke-width:2px'],
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
  ['gitgraph', 'quoted text across lines', 'gitGraph\n  commit id: "a\n  b" msg: "multi\n  line" tag: "v1\n  rc"\n  commit "bare\n  msg"\n  branch dev\n  commit\n  checkout main\n  merge dev tag: "x\n  y"'],
  ['architecture', 'quoted titles across lines', 'architecture-beta\n  group g(cloud)["G\n  H"]\n  service a(server)["line1\n  line2"] in g\n  service b(server)[\'sq\n  line\'] in g\n  a:R -["multi\n  line"]- L:b'],
  ['radar', 'a quoted axis label across lines', 'radar-beta\n  axis a["A\n  long"], b, c\n  curve x{1, 2, 3}'],
  ['mindmap', 'delimiters Mermaid reads as shape text', 'mindmap\n  (a [b)\n    ["text (x)"]\n    c{{d [e}}'],
  // Mermaid removes a `%%` line with the blank lines before it.
  ['mindmap', 'a blank line before a comment after the header', 'mindmap\n\n%% c\n  root\n\n    a'],
  ['sankey', 'spaces around fields, a non-ASCII comment and a tab ending the source', 'sankey\n%% café\n  Grid , Homes , 1\nGrid,"Shops, offices",2\t'],
  ['timeline', '"timelines" starting a period, and "timeline" in a title and an event', 'timeline\n  title timeline view\n  timelines : timeline'],
  ['timeline', 'a continuation after a section header', 'timeline\n  2001 : Alpha\n  section Later\n  : Beta\n  2002 : Gamma'],
  ['timeline', 'a section on its own line, and "section" starting period labels', 'timeline\n  section 2020s\n  2021 : Launch\n  section : Beta\n  sections X : Gamma'],
  ['sequence', 'nested activations each deactivated once', 'sequenceDiagram\n  Alice->>+Bob: Hi\n  Alice->>+Bob: Again\n  Bob-->>-Alice: Hello\n  Bob-->>-Alice: Bye'],
  ['sequence', 'dashes, slashes, parentheses and spaces around participant IDs', 'sequenceDiagram\n  A-B->>C/D: x\n  E(1)->>F: y\n  Alice ->> Bob: z'],
  ['c4', 'spaces around a named argument\'s equals sign', 'C4Context\n  Person(a, "Ann", $descr = "A customer")\n  UpdateLayoutConfig($c4ShapeInRow="3")'],
  ['flowchart', 'blanks between the pipes of a label', 'flowchart LR\n  A -->| | B ==>|\t| C'],
  // Mermaid's prepass writes a tag's double-quoted attributes with single quotes.
  ['flowchart', 'HTML tags with double-quoted attributes in unquoted labels', 'flowchart LR\n  B --> C{Let <span style="background-color:#ddd">me</span> think}\n  SYS([SYSTEMS<br/><span style="font-size:12px">How we function</span>])'],
  // The render path decodes `&quot;` before it reads the lines, so the
  // label begins with a `"` that no later line closes.
  ['flowchart', 'labels beginning with an entity quote that run across lines', 'flowchart LR\n  A[&quot;x\n  y] --> B\n  subgraph S[&quot;t\n  u]\n    C\n  end'],
  ...FLOWCHART_LABELS.map(([construct, source]) => ['flowchart', construct, source] as const),
  ...FLOWCHART_GROUPS.map(([construct, source]) => ['flowchart', construct, source] as const),
  ['flowchart', 'an `@` after a blank, in quotes, in an edge id and in metadata', 'flowchart LR\n  A[ a@b.com] --> B["c@d"]\n  B e1@--> C@{ label: "e@f" }\n  C -->| a@b| D -->|x a@--> y| E -->|"g@h"| F'],
  ['flowchart', '`;` after colors and entity codes Mermaid reads as we do', 'flowchart LR\n  A[#quot;x#quot;] --> B;C\n  style A fill:#f00;\n  classDef c fill:#f9f,stroke:#333;\n  style B fill:#fff ;style C fill:#000;'],
  ['flowchart', 'subgraph titles of letters, digits and the punctuation Mermaid reads unquoted, and a quoted one',"flowchart LR\n  subgraph a.-b!#$%&'*+/:?^_`x\n    A\n  end\n  subgraph \"a(b)\"\n    B\n  end\n  subgraph 東京 Ελλάδα\n    C\n  end"],
  ['flowchart', 'delimiters inside quoted labels and trapezoid text, and parentheses in a text-arrow label','flowchart LR\n  A["a (b) c"] -->|"x [y]"| B[/a | b "c"/]\n  A -- a (b) --> C["a" ]\n  subgraph S["x (y)"]\n    C\n  end'],
]

describe('read generously what pinned Mermaid rejects, and warn', () => {
  test.each(CLASS_READ_GENEROUSLY)('class: %s is read, drawn and reported', async (_construct, source, text, syntax, line, typed = 'class') => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed, draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
    if (typed === 'opaque') {
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(serializeMermaid(parsed.value)).toBe(source + '\n')
    }
  })

  test.each(QUADRANT_READ_GENEROUSLY)('quadrant: %s is read, drawn and reported', (_construct, source, text, syntax, line, typed = 'quadrant') => {
    expect(readGenerously(source, text)).toEqual({ typed, draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
    if (typed === 'opaque') {
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(serializeMermaid(parsed.value)).toBe(source + '\n')
    }
  })

  test.each(ARCHITECTURE_READ_GENEROUSLY)('architecture: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    // Titles can be quoted portably; these IDs and icons have no spelling
    // that keeps their meaning, so they retain the authored source instead.
    const typed = syntax === 'architecture_title' ? 'architecture' : 'opaque'
    expect(readGenerously(source, text)).toEqual({ typed, draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && typed === 'opaque') expect(serializeMermaid(parsed.value)).toBe(source + '\n')
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

  test.each(TIMELINE_READ_GENEROUSLY)('timeline: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'timeline', draws: true, reported: [`${syntax}@${line}`] })
  })

  test.each(SEQUENCE_READ_GENEROUSLY)('sequence: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'sequence', draws: true, reported: expect.arrayContaining([`${syntax}@${line}`]) })
  })

  test.each(SEQUENCE_LOCAL_ARROWS)('sequence: %s is read, reported and written as Mermaid\'s arrow', async (_construct, source, portable, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    const parsed = parseRegisteredMermaid(source)
    const serialized = parsed.ok ? serializeMermaid(parsed.value) : ''
    const written = await upstream.parse(serialized)
    expect({ ...readGenerously(source, 'Hi'), drawsAsMermaid: renderMermaidSVG(source) === renderMermaidSVG(portable), serialized, written: written.ok && written.sequence?.messages.flatMap(message => message.from && message.to ? [[message.from, message.to, message.message]] : []) })
      .toEqual({ typed: 'sequence', draws: true, reported: expect.arrayContaining([`sequence_local_arrow@${line}`]), drawsAsMermaid: true, serialized: `${portable}\n`, written: [['Alice', 'Bob', 'Hi']] })
  })

  test.each(SEQUENCE_UNREAD)('sequence: %s is kept as source and not drawn', async (_construct, source, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    const { typed, error } = ours(source)
    let ascii: string | undefined
    try { renderMermaidASCII(source) } catch (caught) { ascii = caught instanceof Error ? caught.message : String(caught) }
    const reported = verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : [])
    expect({ typed, refused: error?.startsWith(`SEQUENCE_UNSUPPORTED_STATEMENT: line ${line}:`), ascii, reported })
      .toEqual({ typed: 'sequence', refused: true, ascii: error, reported: expect.arrayContaining([`sequence_statement@${line}`]) })
  })

  test.each(SANKEY_READ_GENEROUSLY)('sankey: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'sankey', draws: true, reported: [`${syntax}@${line}`] })
  })

  test.each(SANKEY_READ_OTHERWISE)('sankey: %s is read as written, drawn and reported', async (_construct, source, mermaidNodes, ourNodes, syntax, line) => {
    const mermaid = await upstream.project(source, diagram => diagram.db.getGraph().nodes.map((node: { id: string }) => node.id))
    const parsed = parseRegisteredMermaid(source)
    const links = parsed.ok && parsed.value.body.kind === 'sankey' ? parsed.value.body.links : []
    const reported = verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : [])
    const actual: Record<string, unknown> = { mermaid, ours: [...new Set(links.flatMap(link => [link.source, link.target]))], draws: renderMermaidSVG(source).includes(ourNodes.at(-1)!), reported }
    expect(actual).toEqual({ mermaid: { ok: true, value: mermaidNodes }, ours: ourNodes, draws: true, reported: [`${syntax}@${line}`] })
  })

  test.each(SANKEY_UNREAD)('sankey: %s is refused', async (_construct, source) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    const { typed, error } = ours(source)
    expect({ typed, refused: error?.includes('has a quote inside the unquoted field') }).toEqual({ typed: 'opaque', refused: true })
  })

  test.each(FLOWCHART_READ_GENEROUSLY)('flowchart: %s is read, drawn and reported', async (_construct, source, text, syntax, line) => {
    expect((await upstream.parse(source)).ok).toBe(false)
    expect(readGenerously(source, text)).toEqual({ typed: 'flowchart', draws: true, reported: [`${syntax}@${line}`] })
  })

  test.each(FLOWCHART_READ_OTHERWISE)('flowchart: %s is read as its author meant, drawn and reported', async (_construct, source, mermaidNodes, ourNodes, text, syntax, line) => {
    const mermaid = await upstream.parse(source)
    expect(mermaid.ok && mermaid.flowchart?.vertices.map(vertex => vertex.id).sort()).toEqual([...mermaidNodes].sort())
    expect({ nodes: [...parseMermaid(source).nodes.keys()].sort(), ...readGenerously(source, text) })
      .toEqual({ nodes: [...ourNodes].sort(), typed: 'flowchart', draws: true, reported: [`${syntax}@${line}`] })
  })
})

// Below frontmatter and an init directive, a warning still names its authored
// line, whether its rule reads the canonical source, which drops blank and
// comment lines, or a family's body, which starts at the header.
// [family, source, syntax, its line in source]
const WRAPPED_WARNINGS: ReadonlyArray<readonly [BuiltinFamilyId, string, string, number]> = [
  ['flowchart', 'flowchart LR\n  Server[Server]\n\n  %% the typo\n  Client --> Sevrer', 'flowchart_implicit_endpoint', 5],
  ['journey', 'journey\n  section S\n\n  Wake: 9: Me', 'journey_invalid_score', 4],
  ['c4', 'C4Context\n\n  Person(a, "Ann")\n  Unknown(b)', 'c4_unknown_macro', 4],
]

describe('warnings below the authored wrapper', () => {
  test.each(WRAPPED_WARNINGS)('%s: names the authored line', (_family, source, syntax, line) => {
    const wrapper = '---\ntitle: T\n---\n%%{init: {"theme": "base"}}%%\n'
    expect(verifyMermaid(wrapper + source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax, line: line + 4 }))
  })
})

describe('accept what pinned Mermaid accepts', () => {
  test.each(FLOWCHART_ENTITY_READINGS)('flowchart: %s are drawn as Mermaid and the typed body read them', async (_construct, source, text) => {
    const mermaid = await upstream.parse(source)
    const read = mermaid.ok ? mermaid.flowchart : undefined
    const svg = renderMermaidSVG(source)
    const parsed = parseRegisteredMermaid(source)
    const graph = parsed.ok && parsed.value.body.kind === 'flowchart' ? parsed.value.body.graph : undefined
    const groupIds = (groups: NonNullable<typeof graph>['subgraphs']): string[] => groups.flatMap(group => [group.id, ...groupIds(group.children)])
    expect({
      drawn: [...svg.matchAll(/data-id="([^":]*)"/g)].map(match => decodeXML(match[1]!)).sort(),
      typed: graph ? [...graph.nodes.keys(), ...groupIds(graph.subgraphs)].sort() : [],
      label: svg.includes(text),
    }).toEqual({
      drawn: [...read?.vertices.map(vertex => vertex.id) ?? [], ...read?.subgraphs.map(group => group.id) ?? []].sort(),
      typed: [...read?.vertices.map(vertex => vertex.id) ?? [], ...read?.subgraphs.map(group => group.id) ?? []].sort(),
      label: true,
    })
  })

  test.each(FLOWCHART_GROUPS)('flowchart: %s has the title and members Mermaid reads', async (_construct, source) => {
    const mermaid = await upstream.parse(source)
    const read = mermaid.ok ? mermaid.flowchart : undefined
    expect(parseMermaid(source).subgraphs.map(group => [group.label, group.nodeIds]))
      .toEqual(read?.subgraphs.map(group => [group.title, group.nodes]) ?? [])
  })

  test.each(FLOWCHART_LABELS)('flowchart: %s are read as Mermaid reads them', async (_construct, source) => {
    const mermaid = await upstream.parse(source)
    const read = mermaid.ok ? mermaid.flowchart : undefined
    const graph = parseMermaid(source)
    expect({
      nodes: [...graph.nodes.values()].map(node => [node.id, node.label]),
      edges: graph.edges.map(edge => edge.label ?? ''),
      groups: graph.subgraphs.map(group => [group.id, group.label]),
    }).toEqual({
      nodes: read?.vertices.map(vertex => [vertex.id, vertex.text]) ?? [],
      edges: read?.edges.map(edge => edge.text) ?? [],
      groups: read?.subgraphs.map(group => [group.id, group.title]) ?? [],
    })
  })

  test.each(ACCEPTED)('%s: %s is accepted, as Mermaid accepts it', async (family, _construct, source) => {
    expect({ mermaid: (await upstream.parse(source)).ok, ...ours(source) })
      .toEqual({ mermaid: true, typed: family, error: undefined })
    // `empty_layout` says the local layout draws nothing (an accTitle alone), and `mermaid_cleanup` that
    // Mermaid's cleanup changed a line, not that Mermaid rejects the source.
    if (family === 'architecture' || family === 'class' || family === 'quadrant' || family === 'xychart' || family === 'mindmap' || family === 'gitgraph' || family === 'c4' || family === 'sequence' || family === 'timeline' || family === 'sankey' || family === 'flowchart') expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax !== 'empty_layout' && warning.syntax !== 'mermaid_cleanup')).toEqual([])
  })

  // Participants and messages as Mermaid's database holds them.
  test.each(ACCEPTED.filter(([family]) => family === 'sequence'))('%s: %s is read as Mermaid reads it', async (_family, _construct, source) => {
    const mermaid = await upstream.parse(source)
    const parsed = parseRegisteredMermaid(source)
    const body = parsed.ok && parsed.value.body.kind === 'sequence' ? parsed.value.body : undefined
    const expected: Record<string, unknown> = {
      participants: mermaid.ok ? mermaid.sequence?.actors.map(actor => actor.name) : [],
      messages: mermaid.ok ? mermaid.sequence?.messages.filter(message => message.to !== undefined).map(message => [message.from, message.to, message.message]) : [],
    }
    const actual: Record<string, unknown> = { participants: body?.participants.map(participant => participant.id), messages: body?.messages.map(message => [message.from, message.to, message.text]) }
    expect(actual).toEqual(expected)
  })

  test.each<{
    construct: string
    source: string
    expected: { sections: string[]; periods: [string, string, string[]][] }
  }>([
    {
      construct: 'a continuation after a section header adds to the period before it',
      source: 'timeline\n  2001 : Alpha\n  section Later\n  : Beta\n  2002 : Gamma',
      expected: { sections: ['Later'], periods: [['', '2001', ['Alpha', 'Beta']], ['Later', '2002', ['Gamma']]] },
    },
    {
      construct: 'section followed by at most one whitespace before a colon remains a period',
      source: 'timeline\n  section Releases\n  2020 : Alpha\n  section: Compact\n  section : Beta\n  SECTION\t: Tab\n  sections X : Gamma',
      expected: { sections: ['Releases'], periods: [['Releases', '2020', ['Alpha']], ['Releases', 'section', ['Compact']], ['Releases', 'section', ['Beta']], ['Releases', 'SECTION', ['Tab']], ['Releases', 'sections X', ['Gamma']]] },
    },
  ])('timeline: $construct, in authored and written source', async ({ source, expected }) => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'timeline') throw new Error('Expected a structured timeline')
    const mermaid = await upstream.projectEach([source, serializeMermaid(parsed.value)], diagram => ({
      sections: diagram.db.getSections(),
      periods: diagram.db.getTasks().map((task: { section: string; task: string; events: string[] }) => [task.section, task.task.trim(), task.events]),
    }))
    const body = parsed.value.body
    const displayed = JSON.parse(JSON.stringify(mermaid), (_key, value) => typeof value === 'string' ? projectEntityMarkers(value) : value)
    expect(displayed).toEqual([{ ok: true, value: expected }, { ok: true, value: expected }])
    expect({
      sections: body.sections.flatMap(section => section.label === undefined ? [] : [section.label]),
      periods: body.sections.flatMap(section => section.periods.map(period => [section.label ?? '', period.label, period.events.map(event => event.text)])),
    }).toEqual(expected)
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

// The typed C4 serializer writes each reader extension in a spelling pinned
// Mermaid reads as ours reads the source: one statement per line, quoted and
// named arguments. A standalone direction and the legend
// and tag directives have no such spelling, and Mermaid cannot read a body
// holding a statement with no native interpretation: those are written as
// authored.
// [construct, source, kept as written]
const C4_NO_MERMAID_SPELLING = new Set(['c4_direction', 'c4_directive_extension'])
const C4_WRITTEN: ReadonlyArray<readonly [string, string, boolean]> = [
  ...C4_READ_GENEROUSLY.map(([construct, source, , syntax]) => [construct, source, C4_NO_MERMAID_SPELLING.has(syntax)] as const),
  ['a semicolon, statements on one line and a comment taking the line break', 'C4Context\n  Person(a, "A"); Person(b, "B") Person(c, "C") %% note\n  Rel(a, b, "uses");Rel(b, c, "calls")', false],
  ['positional RelIndex metadata', 'C4Dynamic\n  Person(a, "A")\n  Person(b, "B")\n  RelIndex(1, a, b, "uses", "tag1", "https://example.com")', false],
  ['a single-quoted argument', 'C4Context\n  Person(a, \'Ann\', "A customer")', false],
  ['a semicolon beside a macro with no native interpretation', 'C4Context\n  Person(a, "Ann"); Person(b, "Bob")\n  Unknown(c)', true],
  ['a boundary and its statements on one line', 'C4Context\n  System_Boundary(b, "B") { Person(a, "A"); Person(c, "C") }\n  Rel(a, c, "uses")', false],
  // Mermaid's grammar trims every argument; an encoded blank stays.
  ['blanks inside the quotes of each kind of argument', 'C4Container\n  Container(c, " C ", " Java ", "\tdesc\t")\n  System_Boundary(b, " Bank ") {\n    Person(" a ", "\n  Ann\n", $descr=" A customer ")\n  }\n  Rel(" a ", c, " uses ", $techn="#32;HTTPS ")', false],
]

describe('write a Mermaid spelling of what ours reads', () => {
  test.each(C4_WRITTEN)('c4: %s', async (_construct, source, kept) => {
    const parsed = parseRegisteredMermaid(source)
    const body = parsed.ok && parsed.value.body.kind === 'c4' ? parsed.value.body : undefined
    const written = parsed.ok ? serializeMermaid(parsed.value) : ''
    if (kept) {
      expect(written).toBe(source)
      return
    }
    const mermaid = await upstream.project(written, diagram => ({
      elements: diagram.db.getC4ShapeArray().map((shape: { alias: string; label?: { text: string }; descr?: { text: string }; techn?: { text: string } }) => [shape.alias, shape.label?.text, shape.descr?.text ?? '', shape.techn?.text ?? '']),
      boundaries: diagram.db.getBoundaries().filter((boundary: { alias: string }) => boundary.alias !== 'global').map((boundary: { alias: string; label?: { text: string } }) => [boundary.alias, boundary.label?.text]),
      relationships: diagram.db.getRels().map((relation: { from: string; to: string; label?: { text: string }; techn?: { text: string } }) => [relation.from, relation.to, relation.label?.text, relation.techn?.text ?? '']),
    }))
    const read: Record<string, unknown> = mermaid.ok ? JSON.parse(JSON.stringify(mermaid.value), (_key, value) => typeof value === 'string' ? projectEntityMarkers(value) : value) : { rejected: mermaid.error }
    const ours: Record<string, unknown> = {
      elements: body?.elements.map(element => [element.id, element.label, element.description ?? '', element.technology ?? '']),
      boundaries: body?.boundaries.map(boundary => [boundary.id, boundary.label]),
      relationships: body?.relationships.map(relation => [relation.from, relation.to, relation.label, relation.technology ?? '']),
    }
    expect(read).toEqual(ours)
  })
})
