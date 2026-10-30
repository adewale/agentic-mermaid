// One source template per built-in family with a label slot (and, where the
// family has authored identities, an id slot), plus the hostile text domain the
// cross-surface properties draw for those slots. Shared by the SVG
// well-formedness, verify-agreement and terminal-safety properties so they
// exercise the same inputs.
import fc from 'fast-check'
import type { DiagramKind } from '../../agent/types.ts'

export const FAMILY_LABEL_SOURCES: Record<DiagramKind, (label: string) => string> = {
  zenuml: label => `zenuml\nA->B: ${label.replace(/[\r\n]/g, ' ')}`,
  eventmodeling: label => `eventmodeling\ntf 01 ui CartUI {${label.replace(/[\r\n]/g, ' ')}}`,
  packet: label => `packet\n+16: ${JSON.stringify(label)}`,
  kanban: label => `kanban\nTodo\n  task["${label}"]`,
  requirement: label => `requirementDiagram\nrequirement r {\ntext: "${label}"\n}`,
  treemap: label => `treemap\n"${label}": 10`,
  ishikawa: label => `ishikawa\n  ${label}\n  Process\n    Cause`,
  block: label => `block\nA["${label}"]`,
  c4: label => `C4Context\n  System(A, "${label}", "${label}")`,
  flowchart: label => `graph TD\n  A["${label}"] -->|${label}| B["${label}"]`,
  state: label => `stateDiagram-v2\n  state "${label}" as A\n  A --> B : ${label}`,
  sequence: label => `sequenceDiagram\n  participant A as ${label}\n  A->>B: ${label}\n  B-->>A: ${label}`,
  class: label => `classDiagram\n  class A {\n    +f(${label}) int\n  }\n  A <|-- B : ${label}`,
  er: label => `erDiagram\n  CUSTOMER ||--o{ ORDER : "${label}"`,
  timeline: label => `timeline\n  title ${label}\n  2024 : ${label}`,
  journey: label => `journey\n  title ${label}\n  section ${label}\n  ${label}: 5: me`,
  // Mermaid reads architecture titles other than words and spaces only quoted.
  architecture: label => `architecture-beta\n  service api(server)["${label}"]`,
  xychart: label => `xychart\n  title "${label}"\n  x-axis ["${label}", "b"]\n  bar [1, 2]`,
  pie: label => `pie\n  "${label}" : 1`,
  quadrant: label => `quadrantChart\n  title ${label}\n  ${label}: [0.3, 0.7]`,
  gantt: label => `gantt\n  dateFormat YYYY-MM-DD\n  section ${label}\n  ${label} :a, 2026-01-01, 1d`,
  // A Mindmap shape ends at its first `]` outside quotes (`]]>`).
  mindmap: label => `mindmap\n  root["${label}"]\n    child["${label}"]`,
  gitgraph: label => `gitGraph\n  commit id:"a" msg:"${label}"`,
  radar: label => `radar-beta\n  axis a["${label}"], b, c\n  curve now["${label}"]{1,2,3}\n  max 5`,
  sankey: label => `sankey-beta\n  "${label}",sink,1`,
}

/** Families whose source names an authored identity, written into that slot. */
export const FAMILY_ID_SOURCES: Partial<Record<DiagramKind, (id: string) => string>> = {
  flowchart: id => `flowchart LR\n  ${id} --> B`,
  sequence: id => `sequenceDiagram\n  ${id}->>B: hi`,
  class: id => `classDiagram\n  class ${id}\n  ${id} <|-- B`,
  state: id => `stateDiagram-v2\n  ${id} --> B`,
  er: id => `erDiagram\n  ${id} ||--o{ B : has`,
  mindmap: id => `mindmap\n  root\n    ${id}`,
  gitgraph: id => `gitGraph\n  commit id:"${id}"\n  commit`,
  kanban: id => `kanban\n  ${id}[x]`,
  block: id => `block\n  ${id}`,
  requirement: id => `requirementDiagram\nrequirement ${id} {\ntext: "x"\n}`,
  c4: id => `C4Context\n  Person(${id}, "x")\n  System(B, "y")\n  Rel(${id}, B, "uses")`,
  architecture: id => `architecture-beta\n  service ${id}(server)[X]\n  service b(server)[Y]\n  ${id}:R --> L:b`,
  zenuml: id => `zenuml\n${id}->B: x`,
  sankey: id => `sankey-beta\n  ${id},B,1`,
  quadrant: id => `quadrantChart\n  ${id}: [0.3, 0.7]`,
}

// Every Unicode scalar (C0/C1 controls, noncharacters, bidi controls, astral
// characters), lone surrogate code units, Mermaid entities for every code
// point and just past U+10FFFF, and hostile tokens that have broken a surface.
const hostilePieceArb = fc.oneof(
  fc.integer({ min: 0, max: 0x10ffff }).map(code => String.fromCodePoint(code)),
  fc.integer({ min: 0xd800, max: 0xdfff }).map(code => String.fromCharCode(code)),
  fc.integer({ min: 0, max: 0x10ffff + 16 }).map(code => `#${code};`),
  fc.constantFrom('\u202e', '\u2066', '\u2069', '\ufffe', '\uffff', '\ufdd0', '\u{10ffff}', '#65534;', '#65535;', '\u0007', 'a->b', 'branch:main', 'x', 'é', '😀'),
)

/** Label/id text: short hostile mixtures, very long runs, and the empty string. */
export const hostileTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.array(hostilePieceArb, { minLength: 1, maxLength: 6 }).map(pieces => pieces.join('')) },
  { weight: 2, arbitrary: fc.tuple(fc.constantFrom('x', 'é', '😀', '\ufffe', '#65534;'), fc.integer({ min: 200, max: 700 })).map(([piece, count]) => piece.repeat(count)) },
  { weight: 1, arbitrary: fc.constant('') },
)
