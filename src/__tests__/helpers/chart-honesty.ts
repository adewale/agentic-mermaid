// The chart-honesty corpus and its text checks (docs/design/system/chart-honesty.md).
//
// Every registered family is rendered in every style and its text is measured
// as drawn (rendered-text.ts). A family's corpus is its descriptor example and
// editor example, its Section B census fixture, and HONESTY_SAMPLES — stress
// sources for what a reader must still see: long titles, long group titles,
// authored fills, labels on data marks, and text declared after first use.
// HONESTY_SAMPLES is a Record over DiagramKind, so a new family does not
// compile until it brings its own samples.
import { BUILTIN_FAMILY_METADATA } from '../../agent/families.ts'
import { verifyMermaid } from '../../agent/index.ts'
import type { DiagramKind } from '../../agent/types.ts'
import { knownStyles, renderMermaidSVG } from '../../index.ts'
import { SECTION_B_FAMILY_CENSUS_FIXTURES } from '../../scene/section-b-census-fixtures.ts'
import { measureRenderedText, requiredContrast } from './rendered-text.ts'

export interface HonestySample {
  name: string
  source: string
  /** Authored text a reader must find drawn (wrapping may split it across
   * lines), unless verify names it in LABELS_HIDDEN. */
  expectText?: readonly string[]
}

const titled = (title: string, body: string): string => `---\ntitle: ${title}\n---\n${body}`

export const HONESTY_SAMPLES: Record<DiagramKind, readonly HonestySample[]> = {
  flowchart: [
    {
      name: 'late label and long group title',
      source: 'flowchart TD\n  a --> b\n  b[Label B]\n  subgraph g[A group title that is much longer than the single node it holds]\n    c[C]\n  end\n  a --> c',
      expectText: ['Label B', 'A group title that is much longer than the single node it holds', 'C'],
    },
    {
      name: 'authored fills',
      source: 'flowchart LR\n  A[Dark fill] --> B[Light fill] --> C[Mid fill]\n  style A fill:#1e293b\n  style B fill:#fef9c3\n  classDef mid fill:#64748b\n  class C mid',
      expectText: ['Dark fill', 'Light fill', 'Mid fill'],
    },
    {
      name: 'frontmatter title and edge labels',
      source: titled('Checkout flow', 'flowchart LR\n  A[Cart] -->|pay| B[Payment]\n  B -.->|retry| A'),
      expectText: ['Checkout flow', 'Cart', 'Payment', 'pay', 'retry'],
    },
  ],
  state: [
    {
      name: 'descriptions and long composite title',
      source: 'stateDiagram-v2\n  state "Waiting for the payment provider to confirm" as Waiting\n  [*] --> Waiting\n  Waiting --> Done : confirmed\n  Done : Order complete\n  state A_very_long_composite_state_name_that_is_wider {\n    x --> y\n  }',
      expectText: ['Waiting for the payment provider to confirm', 'confirmed', 'Order complete', 'A_very_long_composite_state_name_that_is_wider'],
    },
    {
      name: 'authored fills and title',
      source: titled('A state machine', 'stateDiagram-v2\n  classDef dark fill:#0f172a\n  classDef light fill:#fde68a\n  [*] --> Idle\n  Idle --> Busy\n  class Idle dark\n  class Busy light'),
      expectText: ['A state machine', 'Idle', 'Busy'],
    },
  ],
  sequence: [
    {
      name: 'boxes, late alias and frontmatter title',
      source: titled('Team handoff', 'sequenceDiagram\n  box Navy Dark team\n    participant A\n  end\n  box LightYellow Light team\n    participant B\n  end\n  participant A as Alice\n  A->>B: hello\n  B-->>A: hi\n  Note over A,B: shared note'),
      expectText: ['Team handoff', 'Dark team', 'Light team', 'Alice', 'hello', 'hi', 'shared note'],
    },
    {
      name: 'messages on rect backgrounds',
      source: 'sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  rect rgb(20, 20, 60)\n    A->>B: inside a dark rect\n    B-->>A: reply from the dark\n  end\n  rect rgba(0, 0, 255, 0.1)\n    A->>B: inside a pale rect\n  end',
      expectText: ['Alice', 'Bob', 'inside a dark rect', 'reply from the dark', 'inside a pale rect'],
    },
    {
      name: 'title and fragments',
      source: 'sequenceDiagram\n  title A long sequence diagram title that should stay on the canvas\n  participant C as Client\n  participant S as Server\n  loop Every minute\n    C->>S: poll\n  end\n  critical Establish a connection\n    S-->>C: ok\n  end',
      expectText: ['A long sequence diagram title that should stay on the canvas', 'Client', 'Server', 'poll', 'ok'],
    },
  ],
  class: [
    {
      name: 'namespaces and authored fills',
      source: 'classDiagram\n  namespace A_namespace_title_longer_than_its_class {\n    class X\n  }\n  class Dark\n  class Light\n  style Dark fill:#111827\n  style Light fill:#fef3c7\n  Dark <|-- Light : extends\n  X "1" --> "many" Dark',
      expectText: ['A_namespace_title_longer_than_its_class', 'X', 'Dark', 'Light', 'extends', '1', 'many'],
    },
    {
      name: 'members, annotations and title',
      source: titled('Shapes', 'classDiagram\n  class Shape {\n    <<interface>>\n    +area() double\n    -String name\n  }\n  class Circle\n  Shape <|.. Circle'),
      expectText: ['Shapes', 'Shape', '<<interface>>', 'Circle'],
    },
  ],
  er: [
    {
      name: 'attributes, comments and authored fills',
      source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string id PK "identifier"\n    string email UK\n  }\n  ORDER {\n    int id PK\n    int customer FK\n  }\n  style CUSTOMER fill:#1f2937\n  style ORDER fill:#fef3c7',
      expectText: ['CUSTOMER', 'ORDER', 'places', 'identifier', 'email'],
    },
    {
      name: 'title',
      source: titled('Order model', 'erDiagram\n  CUSTOMER ||--o{ ORDER : places'),
      expectText: ['Order model', 'CUSTOMER', 'ORDER', 'places'],
    },
  ],
  timeline: [
    {
      name: 'long title and sections',
      source: 'timeline\n  title A long timeline title that is wider than the two periods it describes\n  section Early\n    2020 : Founded\n  section Later\n    2024 : Series A : Hiring',
      expectText: ['A long timeline title that is wider than the two periods it describes', 'Early', 'Later', '2020', 'Founded', '2024', 'Series A', 'Hiring'],
    },
    {
      name: 'frontmatter title',
      source: titled('Company history', 'timeline\n  2020 : Founded\n  2024 : Series A'),
      expectText: ['Company history', 'Founded', 'Series A'],
    },
  ],
  journey: [
    {
      name: 'long title',
      source: 'journey\n  title A very long journey title that is much wider than the single task below it\n  section Try\n    Sign up: 3: Me',
      expectText: ['A very long journey title that is much wider than the single task below it', 'Try', 'Sign up'],
    },
    {
      name: 'frontmatter title',
      source: titled('Onboarding', 'journey\n  section Try\n    Sign up: 3: Me\n    Invite team: 4: Me, Admin'),
      expectText: ['Onboarding', 'Try', 'Sign up', 'Invite team'],
    },
  ],
  architecture: [
    {
      name: 'long title and group',
      source: 'architecture-beta\n  title An architecture title far longer than the one service in this diagram\n  group g(cloud)[A group label longer than its only service]\n  service s(server)[S] in g',
      expectText: ['An architecture title far longer than the one service in this diagram', 'A group label longer than its only service', 'S'],
    },
    {
      name: 'frontmatter title',
      source: titled('Platform', 'architecture-beta\n  service api(server)[API]\n  service db(database)[Database]\n  api:R --> L:db'),
      expectText: ['Platform', 'API', 'Database'],
    },
  ],
  xychart: [
    {
      name: 'legend and labels',
      source: 'xychart-beta\n  title Quarterly revenue by channel\n  x-axis [January, February, March, April]\n  y-axis "Revenue (k$)" 0 --> 120\n  bar "Online store" [30, 55, 80, 100]\n  line "Retail forecast" [25, 60, 75, 110]',
      expectText: ['Quarterly revenue by channel', 'January', 'February', 'March', 'April', 'Revenue (k$)', 'Online store', 'Retail forecast'],
    },
    {
      name: 'frontmatter title and value labels',
      source: '---\ntitle: Signups\nconfig:\n  xyChart:\n    showDataLabel: true\n---\nxychart-beta\n  x-axis [Mon, Tue, Wed]\n  bar [12, -4, 30]\n  line [10, 5, 25]',
      expectText: ['Signups', 'Mon', 'Tue', 'Wed'],
    },
  ],
  pie: [
    {
      name: 'many slices with long names',
      source: 'pie title Browser share with a longer than usual title\n  "Chrome" : 64.5\n  "Safari" : 19.1\n  "An engine with a very long display name" : 3.2\n  "Firefox" : 3.1\n  "Other" : 10.1',
      expectText: ['Browser share with a longer than usual title', 'Chrome', 'Safari', 'Firefox', 'Other'],
    },
    {
      name: 'frontmatter title',
      source: titled('Pets', 'pie\n  "Dogs" : 386\n  "Cats" : 85'),
      expectText: ['Pets', 'Dogs', 'Cats'],
    },
  ],
  quadrant: [
    {
      name: 'crowded points and long axis labels',
      source: 'quadrantChart\n  title A quadrant title that is longer than the chart is wide at the default size\n  x-axis A very long low-effort axis label --> A very long high-effort axis label\n  y-axis Low --> High\n  quadrant-1 Invest\n  quadrant-2 Plan\n  quadrant-3 Defer\n  quadrant-4 Drop\n  Alpha: [0.30, 0.60]\n  Beta: [0.31, 0.61]\n  Referrals: [0.32, 0.62]',
      expectText: ['A quadrant title that is longer than the chart is wide at the default size', 'Invest', 'Plan', 'Defer', 'Drop', 'Alpha', 'Beta', 'Referrals'],
    },
    {
      name: 'frontmatter title',
      source: titled('Priorities', 'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  Ship it: [0.8, 0.8]'),
      expectText: ['Priorities', 'Ship it'],
    },
  ],
  gantt: [
    {
      name: 'states and long task names',
      source: 'gantt\n  title Release plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Done work :done, d1, 2026-01-01, 3d\n  Active work :active, a1, after d1, 3d\n  Critical work :crit, c1, after a1, 2d\n  A task whose name is much longer than its bar :t1, after c1, 1d',
      expectText: ['Release plan', 'Build', 'Done work', 'Active work', 'Critical work', 'A task whose name is much longer than its bar'],
    },
    {
      name: 'frontmatter title',
      source: titled('Roadmap', 'gantt\n  dateFormat YYYY-MM-DD\n  section Plan\n  Scope :s1, 2026-02-01, 4d'),
      expectText: ['Roadmap', 'Plan', 'Scope'],
    },
  ],
  mindmap: [
    {
      name: 'shapes, depth and title',
      source: titled('Ideas', 'mindmap\n  root((A central idea))\n    Branch one\n      Leaf a\n      Leaf b\n    [Square branch]\n      Leaf c\n    (Rounded branch)'),
      expectText: ['Ideas', 'A central idea', 'Branch one', 'Leaf a', 'Leaf b', 'Square branch', 'Leaf c', 'Rounded branch'],
    },
  ],
  gitgraph: [
    {
      name: 'branches, tags and title',
      source: titled('Release train', 'gitGraph\n  commit id:"init"\n  branch develop\n  commit id:"feature work" tag:"v0.1"\n  branch hotfix\n  commit id:"patch"\n  checkout main\n  merge develop\n  merge hotfix'),
      expectText: ['Release train', 'main', 'develop', 'hotfix', 'v0.1'],
    },
  ],
  radar: [
    {
      name: 'curves and frontmatter title',
      source: titled('Skills', 'radar-beta\n  axis speed["Speed"], power["Power"], range["Range"], stealth["Stealth"]\n  curve a["Scout"]{4, 2, 5, 3}\n  curve b["Tank"]{2, 5, 2, 1}\n  max 5'),
      expectText: ['Skills', 'Speed', 'Power', 'Range', 'Stealth', 'Scout', 'Tank'],
    },
  ],
  sankey: [
    {
      name: 'labels over ribbons and title',
      source: titled('Energy', 'sankey-beta\n  Solar,Grid,40\n  Wind,Grid,30\n  Grid,Homes,50\n  Grid,Industry,20'),
      expectText: ['Energy', 'Solar', 'Wind', 'Grid', 'Homes', 'Industry'],
    },
  ],
}

/** Every source a family is held to: the examples it teaches, the Section B
 * census fixture, and its stress samples. */
export function honestyCorpus(kind: DiagramKind): HonestySample[] {
  const metadata = BUILTIN_FAMILY_METADATA.find(family => family.id === kind)!
  const corpus: HonestySample[] = [{ name: 'example', source: metadata.example }]
  if (metadata.editorExample !== metadata.example) corpus.push({ name: 'editor example', source: metadata.editorExample })
  const census = SECTION_B_FAMILY_CENSUS_FIXTURES[kind]
  if (census) corpus.push({ name: 'census fixture', source: census })
  return [...corpus, ...HONESTY_SAMPLES[kind]]
}

/** The default renderer and every registered style (palettes and looks). */
export const HONESTY_STYLES: ReadonlyArray<string | undefined> = [undefined, ...knownStyles()]

export interface HonestyViolation {
  /** chart-honesty.md principle the text breaks. */
  principle: 'legible' | 'on-canvas' | 'drawn' | 'style-invariant'
  style: string
  text: string
  detail: string
}

/** Drawn text reduced to what a reader compares: case, whitespace, and the
 * hyphens a wrapped word gains at its break are not content. */
function reading(text: string): string {
  return text.toLocaleLowerCase('en-US').replace(/[\s-]+/g, '')
}

/** Everything the text principles find wrong with one source across `styles`. */
export function textHonestyViolations(sample: HonestySample, styles: ReadonlyArray<string | undefined> = HONESTY_STYLES): HonestyViolation[] {
  const violations: HonestyViolation[] = []
  let baseline: string | undefined
  for (const style of styles) {
    const name = style ?? 'default'
    const census = measureRenderedText(renderMermaidSVG(sample.source, style ? { style } : {}))
    const drawn = census.texts.map(text => text.content).filter(content => content !== '')
    // Styles restyle; they never add, drop, or reorder what is read (they may
    // change case and where a line, or an unbreakable word, wraps).
    const read = reading(drawn.join(''))
    if (baseline === undefined) baseline = read
    else if (read !== baseline) {
      let at = 0
      while (at < read.length && read[at] === baseline[at]) at++
      const excerpt = (text: string) => JSON.stringify(text.slice(Math.max(0, at - 16), at + 16))
      violations.push({ principle: 'style-invariant', style: name, text: '', detail: `reads ${excerpt(read)} where the first style reads ${excerpt(baseline)}` })
    }
    for (const text of census.texts) {
      if (text.content === '') continue
      if (text.pixels === 0) {
        violations.push({ principle: 'on-canvas', style: name, text: text.content, detail: 'draws no glyphs on or near the canvas' })
        continue
      }
      if (text.offCanvasPixels > 0) {
        violations.push({ principle: 'on-canvas', style: name, text: text.content, detail: `${text.offCanvasPixels} of ${text.pixels} glyph pixels are off the canvas` })
      }
      if (text.contrast !== undefined && text.contrast < requiredContrast(text)) {
        violations.push({
          principle: 'legible',
          style: name,
          text: text.content,
          detail: `${text.ink} on ${text.surround} is ${text.contrast.toFixed(2)}:1, below ${requiredContrast(text)}:1`,
        })
      }
    }
    // Presence is checked once, in the first style (the default in a census).
    if (style === styles[0] && sample.expectText) {
      const reported = new Set(verifyMermaid(sample.source, style ? { renderOptions: { style } } : {}).warnings.flatMap(warning => warning.code === 'LABELS_HIDDEN' ? warning.labels : []))
      for (const expected of sample.expectText) {
        if (!read.includes(reading(expected)) && !reported.has(expected)) {
          violations.push({ principle: 'drawn', style: name, text: expected, detail: 'is authored but neither drawn nor reported by verify (LABELS_HIDDEN)' })
        }
      }
    }
  }
  return violations
}

/** How many chart-honesty-text-<part>.test.ts files share the registry. */
export const HONESTY_PARTS = 4

/** The families test file `part` checks: the registry split by position, so
 * every family (a new one included) lands in exactly one file. */
export function honestyPartition(part: number): DiagramKind[] {
  return BUILTIN_FAMILY_METADATA.map(family => family.id).filter((_id, index) => index % HONESTY_PARTS === part - 1)
}

/** One line per violation, readable in a failing assertion. */
export function describeViolations(kind: DiagramKind, sample: HonestySample, violations: readonly HonestyViolation[]): string[] {
  return violations.map(violation => `${kind} / ${sample.name} [${violation.style}] ${violation.principle}: ${violation.text ? `"${violation.text}" ` : ''}${violation.detail}`)
}
