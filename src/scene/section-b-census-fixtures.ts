import type { BuiltinFamilyId } from '../agent/families.ts'

/**
 * Rich, deterministic inputs for the generated Section B executable census.
 * Descriptor examples remain the discovery authority; these witnesses add
 * syntax needed to exercise every declared Scene role and semantic channel.
 */
export const SECTION_B_FAMILY_CENSUS_FIXTURES: Readonly<Partial<Record<BuiltinFamilyId, string>>> = Object.freeze({
  flowchart: `flowchart LR
  subgraph ops[Operations]
    A@{ icon: "fa fa-book", form: "circle", label: "Start" }
    U@{ icon: "acme:unknown", label: "Fallback" }
  end
  U --> A -->|go| B{Ready?}`,
  state: `stateDiagram-v2
  state Work {
    [*] --> Draft
    Draft --> Done : finish
  }
  note right of Work : Review
  [*] --> Work`,
  sequence: `sequenceDiagram
  box Aqua Team
    participant A as Alice
    participant B@{ "type": "database", "alias": "Bob" }
  end
  link A: profile @ https://example.com
  activate A
  A->>B: request
  alt accepted
    B-->>A: response
  else delayed
    Note over A,B: wait
  end
  deactivate A
  destroy B
  A->>()B: publish
  A-xB: done`,
  timeline: `timeline
  title Launch
  section Alpha
    2026 Q1 : Design : Build
  section Beta
    2026 Q2 : Ship`,
  class: `classDiagram
  namespace Domain {
    class Account {
      +id: string
      +close()
    }
  }
  class Ledger
  note for Account "Aggregate root"
  Account "1" o-- "*" Ledger : records`,
  er: `erDiagram
  subgraph Commerce
    CUSTOMER ||--o{ ORDER : places
    CUSTOMER {
      string id PK "stable customer identifier"
      string name
    }
  end
  ORDER {
    string id PK
  }`,
  journey: `journey
  title Checkout
  section Browse
    Find product: 4: Shopper, Assistant
  section Buy
    Pay: 2: Shopper`,
  architecture: `architecture-beta
  title Platform
  group app(cloud)[Application]
  service api(server)[API] in app
  service db(database)[Database] in app
  junction bus in app
  api:R --> L:bus
  bus:R -[writes]-> L:db`,
  xychart: `---
config:
  xyChart:
    showDataLabel: true
---
xychart-beta
  title Revenue
  x-axis [Q1, Q2, Q3]
  y-axis USD 0 --> 100
  bar Online [30, 55, 80]
  line Forecast [25, 60, 75]`,
  pie: `---
config:
  pie:
    highlightSlice: Pro
---
pie showData
  title Plans
  "Free" : 60
  "Pro" : 30
  "Enterprise" : 10`,
  quadrant: `quadrantChart
  title Prioritize
  x-axis Low Effort --> High Effort
  y-axis Low Value --> High Value
  quadrant-1 Invest
  Quick win: [0.2, 0.8]
  Money pit: [0.8, 0.2]`,
  gantt: `gantt
  title Delivery
  dateFormat YYYY-MM-DD
  section Build
  Complete :done, complete, 2026-01-01, 2d
  Implement :crit, build, 2026-01-05, 5d
  Release :milestone, release, after build, 0d
  Cutover :vert, cutover, 2026-01-09, 0d`,
  mindmap: `mindmap
  root((Product))
    Research
      ::icon(fa fa-book)
      Interviews
      Evidence
    Delivery
      ::icon(acme:unknown)
      Launch`,
  gitgraph: `---
title: Release train
---
gitGraph
  commit id:"base" tag:"v1"
  branch feature
  commit id:"work"
  checkout main
  merge feature id:"merge"`,
  sankey: `---
title: Energy flows
---
sankey-beta
  Coal,Electricity generation,127.93
  Gas,Electricity generation,151.89
  Electricity generation,Industry,342.16
  Electricity generation,Losses,56.69`,
})
