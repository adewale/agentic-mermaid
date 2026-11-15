/**
 * Fixed mutation fragments for the seeded grammar comparison, beside the token
 * images Mermaid's lexer produced on the documentation corpus. Those images
 * hold only spellings the docs use; the silent reads found by hand lived in
 * spellings they avoid: an empty pipe label, a repeated edge id, an entity
 * code, a keyword or digit-led name, an unterminated directive.
 *
 * Each group names the pinned Mermaid rule that treats its fragments
 * specially. The lists are bounded and their order is part of the seeded
 * stream: the generator picks a fragment by index, so an edit here changes
 * every mutation of a seed, as a new corpus document does.
 */

type Groups = readonly (readonly string[])[]

const COMMON: Groups = [
  // Separators: Jison rules split on `\s`, `[ \t]`, `\r?\n` or `[\n]+`; `.`
  // stops at U+2028 where `[^\n]` does not.
  [' ', '  ', '\n', '\r\n', '\r', '\t', '\u00a0', '\u2028', '\ufeff'],
  [';', ':', ',', '"', "'", '{', '}', '[', ']', '(', ')', '|', '||', '@', '&', '#', '*', '<', '>', '\\', '`', '~', '=', '.', '+', '-', '/', '^', '!', '$'],
  // Empty, unbalanced and Markdown strings (`["][`]` openers in Flowchart and Mindmap).
  ['""', "''", '"`', '`"'],
  // diagram-api/regexes.ts: `anyCommentRegex`, `directiveRegex` (its `}%%` is
  // optional, so `%%{` alone opens a directive) and `frontMatterRegex`.
  ['%%', '%% c\n', '%%{', '}%%', '%%{init: {"theme": "dark"}}%%', '---\n'],
  // utils.ts `encodeEntities`: `#\w+;` becomes a placeholder before any grammar
  // runs; the renderer decodes HTML references and `<br>` in labels.
  ['#quot;', '#35;', '#233;', '#name;', '#a;', '&amp;', '&lt;', '&#35;', '\\n', '<br>', '<br/>'],
  // Shared accessibility and title statements.
  ['accTitle: t\n', 'accDescr: d\n', 'accDescr {\nd\n}\n', 'title t\n'],
  // Names: digit-led, and keywords some grammar reserves.
  ['1ABC', '0', 'end', 'class', 'style', 'note', 'state', 'default', 'click', 'call', 'direction'],
  // Non-ASCII: precomposed and combining accents, CJK, an astral emoji, right-to-left.
  ['é', 'e\u0301', '中文', '🤓', 'ש'],
]

const FAMILY: Readonly<Record<string, Groups>> = {
  flowchart: [
    // flowchart/parser/flow.jison: LINK_ID `[^\s\"]+\@`, SHAPE_DATA `@{`, SEP `|`, STYLE_SEPARATOR `:::`.
    ['e1@', 'e1@-->', ' e1@--> ', '@{ shape: rect }', '@{', '-->|', '-->||', '|""|', '|a@-->b|', ':::', ':::c'],
    // Link and shape openers, including the `x`/`o` markers and the `(-` ellipse.
    ['---', '-.->', '==>', '~~~', '--x', '--o', 'x--', 'o--', '<-->', '<<-->', '-- t -->', '[""]', '[[', ']]', '([', '])', '[(', ')]', '(((', ')))', '[/', '[\\', '{{', '}}', '[|', '(-', '-)'],
    // Keywords the lexer takes before NODE_STRING; `v` is DOWN.
    ['subgraph', 'linkStyle', 'classDef', 'href', '_blank', 'interpolate', 'graph', 'v', 'x', 'o'],
    // Statements; encodeEntities drops the last `;` of a `style … :…#…;` line.
    ['\nA -->|| B\n', '\nA[""]\n', '\nA e1@--> B\nC e1@--> D\n', '\nA &amp; B --> C\n', '\nstyle A color:x#a;\n', '\nend --> A\n', '\nsubgraph ""\nend\n', '\nclick A call cb()\n', '\nA@{ shape: rect, label: "x" }\n'],
  ],
  state: [
    // state/parser/stateDiagram.jison: `#` and `%%` comments, `[*]`, fork/join/choice in
    // both spellings, `--` concurrency, `note … end note`, `as`, `scale`.
    ['[*]', '[*] --> ', 'state "d" as ', 'note left of', 'note right of', 'end note', '<<fork>>', '<<join>>', '<<choice>>', '[[fork]]', '[[choice]]', '--', ':::', ':::c', ' as ', 'direction LR', 'hide empty description', 'scale 1 width', 'classDef', 'href', '<<-->'],
    ['\nnote right of A : n\n', '\nnote "f" as N\n', '\nstate --> A\n', '\nnote --> class\n', '\nA --> end\n', '\nstate A {\n}\n', '\nA:::c --> B\n', '\nA: d: e\n'],
  ],
  sequence: [
    // sequence/parser/sequenceDiagram.jison: arrows, half-arrows and the `()` central connection.
    ['->>', '-->>', '->', '-x', '--x', '-)', '--)', '<<->>', '<<-->>', '-|\\', '-|/', '--|\\', '-\\\\', '-//', '/|-', '\\|-', '()'],
    // Keywords, `@{` actor configuration, `#` comments, NUM and `:wrap:`.
    ['participant', 'actor', ' as ', '@{ "type": "database" }', 'create', 'destroy', 'activate', 'deactivate', 'note over A,B: n', 'left of', 'right of', 'box', 'rect rgb(0,0,0)', 'loop', 'alt', 'else', 'opt', 'par', 'par_over', 'and', 'critical', 'option', 'break', 'autonumber', 'off'],
    ['links', 'properties', 'details', 'title:', ':wrap:', ':nowrap:', '1.5 ', '\nparticipant end\n', '\nA->>+B: m\n', '\nlinks A: {"x": "https://e"}\n'],
  ],
  class: [
    // class/parser/classDiagram.jison: relation ends, `()` lollipop, `<<`/`>>`, `~` generics, `call`, `note for`.
    ['<|--', '*--', 'o--', '..>', '..|>', '--', '..', '()', '<<interface>>', '<<', '>>', '~T~', '$', 'namespace', 'note for', 'cssClass', 'callback', 'link', 'href', '_blank', '[*]', '"1"', '"*"', 'classDef', ':::'],
    ['\nclass end\n', '\ncall --> A\n', '\nclass A["L"]\n', '\nA : +m()$\n', '\nnamespace N {\n}\n'],
  ],
  er: [
    // er/parser/erDiagram.jison: cardinality words and glyphs, the `u` parent, `.-`/`-.`, keys, comments, subgraph.
    ['||--o{', '}|..|{', '|o--o|', '}o--||', '|{', 'o{', '}|', 'u|', 'PK', 'FK', 'UK', 'PK, FK', '"c"', 'one or more', 'zero or many', 'only one', 'many(0)', '1+', '0+', ' to ', 'optionally to', '.-', '-.', '~T~', 'subgraph', 'classDef', ':::'],
    ['\nA ||--o{ B : ""\n', '\nA {\nstring n PK "c"\n}\n', '\nend ||--|| class : r\n'],
  ],
  c4: [
    // c4/parser/c4Diagram.jison: macro names, `$` keyword arguments, update statements.
    ['Person(', 'Person_Ext(', 'System(', 'SystemDb(', 'ContainerQueue(', 'Boundary(', 'Enterprise_Boundary(', 'Deployment_Node(', 'Node_L(', 'Rel(', 'BiRel(', 'Rel_U(', 'UpdateElementStyle(', 'UpdateRelStyle(', 'UpdateLayoutConfig(', '$tags=', '$link=', '$sprite=', '""', '"a, b"'],
  ],
  architecture: [
    // packages/parser architecture.langium and common.langium: STRING takes single
    // quotes and `\` escapes; ID cannot end with `-`; INT has no leading zero.
    ['service', 'group', 'junction', ' in ', '(cloud)', '[L]', ':L', ':R', ':T', ':B', '--', '-->', '<--', '<-->', '{group}', 'align', 'row', 'column', "'t'", 'a-', '01'],
  ],
  gantt: [
    // gantt/parser/gantt.jison: keyword statements take the rest of the line up to `#` or `;`.
    ['dateFormat YYYY-MM-DD', 'axisFormat %d', 'tickInterval 1week', 'includes 2024-01-01', 'excludes weekends', 'weekend friday', 'weekday monday', 'todayMarker off', 'inclusiveEndDates', 'topAxis', 'section', 'after a', 'until b'],
    ['crit', 'done', 'active', 'milestone', 'vert', 'click a call cb()', 'href "x"', '1d', '24h', '2014-01-01'],
  ],
  // gitGraph.langium.
  gitgraph: [['commit', 'id: "x"', 'tag: "t"', 'type: HIGHLIGHT', 'type: REVERSE', 'msg: "m"', 'branch', 'order: 1', 'checkout', 'switch', 'merge', 'cherry-pick', 'parent: "p"', 'LR:', 'TB:', 'gitGraph:', "'s'", '"a\\"b"', '01']],
  // user-journey/parser/journey.jison: a task is `name: score: actors`.
  journey: [['section', ': 5: A', ': ', '5', '-1', '6', '1.5']],
  // mindmap/parser/mindmap.jison: `::icon(`, `:::`, shape delimiters, indentation.
  mindmap: [['::icon(fa fa-book)', ':::c', '((', '))', '{{', '}}', '(-', '-)', '))x((', '\n  ', '\n    child']],
  // pie.langium: NUMBER is FLOAT or INT, with no sign or exponent.
  pie: [['showData', '"x" : 1', '-1', '1e3', '.5', '1.', '01', '"a\\"b"', "'s'"]],
  // quadrant-chart/parser/quadrant.jison: point styles and classes.
  quadrant: [['quadrant-1', 'quadrant-4', 'x-axis', 'y-axis', ' --> ', '[0.5, 0.5]', 'radius: 9', 'color: #f00', 'stroke-color: #f00', 'stroke-width: 2px', 'classDef c', ':::c', '-0.1', '1e3']],
  // radar.langium.
  radar: [['axis', 'curve', 'max', 'min', 'ticks', 'graticule', 'circle', 'polygon', 'showLegend', '["x"]', 'radar-beta:', 'true', '-1', '1.5', '01']],
  // sankey/parser/sankey.jison: RFC 4180 fields; `""` escapes a quote.
  sankey: [['sankey-beta', '"a,b"', '"a""b"', '1e3', '-1', '.5']],
  // timeline/parser/timeline.jison.
  timeline: [['section', ' : ', '<br>']],
  // xychart/parser/xychart.jison.
  xychart: [['x-axis', 'y-axis', 'bar', 'line', ' --> ', 'horizontal', 'xychart-beta', '1e3', '-1', '.5', '"a b"', 'title "t"']],
}

/** The fixed fragments for one family: the shared groups, then the family's own. */
export function curatedFragments(family: string): readonly string[] {
  return [...COMMON, ...(FAMILY[family] ?? [])].flat()
}
