// Representative diagrams for the typography lab. Every built-in family's
// canonical example is added by the worker; these add the text kinds the
// examples omit (titles, legends, axes, notes, members, wrapped labels) and
// the size inputs whose treatment the options must keep consistent.

export interface LabCase {
  readonly id: string
  readonly family: string
  readonly source: string
  /** A global Mermaid size the source sets (top-level fontSize or
   * themeVariables.fontSize), in px, so the runner can render the absolute
   * and relative readings of it. */
  readonly mermaidSize?: number
  readonly note?: string
}

export const STRESS_CASES: readonly LabCase[] = [
  { id: 'flowchart-groups', family: 'flowchart', source: 'flowchart LR\n  subgraph ingest [Ingest pipeline]\n    A[Receive webhook] -->|validate| B{Signature ok?}\n    B -->|yes| C[Queue event]\n    B -->|no| D[Reject with 401]\n  end\n  C --> E[(Event store)]\n  E -.->|replay nightly| F[Rebuild read models for every tenant]' },
  { id: 'class-members', family: 'class', source: 'classDiagram\n  class Order {\n    +String id\n    +List~Line~ lines\n    +total() Money\n  }\n  class Line {\n    +int quantity\n    +Money price\n  }\n  Order "1" *-- "many" Line : contains\n  note for Order "Aggregate root"' },
  { id: 'sequence-notes', family: 'sequence', source: 'sequenceDiagram\n  participant U as User\n  participant A as API\n  participant D as Database\n  U->>A: POST /orders\n  loop Retry up to 3 times\n    A->>D: INSERT order\n    D-->>A: ok\n  end\n  Note over A,D: Transaction committed\n  A-->>U: 201 Created' },
  { id: 'gantt-titled', family: 'gantt', source: 'gantt\n  title Release plan\n  dateFormat YYYY-MM-DD\n  section Build\n    Design      :a1, 2026-01-05, 5d\n    Implement   :a2, after a1, 10d\n  section Ship\n    Beta        :b1, after a2, 5d\n    Launch      :milestone, after b1, 0d' },
  { id: 'xychart-titled', family: 'xychart', source: 'xychart-beta\n  title "Monthly signups"\n  x-axis [Jan, Feb, Mar, Apr, May]\n  y-axis "Signups" 0 --> 500\n  bar [120, 210, 260, 340, 420]\n  line [100, 180, 250, 330, 400]' },
  { id: 'pie-titled', family: 'pie', source: 'pie showData\n  title Traffic sources\n  "Search" : 52\n  "Direct" : 23\n  "Referral" : 15\n  "Social" : 10' },
  { id: 'timeline-sections', family: 'timeline', source: 'timeline\n  title Product history\n  section Early\n    2019 : Prototype : First customer\n    2020 : Seed round\n  section Growth\n    2022 : Series A : 100 customers\n    2024 : Global launch' },
  { id: 'journey-titled', family: 'journey', source: 'journey\n  title Checkout\n  section Browse\n    Find product: 5: Shopper\n    Compare prices: 3: Shopper\n  section Buy\n    Enter card: 2: Shopper, Bank\n    Confirm: 4: Shopper' },
  { id: 'quadrant-titled', family: 'quadrant', source: 'quadrantChart\n  title Feature priorities\n  x-axis Low effort --> High effort\n  y-axis Low value --> High value\n  quadrant-1 Plan\n  quadrant-2 Do now\n  quadrant-3 Drop\n  quadrant-4 Maybe\n  Search: [0.3, 0.8]\n  Export: [0.7, 0.6]\n  Themes: [0.2, 0.2]' },
  { id: 'radar-legend', family: 'radar', source: 'radar-beta\n  title Team skills\n  axis Design, Backend, Frontend, Ops, Data\n  curve alice["Alice"]{4, 3, 5, 2, 3}\n  curve bob["Bob"]{2, 5, 3, 4, 4}\n  max 5' },
  { id: 'er-attributes', family: 'er', source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string id PK\n    string email\n  }\n  ORDER {\n    string id PK\n    string customer_id FK\n    date placed_at\n  }' },
  { id: 'architecture-groups', family: 'architecture', source: 'architecture-beta\n  group edge(cloud)[Edge]\n  group data(cloud)[Data]\n  service api(server)[API] in edge\n  service db(database)[Primary DB] in data\n  api:R --> L:db' },
  { id: 'requirement-card', family: 'requirement', source: 'requirementDiagram\n  requirement login {\n    id: 1\n    text: Users sign in with SSO\n    risk: high\n    verifymethod: test\n  }\n  element portal {\n    type: service\n  }\n  portal - satisfies -> login' },
]

/** Size inputs the input policy must keep working or now honour. */
export const INPUT_CASES: readonly LabCase[] = [
  { id: 'input-top-level-20', family: 'flowchart', mermaidSize: 20, note: 'top-level fontSize 20 (ignored today)', source: '%%{init: {"fontSize": 20}}%%\nflowchart LR\n  A[Receive order] -->|valid| B[Charge card]\n  B --> C[Ship]' },
  { id: 'input-theme-16px', family: 'flowchart', mermaidSize: 16, note: 'themeVariables.fontSize "16px", Mermaid\'s default (ignored today)', source: '%%{init: {"themeVariables": {"fontSize": "16px"}}}%%\nflowchart LR\n  A[Receive order] -->|valid| B[Charge card]\n  B --> C[Ship]' },
  { id: 'input-architecture-20', family: 'architecture', mermaidSize: 20, note: 'top-level fontSize 20 (honoured today)', source: '%%{init: {"fontSize": 20}}%%\narchitecture-beta\n  group edge(cloud)[Edge]\n  service api(server)[API] in edge\n  service db(database)[DB]\n  api:R --> L:db' },
  { id: 'input-radar-24', family: 'radar', mermaidSize: 24, note: 'themeVariables.fontSize 24 (radar title honours it today)', source: '%%{init: {"themeVariables": {"fontSize": 24}}}%%\nradar-beta\n  title Team skills\n  axis Design, Backend, Ops\n  curve a["Alice"]{4, 3, 5}\n  max 5' },
  { id: 'input-journey-section-key', family: 'journey', note: 'journey.taskFontSize 20 (family key, honoured today)', source: '%%{init: {"journey": {"taskFontSize": 20}}}%%\njourney\n  title Checkout\n  section Buy\n    Enter card: 2: Shopper\n    Confirm: 4: Shopper' },
  { id: 'input-requirement-per-node', family: 'requirement', note: 'style font-size:20px (honoured today)', source: 'requirementDiagram\n  requirement login {\n    id: 1\n    text: Users sign in with SSO\n  }\n  style login font-size:20px' },
  { id: 'input-flowchart-per-node', family: 'flowchart', note: 'style font-size:20px (ignored today; to be honoured)', source: 'flowchart LR\n  A[Receive order] --> B[Charge card]\n  style A font-size:20px' },
]
