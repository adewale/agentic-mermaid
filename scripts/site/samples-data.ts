/**
 * Sample definitions for the Agentic Mermaid visual test suite.
 *
 * Shared by:
 *   - eval/benchmark/sample-bench.ts — runs performance benchmarks in Bun
 *   - eval/overlap-audit/ and eval/ugly-detector/ — layout / aesthetic audits
 *
 * Every supported feature, shape, edge type, block construct, and theme
 * variant is exercised by at least one sample.
 */

import { readFileSync } from 'node:fs'
import type { RenderOptions } from '../../src/types.ts'

export interface Sample {
  title: string
  description: string
  source: string
  /** Stable rich-gallery anchor override, used only when title slugs collide. */
  anchor?: string
  /** Optional category tag for grouping in the Table of Contents */
  category?: string
  /** Declares a high-cardinality peer set that exercises derived categorical color. */
  palettePeers?: {
    count: number
    kind: string
  }
  options?: RenderOptions
}

const stylePaletteShowcaseOptions = {
  style: ['publication-figure', 'paper'],
  seed: 3,
} satisfies RenderOptions

const mindmapGitGraphCorpus = new URL('../../eval/mindmap-gitgraph-content-corpus/', import.meta.url)

function promotedCorpusSource(relativePath: string) {
  return readFileSync(new URL(relativePath, mindmapGitGraphCorpus), 'utf8').trimEnd()
}

export const samples: Sample[] = [

  // ══════════════════════════════════════════════════════════════════════════
  //  HERO — Showcase diagram
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Agentic Mermaid',
    category: 'Hero',
    description: 'Mermaid rendering, made beautiful.',
    source: `stateDiagram-v2
    direction LR
    [*] --> Input
    Input --> Parse: DSL
    Parse --> Layout: AST
    Layout --> SVG: Vector
    Layout --> ASCII: Text
    SVG --> Theme
    ASCII --> Theme
    Theme --> Output
    Output --> [*]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Shapes
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Simple Flow',
    category: 'Flowchart',
    description: 'Basic linear flow with three nodes connected by solid arrows.',
    source: `graph TD
  A[Start] --> B[Process] --> C[End]`,
  },
  {
    title: 'Fan-in Grouping',
    category: 'Flowchart',
    description: 'Roots feeding the same target sit contiguously and each target aligns under its own group, so the two fan-in trunks stay separate (most visible in the ASCII panel).',
    source: `graph TD
  A1[Ingest A] --> A[Queue A]
  A2[Ingest B] --> A
  B1[Stream A] --> B[Queue B]
  B2[Stream B] --> B
  A --> C[Merge]
  B --> C`,
  },
  {
    title: 'Labeled Fan-out',
    category: 'Flowchart',
    description: 'Sibling edges with labels share a trunk and the box-start connector sits flush on the source border even when a label widens a column (most visible in the ASCII panel).',
    source: `flowchart LR
  Dispatcher -->|email| E[Email Worker]
  Dispatcher -->|sms| S[SMS Worker]
  Dispatcher -->|push| P[Push Worker]`,
  },
  {
    title: 'Subgraph Direction Override',
    category: 'Flowchart',
    description: 'direction LR inside a TD flowchart lays the inner pipeline out horizontally — honored even though Mermaid itself ignores it in many cases (mermaid#2509).',
    source: `flowchart TD
  subgraph Pipeline
    direction LR
    Fetch --> Parse --> Transform --> Store
  end`,
  },
  {
    title: 'Original Node Shapes',
    category: 'Flowchart',
    description: 'Rectangle, rounded, diamond, stadium, and circle.',
    source: `graph LR
  A[Rectangle] --> B(Rounded)
  B --> C{Diamond}
  C --> D([Stadium])
  D --> E((Circle))`,
  },
  {
    title: 'Batch 1 Shapes',
    category: 'Flowchart',
    description: 'Subroutine `[[text]]`, double circle `(((text)))`, and hexagon `{{text}}`.',
    source: `graph LR
  A[[Subroutine]] --> B(((Double Circle)))
  B --> C{{Hexagon}}`,
  },
  {
    title: 'Batch 2 Shapes',
    category: 'Flowchart',
    description: 'Cylinder `[(text)]`, asymmetric `>text]`, trapezoid `[/text\\]`, and inverse trapezoid `[\\text/]`.',
    source: `graph LR
  A[(Database)] --> B>Flag Shape]
  B --> C[/Wider Bottom\\]
  C --> D[\\Wider Top/]`,
  },
  {
    title: 'All 12 Flowchart Shapes',
    category: 'Flowchart',
    description: 'Every supported flowchart shape in a single diagram.',
    source: `graph LR
  A[Rectangle] --> B(Rounded)
  B --> C{Diamond}
  C --> D([Stadium])
  D --> E((Circle))
  E --> F[[Subroutine]]
  F --> G(((Double Circle)))
  G --> H{{Hexagon}}
  H --> I[(Database)]
  I --> J>Flag]
  J --> K[/Trapezoid\\]
  K --> L[\\Inverse Trap/]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Edges
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'All Edge Styles',
    category: 'Flowchart',
    description: 'Solid, dotted, and thick arrows with labels.',
    source: `graph TD
  A[Source] -->|solid| B[Target 1]
  A -.->|dotted| C[Target 2]
  A ==>|thick| D[Target 3]`,
  },
  {
    title: 'No-Arrow Edges',
    category: 'Flowchart',
    description: 'Lines without arrowheads: solid `---`, dotted `-.-`, thick `===`.',
    source: `graph TD
  A[Node 1] ---|related| B[Node 2]
  B -.- C[Node 3]
  C === D[Node 4]`,
  },
  {
    title: 'Text-Embedded Labels',
    category: 'Flowchart',
    description: 'Using `-- label -->` syntax instead of `-->|label|` for edge labels.',
    source: `flowchart TD
  A(Start) --> B{Is it sunny?}
  B -- Yes --> C[Go to the park]
  B -- No --> D[Stay indoors]
  C --> E[Finish]
  D --> E`,
  },
  {
    title: 'Bidirectional Arrows',
    category: 'Flowchart',
    description: 'Arrows in both directions: `<-->`, `<-.->`, `<==>`.',
    source: `graph LR
  A[Client] <-->|sync| B[Server]
  B <-.->|heartbeat| C[Monitor]
  C <==>|data| D[Storage]`,
  },
  {
    title: 'Parallel Links (&)',
    category: 'Flowchart',
    description: 'Using `&` to create multiple edges from/to groups of nodes.',
    source: `graph TD
  A[Input] & B[Config] --> C[Processor]
  C --> D[Output] & E[Log]`,
  },
  {
    title: 'Chained Edges',
    category: 'Flowchart',
    description: 'A long chain of nodes demonstrating edge chaining syntax.',
    source: `graph LR
  A[Step 1] --> B[Step 2] --> C[Step 3] --> D[Step 4] --> E[Step 5]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Edge Styling (linkStyle)
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'linkStyle: Color-Coded Edges',
    category: 'Flowchart',
    description: 'Using `linkStyle` to color specific edges by index (0-based).',
    source: `graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Accept]
  B -->|No| D[Reject]
  C --> E[Done]
  D --> E
  linkStyle 0 stroke:#7aa2f7,stroke-width:3px
  linkStyle 1 stroke:#9ece6a,stroke-width:2px
  linkStyle 2 stroke:#f7768e,stroke-width:2px
  linkStyle default stroke:#565f89`,
  },
  {
    title: 'linkStyle: Default + Override',
    category: 'Flowchart',
    description: 'Default edge style with index-specific overrides for critical paths.',
    source: `graph LR
  A[Request] --> B[Auth]
  B --> C[Process]
  C --> D[Response]
  B --> E[Reject]
  linkStyle default stroke:#6b7280,stroke-width:1px
  linkStyle 0,1,2 stroke:#22c55e,stroke-width:2px
  linkStyle 3 stroke:#ef4444,stroke-width:3px`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Directions
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Direction: Left-Right (LR)',
    category: 'Flowchart',
    description: 'Horizontal layout flowing left to right.',
    source: `graph LR
  A[Input] --> B[Transform] --> C[Output]`,
  },
  {
    title: 'Direction: Bottom-Top (BT)',
    category: 'Flowchart',
    description: 'Vertical layout flowing from bottom to top.',
    source: `graph BT
  A[Foundation] --> B[Layer 2] --> C[Top]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Subgraphs
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Subgraphs',
    category: 'Flowchart',
    description: 'Grouped nodes inside labeled subgraph containers.',
    source: `graph TD
  subgraph Frontend
    A[React App] --> B[State Manager]
  end
  subgraph Backend
    C[API Server] --> D[Database]
  end
  B --> C`,
  },
  {
    title: 'Nested Subgraphs',
    category: 'Flowchart',
    description: 'Subgraphs inside subgraphs for hierarchical grouping.',
    source: `graph TD
  subgraph Cloud
    subgraph us-east [US East Region]
      A[Web Server] --> B[App Server]
    end
    subgraph us-west [US West Region]
      C[Web Server] --> D[App Server]
    end
  end
  E[Load Balancer] --> A
  E --> C`,
  },
  {
    title: 'Subgraph Direction Override',
    category: 'Flowchart',
    description: 'Using `direction LR` inside a subgraph while the outer graph flows TD.',
    anchor: 'subgraph-direction-override-connected',
    source: `graph TD
  subgraph pipeline [Processing Pipeline]
    direction LR
    A[Input] --> B[Parse] --> C[Transform] --> D[Output]
  end
  E[Source] --> A
  D --> F[Sink]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Styling
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: '::: Class Shorthand',
    category: 'Flowchart',
    description: 'Assigning classes with `:::` syntax directly on node definitions.',
    source: `graph TD
  A[Normal]:::default --> B[Highlighted]:::highlight --> C[Error]:::error
  classDef default fill:#f4f4f5,stroke:#a1a1aa
  classDef highlight fill:#fbbf24,stroke:#d97706
  classDef error fill:#ef4444,stroke:#dc2626`,
  },
  {
    title: 'Inline Style Overrides',
    category: 'Flowchart',
    description: 'Using `style` statements to override node fill and stroke colors.',
    source: `graph TD
  A[Default] --> B[Custom Colors] --> C[Another Custom]
  style B fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style C fill:#10b981,stroke:#059669`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Real-World Diagrams
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'CI/CD Pipeline',
    category: 'Flowchart',
    description: 'A realistic CI/CD pipeline with decision points, feedback loops, and deployment stages.',
    source: `graph TD
  subgraph ci [CI Pipeline]
    A[Push Code] --> B{Tests Pass?}
    B -->|Yes| C[Build Image]
    B -->|No| D[Fix & Retry]
    D -.-> A
  end
  C --> E([Deploy Staging])
  E --> F{QA Approved?}
  F -->|Yes| G((Production))
  F -->|No| D`,
  },
  {
    title: 'System Architecture',
    category: 'Flowchart',
    description: 'A microservices architecture with multiple services and data stores.',
    source: `graph LR
  subgraph clients [Client Layer]
    A([Web App]) --> B[API Gateway]
    C([Mobile App]) --> B
  end
  subgraph services [Service Layer]
    B --> D[Auth Service]
    B --> E[User Service]
    B --> F[Order Service]
  end
  subgraph data [Data Layer]
    D --> G[(Auth DB)]
    E --> H[(User DB)]
    F --> I[(Order DB)]
    F --> J([Message Queue])
  end`,
  },
  {
    title: 'Decision Tree',
    category: 'Flowchart',
    description: 'A branching decision flowchart with multiple outcomes.',
    source: `graph TD
  A{Is it raining?} -->|Yes| B{Have umbrella?}
  A -->|No| C([Go outside])
  B -->|Yes| D([Go with umbrella])
  B -->|No| E{Is it heavy?}
  E -->|Yes| F([Stay inside])
  E -->|No| G([Run for it])`,
  },
  {
    title: 'Git Branching Workflow',
    category: 'Flowchart',
    description: 'A git flow showing feature branches, PRs, and release cycle.',
    source: `graph LR
  A[main] --> B[develop]
  B --> C[feature/auth]
  B --> D[feature/ui]
  C --> E{PR Review}
  D --> E
  E -->|approved| B
  B --> F[release/1.0]
  F --> G{Tests?}
  G -->|pass| A
  G -->|fail| F`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ARCHITECTURE DIAGRAMS
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Architecture: Edge Platform',
    category: 'Architecture',
    description: 'Nested groups, service cards, and storage links for a regional edge platform.',
    source: `architecture-beta
  group region(cloud)[EU West]
  group edge(server)[Edge Layer] in region
  group core(cloud)[Core Services] in region
  service ingress(internet)[Global CDN] in edge
  service gateway(server)[API Gateway] in edge
  service auth(server)[Auth Service] in core
  service billing(server)[Billing Service] in core
  service ledger(database)[Ledger] in core
  ingress:R --> L:gateway
  gateway:B --> T:auth
  gateway:R --> L:billing
  billing:B -[stores invoices]-> T:ledger
  auth:B -[reads session]-> T:ledger`,
    options: {
      bg: '#0f172a',
      fg: '#e2e8f0',
      line: '#475569',
      accent: '#38bdf8',
      muted: '#94a3b8',
      surface: '#111827',
      border: '#334155',
    },
  },
  {
    title: 'Architecture: Event Spine',
    category: 'Architecture',
    description: 'Boundary-aware edges, a junction fan-out, and data services separated into zones.',
    source: `architecture-beta
  group app(cloud)[Application Zone]
  group data(cloud)[Data Zone]
  service api(server)[Public API] in app
  service workers(server)[Async Workers] in app
  junction bus in app
  service cache(disk)[Hot Cache] in data
  service stream(database)[Event Store] in data
  api:B --> T:bus
  bus:B -[fans out]-> T:workers
  api:B -[reads profiles]-> T:cache
  workers:B -[persists events]-> T:stream
  api{group}:B -[private link]-> T:stream{group}`,
  },
  {
    title: 'Architecture: Regional Failover',
    category: 'Architecture',
    description: 'Two regions with replicated data paths and warm standby ingress.',
    source: `architecture-beta
  group primary(cloud)[Primary Region]
  group standby(cloud)[Standby Region]
  service edge1(server)[Ingress] in primary
  service app1(server)[App Cluster] in primary
  service db1(database)[Primary DB] in primary
  service edge2(server)[Warm Ingress] in standby
  service app2(server)[Warm App] in standby
  service db2(database)[Replica DB] in standby
  service wan(internet)[Internet]
  wan:R --> L:edge1
  edge1:B --> T:app1
  app1:B --> T:db1
  edge2:B --> T:app2
  app2:B --> T:db2
  db1{group}:B -[streams replica]-> T:db2{group}`,
    options: {
      bg: '#fffaf0',
      fg: '#3f2d16',
      line: '#8b5e34',
      accent: '#d97706',
      muted: '#8c6a43',
      surface: '#fef3c7',
      border: '#d6b37b',
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  STATE DIAGRAMS
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Basic State Diagram',
    category: 'State',
    description: 'A simple `stateDiagram-v2` with start/end pseudostates and transitions.',
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Active : start
  Active --> Idle : cancel
  Active --> Done : complete
  Done --> [*]`,
  },
  {
    title: 'State: Composite States',
    category: 'State',
    description: 'Nested composite states with inner transitions.',
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Processing : submit
  state Processing {
    parse --> validate
    validate --> execute
  }
  Processing --> Complete : done
  Processing --> Error : fail
  Error --> Idle : retry
  Complete --> [*]`,
  },
  {
    title: 'State: Connection Lifecycle',
    category: 'State',
    description: 'TCP-like connection state machine with multiple states.',
    source: `stateDiagram-v2
  [*] --> Closed
  Closed --> Connecting : connect
  Connecting --> Connected : success
  Connecting --> Closed : timeout
  Connected --> Disconnecting : close
  Connected --> Reconnecting : error
  Reconnecting --> Connected : success
  Reconnecting --> Closed : max_retries
  Disconnecting --> Closed : done
  Closed --> [*]`,
  },

  {
    title: 'State: CJK State Names',
    category: 'State',
    description: 'State diagram using Chinese characters for state names.',
    source: `stateDiagram-v2
  [*] --> 空闲
  空闲 --> 处理中 : 提交
  处理中 --> 完成 : 成功
  处理中 --> 错误 : 失败
  错误 --> 空闲 : 重试
  完成 --> [*]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SEQUENCE DIAGRAMS — Core Features
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Sequence: Basic Messages',
    category: 'Sequence',
    description: 'Simple request/response between two participants.',
    source: `sequenceDiagram
  Alice->>Bob: Hello Bob!
  Bob-->>Alice: Hi Alice!`,
  },
  {
    title: 'Sequence: Participant Aliases',
    category: 'Sequence',
    description: 'Using `participant ... as ...` for compact diagram IDs with readable labels.',
    source: `sequenceDiagram
  participant A as Alice
  participant B as Bob
  participant C as Charlie
  A->>B: Hello
  B->>C: Forward
  C-->>A: Reply`,
  },
  {
    title: 'Sequence: Actor Stick Figures',
    category: 'Sequence',
    description: 'Using `actor` instead of `participant` renders stick figures instead of boxes.',
    source: `sequenceDiagram
  actor U as User
  participant S as System
  participant DB as Database
  U->>S: Click button
  S->>DB: Query
  DB-->>S: Results
  S-->>U: Display`,
  },
  {
    title: 'Sequence: Arrow Types',
    category: 'Sequence',
    description: 'All arrow types: solid `->>` and dashed `-->>` with filled arrowheads, open arrows `-)` .',
    source: `sequenceDiagram
  A->>B: Solid arrow (sync)
  B-->>A: Dashed arrow (return)
  A-)B: Open arrow (async)
  B--)A: Open dashed arrow`,
  },
  {
    title: 'Sequence: Activation Boxes',
    category: 'Sequence',
    description: 'Using `+` and `-` to show when participants are active.',
    source: `sequenceDiagram
  participant C as Client
  participant S as Server
  C->>+S: Request
  S->>+S: Process
  S->>-S: Done
  S-->>-C: Response`,
  },
  {
    title: 'Sequence: Self-Messages',
    category: 'Sequence',
    description: 'A participant sending a message to itself (displayed as a loop arrow).',
    source: `sequenceDiagram
  participant S as Server
  S->>S: Internal process
  S->>S: Validate
  S-->>S: Log`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SEQUENCE DIAGRAMS — Blocks
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Sequence: Loop Block',
    category: 'Sequence',
    description: 'A `loop` construct wrapping repeated message exchanges.',
    source: `sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: Connect
  loop Every 30s
    C->>S: Heartbeat
    S-->>C: Ack
  end
  C->>S: Disconnect`,
  },
  {
    title: 'Sequence: Alt/Else Block',
    category: 'Sequence',
    description: 'Conditional branching with `alt` (if) and `else` blocks.',
    source: `sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: Login
  alt Valid credentials
    S-->>C: 200 OK
  else Invalid
    S-->>C: 401 Unauthorized
  else Account locked
    S-->>C: 403 Forbidden
  end`,
  },
  {
    title: 'Sequence: Opt Block',
    category: 'Sequence',
    description: 'Optional block — executes only if condition is met.',
    source: `sequenceDiagram
  participant A as App
  participant C as Cache
  participant DB as Database
  A->>C: Get data
  C-->>A: Cache miss
  opt Cache miss
    A->>DB: Query
    DB-->>A: Results
    A->>C: Store in cache
  end`,
  },
  {
    title: 'Sequence: Par Block',
    category: 'Sequence',
    description: 'Parallel execution with `par`/`and` constructs.',
    source: `sequenceDiagram
  participant C as Client
  participant A as AuthService
  participant U as UserService
  participant O as OrderService
  C->>A: Authenticate
  par Fetch user data
    A->>U: Get profile
  and Fetch orders
    A->>O: Get orders
  end
  A-->>C: Combined response`,
  },
  {
    title: 'Sequence: Critical Block',
    category: 'Sequence',
    description: 'Critical section that must complete atomically.',
    source: `sequenceDiagram
  participant A as App
  participant DB as Database
  A->>DB: BEGIN
  critical Transaction
    A->>DB: UPDATE accounts
    A->>DB: INSERT log
  end
  A->>DB: COMMIT`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SEQUENCE DIAGRAMS — Notes
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Sequence: Notes (Right/Left/Over)',
    category: 'Sequence',
    description: 'Notes positioned to the right, left, or over participants.',
    source: `sequenceDiagram
  participant A as Alice
  participant B as Bob
  Note left of A: Alice prepares
  A->>B: Hello
  Note right of B: Bob thinks
  B-->>A: Reply
  Note over A,B: Conversation complete`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SEQUENCE DIAGRAMS — Complex / Real-World
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Sequence: OAuth 2.0 Flow',
    category: 'Sequence',
    description: 'Full OAuth 2.0 authorization code flow with token exchange.',
    source: `sequenceDiagram
  actor U as User
  participant App as Client App
  participant Auth as Auth Server
  participant API as Resource API
  U->>App: Click Login
  App->>Auth: Authorization request
  Auth->>U: Login page
  U->>Auth: Credentials
  Auth-->>App: Authorization code
  App->>Auth: Exchange code for token
  Auth-->>App: Access token
  App->>API: Request + token
  API-->>App: Protected resource
  App-->>U: Display data`,
  },
  {
    title: 'Sequence: Database Transaction',
    category: 'Sequence',
    description: 'Multi-step database transaction with rollback handling.',
    source: `sequenceDiagram
  participant C as Client
  participant S as Server
  participant DB as Database
  C->>S: POST /transfer
  S->>DB: BEGIN
  S->>DB: Debit account A
  alt Success
    S->>DB: Credit account B
    S->>DB: INSERT audit_log
    S->>DB: COMMIT
    S-->>C: 200 OK
  else Insufficient funds
    S->>DB: ROLLBACK
    S-->>C: 400 Bad Request
  end`,
  },
  {
    title: 'Sequence: Microservice Orchestration',
    category: 'Sequence',
    description: 'Complex multi-service flow with parallel calls and error handling.',
    source: `sequenceDiagram
  participant G as Gateway
  participant A as Auth
  participant U as Users
  participant O as Orders
  participant N as Notify
  G->>A: Validate token
  A-->>G: Valid
  par Fetch data
    G->>U: Get user
    U-->>G: User data
  and
    G->>O: Get orders
    O-->>G: Order list
  end
  G->>N: Send notification
  N-->>G: Queued
  Note over G: Aggregate response`,
  },
  {
    title: 'Sequence: Self-Messages with Notes',
    category: 'Sequence',
    description: 'Self-referencing messages inside alt blocks with notes — tests that notes clear self-message loops and stack without overlapping.',
    source: `sequenceDiagram
  participant User
  participant Main as Main Process
  participant Renderer
  participant Timer as 3s Fallback Timer
  User->>Main: CMD+W
  Main->>Main: event.preventDefault()
  Main->>Renderer: WINDOW_CLOSE_REQUESTED
  Main->>Timer: Start 3s timer
  alt Multiple panels
    Renderer->>Renderer: closePanel(focusedId)
    Note over Renderer: Panel removed
    Note over Renderer: No confirmCloseWindow!
    Timer-->>Main: 3s elapsed → window.destroy()
  else Single panel
    Renderer->>Renderer: closePanel(lastId)
    Note over Renderer: Stack becomes []
    Renderer->>Renderer: Auto-select fires → new panel created!
    Note over Renderer: Panel reopens
    Timer-->>Main: 3s elapsed → window.destroy()
  end`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CLASS DIAGRAMS — Core Features
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Class: Basic Class',
    category: 'Class',
    description: 'A single class with attributes and methods, rendered as a 3-compartment box.',
    source: `classDiagram
  class Animal {
    +String name
    +int age
    +eat() void
    +sleep() void
  }`,
  },
  {
    title: 'Class: Visibility Markers',
    category: 'Class',
    description: 'All four visibility levels: `+` (public), `-` (private), `#` (protected), `~` (package).',
    source: `classDiagram
  class User {
    +String name
    -String password
    #int internalId
    ~String packageField
    +login() bool
    -hashPassword() String
    #validate() void
    ~notify() void
  }`,
  },
  {
    title: 'Class: Interface Annotation',
    category: 'Class',
    description: 'Using `<<interface>>` annotation above the class name.',
    source: `classDiagram
  class Serializable {
    <<interface>>
    +serialize() String
    +deserialize(data) void
  }`,
  },
  {
    title: 'Class: Abstract Annotation',
    category: 'Class',
    description: 'Using `<<abstract>>` annotation for abstract classes.',
    source: `classDiagram
  class Shape {
    <<abstract>>
    +String color
    +area() double
    +draw() void
  }`,
  },
  {
    title: 'Class: Enum Annotation',
    category: 'Class',
    description: 'Using `<<enumeration>>` annotation for enum types.',
    source: `classDiagram
  class Status {
    <<enumeration>>
    ACTIVE
    INACTIVE
    PENDING
    DELETED
  }`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CLASS DIAGRAMS — Relationships
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Class: Inheritance (<|--)',
    category: 'Class',
    description: 'Inheritance relationship rendered with a hollow triangle marker.',
    source: `classDiagram
  class Animal {
    +String name
    +eat() void
  }
  class Dog {
    +String breed
    +bark() void
  }
  class Cat {
    +bool isIndoor
    +meow() void
  }
  Animal <|-- Dog
  Animal <|-- Cat`,
  },
  {
    title: 'Class: Composition (*--)',
    category: 'Class',
    description: 'Composition — "owns" relationship with filled diamond marker.',
    source: `classDiagram
  class Car {
    +String model
    +start() void
  }
  class Engine {
    +int horsepower
    +rev() void
  }
  Car *-- Engine`,
  },
  {
    title: 'Class: Aggregation (o--)',
    category: 'Class',
    description: 'Aggregation — "has" relationship with hollow diamond marker.',
    source: `classDiagram
  class University {
    +String name
  }
  class Department {
    +String faculty
  }
  University o-- Department`,
  },
  {
    title: 'Class: Association (-->)',
    category: 'Class',
    description: 'Basic association — simple directed arrow.',
    source: `classDiagram
  class Customer {
    +String name
  }
  class Order {
    +int orderId
  }
  Customer --> Order`,
  },
  {
    title: 'Class: Dependency (..>)',
    category: 'Class',
    description: 'Dependency — dashed line with open arrow.',
    source: `classDiagram
  class Service {
    +process() void
  }
  class Repository {
    +find() Object
  }
  Service ..> Repository`,
  },
  {
    title: 'Class: Realization (..|>)',
    category: 'Class',
    description: 'Realization — dashed line with hollow triangle (implements interface).',
    source: `classDiagram
  class Flyable {
    <<interface>>
    +fly() void
  }
  class Bird {
    +fly() void
    +sing() void
  }
  Bird ..|> Flyable`,
  },
  {
    title: 'Class: All 6 Relationship Types',
    category: 'Class',
    description: 'Every relationship type in a single diagram for comparison.',
    source: `classDiagram
  A <|-- B : inheritance
  C *-- D : composition
  E o-- F : aggregation
  G --> H : association
  I ..> J : dependency
  K ..|> L : realization`,
  },
  {
    title: 'Class: Relationship Labels',
    category: 'Class',
    description: 'Labeled relationships between classes with descriptive text.',
    source: `classDiagram
  class Teacher {
    +String name
  }
  class Student {
    +String name
  }
  class Course {
    +String title
  }
  Teacher --> Course : teaches
  Student --> Course : enrolled in`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CLASS DIAGRAMS — Complex / Real-World
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Class: Design Pattern — Observer',
    category: 'Class',
    description: 'The Observer (publish-subscribe) design pattern with interface + concrete implementations.',
    source: `classDiagram
  class Subject {
    <<interface>>
    +attach(Observer) void
    +detach(Observer) void
    +notify() void
  }
  class Observer {
    <<interface>>
    +update() void
  }
  class EventEmitter {
    -List~Observer~ observers
    +attach(Observer) void
    +detach(Observer) void
    +notify() void
  }
  class Logger {
    +update() void
  }
  class Alerter {
    +update() void
  }
  Subject <|.. EventEmitter
  Observer <|.. Logger
  Observer <|.. Alerter
  EventEmitter --> Observer`,
  },
  {
    title: 'Class: MVC Architecture',
    category: 'Class',
    description: 'Model-View-Controller pattern showing relationships between layers.',
    source: `classDiagram
  class Model {
    -data Map
    +getData() Map
    +setData(key, val) void
    +notify() void
  }
  class View {
    -model Model
    +render() void
    +update() void
  }
  class Controller {
    -model Model
    -view View
    +handleInput(event) void
    +updateModel(data) void
  }
  Controller --> Model : updates
  Controller --> View : refreshes
  View --> Model : reads
  Model ..> View : notifies`,
  },
  {
    title: 'Class: Full Hierarchy',
    category: 'Class',
    description: 'A complete class hierarchy with abstract base, interfaces, and concrete classes.',
    source: `classDiagram
  class Animal {
    <<abstract>>
    +String name
    +int age
    +eat() void
    +sleep() void
  }
  class Mammal {
    +bool warmBlooded
    +nurse() void
  }
  class Bird {
    +bool canFly
    +layEggs() void
  }
  class Dog {
    +String breed
    +bark() void
  }
  class Cat {
    +bool isIndoor
    +purr() void
  }
  class Parrot {
    +String vocabulary
    +speak() void
  }
  Animal <|-- Mammal
  Animal <|-- Bird
  Mammal <|-- Dog
  Mammal <|-- Cat
  Bird <|-- Parrot`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ER DIAGRAMS — Core Features
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'ER: Basic Relationship',
    category: 'ER',
    description: 'A simple one-to-many relationship between two entities.',
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places`,
  },
  {
    title: 'ER: Entity with Attributes',
    category: 'ER',
    description: 'An entity with typed attributes and `PK`/`FK`/`UK` key badges.',
    source: `erDiagram
  CUSTOMER {
    int id PK
    string name
    string email UK
    date created_at
  }`,
  },
  {
    title: 'ER: Attribute Keys (PK, FK, UK)',
    category: 'ER',
    description: 'All three key constraint types rendered as badges.',
    source: `erDiagram
  ORDER {
    int id PK
    int customer_id FK
    string invoice_number UK
    decimal total
    date order_date
    string status
  }`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ER DIAGRAMS — Cardinality Types
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'ER: Exactly One to Exactly One (||--||)',
    category: 'ER',
    description: 'One-to-one mandatory relationship.',
    source: `erDiagram
  PERSON ||--|| PASSPORT : has`,
  },
  {
    title: 'ER: Exactly One to Zero-or-Many (||--o{)',
    category: 'ER',
    description: 'Classic one-to-many optional relationship (crow\'s foot).',
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places`,
  },
  {
    title: 'ER: Zero-or-One to One-or-Many (|o--|{)',
    category: 'ER',
    description: 'Optional on one side, at-least-one on the other.',
    source: `erDiagram
  SUPERVISOR |o--|{ EMPLOYEE : manages`,
  },
  {
    title: 'ER: One-or-More to Zero-or-Many (}|--o{)',
    category: 'ER',
    description: 'At-least-one to zero-or-many relationship.',
    source: `erDiagram
  TEACHER }|--o{ COURSE : teaches`,
  },
  {
    title: 'ER: All Cardinality Types',
    category: 'ER',
    description: 'Every cardinality combination in one diagram.',
    source: `erDiagram
  A ||--|| B : one-to-one
  C ||--o{ D : one-to-many
  E |o--|{ F : opt-to-many
  G }|--o{ H : many-to-many`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ER DIAGRAMS — Line Styles
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'ER: Identifying (Solid) Relationship',
    category: 'ER',
    description: 'Solid line indicating an identifying relationship (child depends on parent for identity).',
    source: `erDiagram
  ORDER ||--|{ LINE_ITEM : contains`,
  },
  {
    title: 'ER: Non-Identifying (Dashed) Relationship',
    category: 'ER',
    description: 'Dashed line indicating a non-identifying relationship.',
    source: `erDiagram
  USER ||..o{ LOG_ENTRY : generates
  USER ||..o{ SESSION : opens`,
  },
  {
    title: 'ER: Mixed Identifying & Non-Identifying',
    category: 'ER',
    description: 'Both solid and dashed lines in the same diagram.',
    source: `erDiagram
  ORDER ||--|{ LINE_ITEM : contains
  ORDER ||..o{ SHIPMENT : ships-via
  PRODUCT ||--o{ LINE_ITEM : includes
  PRODUCT ||..o{ REVIEW : receives`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ER DIAGRAMS — Complex / Real-World
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'ER: E-Commerce Schema',
    category: 'ER',
    description: 'Full e-commerce database schema with customers, orders, products, and line items.',
    source: `erDiagram
  CUSTOMER {
    int id PK
    string name
    string email UK
  }
  ORDER {
    int id PK
    date created
    int customer_id FK
  }
  PRODUCT {
    int id PK
    string name
    float price
  }
  LINE_ITEM {
    int id PK
    int order_id FK
    int product_id FK
    int quantity
  }
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : includes`,
  },
  {
    title: 'ER: Blog Platform Schema',
    category: 'ER',
    description: 'Blog system with users, posts, comments, and tags.',
    source: `erDiagram
  USER {
    int id PK
    string username UK
    string email UK
    date joined
  }
  POST {
    int id PK
    string title
    text content
    int author_id FK
    date published
  }
  COMMENT {
    int id PK
    text body
    int post_id FK
    int user_id FK
    date created
  }
  TAG {
    int id PK
    string name UK
  }
  USER ||--o{ POST : writes
  USER ||--o{ COMMENT : authors
  POST ||--o{ COMMENT : has
  POST }|--o{ TAG : tagged-with`,
  },
  {
    title: 'ER: School Management Schema',
    category: 'ER',
    description: 'School system with students, teachers, courses, and enrollments.',
    source: `erDiagram
  STUDENT {
    int id PK
    string name
    date dob
    string grade
  }
  TEACHER {
    int id PK
    string name
    string department
  }
  COURSE {
    int id PK
    string title
    int teacher_id FK
    int credits
  }
  ENROLLMENT {
    int id PK
    int student_id FK
    int course_id FK
    string semester
    float grade
  }
  TEACHER ||--o{ COURSE : teaches
  STUDENT ||--o{ ENROLLMENT : enrolled
  COURSE ||--o{ ENROLLMENT : has`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  TIMELINE DIAGRAMS
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Timeline: Social Media History',
    category: 'Timeline',
    description: 'Mirrors Mermaid’s official introductory timeline example, with each period carrying its own color family.',
    source: `timeline
  title History of Social Media Platform
  2002 : LinkedIn
  2004 : Facebook : Google
  2005 : YouTube
  2006 : Twitter`,
  },
  {
    title: 'Timeline: Product Delivery Plan',
    category: 'Timeline',
    description: 'Sectioned timeline with continuation events, matching the more advanced Mermaid Timeline examples.',
    source: `timeline
  title Product Delivery Plan
  section Foundation
  2022 Q4 : Research
  2023 Q1 : Prototype
  section Launch
  2023 Q3 : Private beta
          : Design system rollout
  2024 Q1 : Public launch`,
  },
  {
    title: 'Timeline: Multiline Platform Milestones',
    category: 'Timeline',
    description: 'Exercises <br> labels in the title, section labels, periods, and event cards.',
    source: `timeline
  title Platform<br>Milestones
  section Core<br>platform
  2024<br>Q1 : Soft<br>launch
  2024<br>Q2 : Mobile<br>support
  section Adoption
  2024<br>Q4 : Team<br>rollout`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  USER JOURNEYS
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Journey: My Working Day',
    category: 'Journey',
    description: 'Scored tasks grouped into sections with actor tags and accessibility metadata.',
    source: `journey
    accTitle: My working day journey
    accDescr: A compact user journey showing commute and workday tasks
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
    section Workday
      Do work: 1: Me, Cat
      Review PRs: 4: Me, Team`,
  },
  {
    title: 'Journey: Mermaid Docs Example',
    category: 'Journey',
    description: 'Official Mermaid user journey example, matching the docs structure and scoring pattern.',
    source: `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 3: Me`,
  },
  {
    title: 'Journey: Cross-functional Release Readiness',
    category: 'Journey',
    description: 'Ten peer actors coordinate a four-stage launch, making the high-cardinality actor palette visible without changing authored status or score semantics.',
    palettePeers: { count: 10, kind: 'peer actors' },
    source: `journey
    title Cross-functional release readiness
    section Plan
      Scope launch: 5: Product, Design
    section Build
      Ship product: 4: Web, API
      Instrument events: 4: Data, Mobile
    section Validate
      Prove release: 5: QA, Security
    section Release
      Publish rollout: 5: Docs, Support`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  XY CHARTS (xychart-beta)
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'XY: Simple Bar Chart',
    category: 'XY Chart',
    description: 'Basic bar chart with categorical x-axis.',
    source: `xychart-beta
    title "Product Sales"
    x-axis [Widgets, Gadgets, Gizmos, Doodads, Thingamajigs]
    bar [150, 230, 180, 95, 310]`,
    options: { interactive: true },
  },
  {
    title: 'XY: Line Chart',
    category: 'XY Chart',
    description: 'Line chart showing revenue growth over years.',
    source: `xychart-beta
    title "Revenue Growth"
    x-axis [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
    line [320, 420, 540, 680, 820, 950, 1080, 1200]`,
    options: { interactive: true },
  },
  {
    title: 'XY: Bar and Line Overlay',
    category: 'XY Chart',
    description: 'Bars with a line overlay and both axis titles.',
    source: `xychart-beta
    title "Monthly Revenue"
    x-axis "Month" [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec]
    y-axis "Revenue (USD)" 0 --> 10000
    bar [4200, 5000, 5800, 6200, 5500, 7000, 7800, 7200, 8400, 8100, 9000, 9200]
    line [4200, 5000, 5800, 6200, 5500, 7000, 7800, 7200, 8400, 8100, 9000, 9200]`,
    options: { interactive: true },
  },
  {
    title: 'XY: Horizontal Bars',
    category: 'XY Chart',
    description: 'Horizontal bar chart showing language popularity.',
    source: `xychart-beta horizontal
    title "Language Popularity"
    x-axis [Python, JavaScript, Java, Go, Rust]
    bar [30, 25, 20, 12, 8]`,
    options: { interactive: true },
  },
  {
    title: 'XY: Multiple Bar Series',
    category: 'XY Chart',
    description: 'Two bar series comparing years side by side.',
    source: `xychart-beta
    title "2023 vs 2024 Sales"
    x-axis [Q1, Q2, Q3, Q4]
    bar [200, 250, 300, 280]
    bar [230, 280, 320, 350]`,
    options: { interactive: true },
  },
  {
    title: 'XY: Dual Lines',
    category: 'XY Chart',
    description: 'Two lines comparing planned vs actual values.',
    source: `xychart-beta
    title "Planned vs Actual"
    x-axis [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug]
    line [100, 145, 190, 240, 280, 320, 360, 400]
    line [90, 130, 185, 235, 275, 340, 380, 420]`,
    options: { interactive: true },
  },
  {
    title: 'XY: Numeric X-Axis',
    category: 'XY Chart',
    description: 'Line chart using a numeric x-axis range.',
    source: `xychart-beta
    title "Distribution Curve"
    x-axis 0 --> 100
    line [4, 7, 13, 21, 31, 43, 58, 71, 84, 91, 95, 91, 84, 71, 58, 43, 31, 21, 13, 7, 4]`,
    options: { interactive: true },
  },
  {
    title: 'XY: 12-Month Dataset',
    category: 'XY Chart',
    description: 'Full year monthly data with bar and trend line.',
    source: `xychart-beta
    title "Monthly Active Users (2024)"
    x-axis [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec]
    y-axis "Users" 0 --> 30000
    bar [12000, 13500, 15200, 16800, 18500, 20100, 19800, 21500, 23000, 24200, 25800, 28000]
    line [12000, 13500, 15200, 16800, 18500, 20100, 19800, 21500, 23000, 24200, 25800, 28000]`,
    options: { interactive: true },
  },
  {
    title: 'XY: Horizontal Combined',
    category: 'XY Chart',
    description: 'Horizontal chart with both bars and a trend line.',
    source: `xychart-beta horizontal
    title "Budget vs Actual"
    x-axis [Eng, Sales, Marketing, Product, Ops, HR, Finance, Legal]
    bar [500, 350, 250, 200, 150, 120, 100, 80]
    line [480, 380, 230, 180, 160, 110, 95, 75]`,
    options: { interactive: true },
  },
  {
    title: 'XY: Sprint Burndown',
    category: 'XY Chart',
    description: 'Sprint burndown chart with actual and ideal lines.',
    source: `xychart-beta
    title "Sprint Burndown"
    x-axis [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10]
    y-axis "Story Points" 0 --> 80
    line [72, 65, 58, 50, 45, 38, 30, 22, 12, 0]
    line [72, 65, 58, 50, 43, 36, 29, 22, 14, 0]`,
    options: { interactive: true },
  },
  {
    title: 'XY: Service Health Portfolio',
    category: 'XY Chart',
    description: 'Eight peer service series share one operational scale, exposing whether line and legend colors remain distinguishable above the legacy six-series boundary.',
    palettePeers: { count: 8, kind: 'peer series' },
    source: `xychart-beta
    title "Service Health Portfolio"
    x-axis [Mon, Tue, Wed, Thu, Fri, Sat]
    y-axis "Availability (%)" 80 --> 100
    line Web [99, 98, 99, 99, 100, 99]
    line API [96, 97, 98, 97, 99, 98]
    line Data [93, 95, 94, 96, 97, 96]
    line Mobile [89, 92, 93, 91, 95, 94]
    line Identity [98, 96, 95, 97, 96, 98]
    line Search [86, 88, 91, 93, 92, 95]
    line Billing [94, 93, 96, 95, 98, 97]
    line Notifications [82, 87, 85, 90, 89, 93]`,
    options: { interactive: true },
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PIE
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Pie: Pets Adopted',
    category: 'Pie',
    description: 'A basic pie chart with a title and three labelled slices.',
    source: `pie title Pets adopted by volunteers
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15`,
  },
  {
    title: 'Pie: Product Elements (showData)',
    category: 'Pie',
    description: 'A pie chart using `showData` to surface the raw value beside each legend label, with decimal slice values.',
    source: `pie showData
    title Key elements in Product X
    "Calcium" : 42.96
    "Potassium" : 50.05
    "Magnesium" : 10.01
    "Iron" : 5`,
  },
  {
    title: 'Pie: Platform Workload Portfolio',
    category: 'Pie',
    description: 'Ten peer workload categories exercise high-cardinality slice and legend identity while preserving the values and source order authored by the user.',
    palettePeers: { count: 10, kind: 'peer slices' },
    source: `pie showData
    title Platform workload portfolio
    "Web" : 24
    "API" : 18
    "Data" : 14
    "Mobile" : 11
    "Security" : 9
    "Infrastructure" : 8
    "Documentation" : 6
    "Support" : 5
    "Quality" : 3
    "Research" : 2`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  QUADRANT
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Quadrant: Reach & Engagement',
    category: 'Quadrant',
    description: 'The classic quadrant chart: campaigns plotted by reach (x) and engagement (y), with a label in each of the four quadrants.',
    source: `quadrantChart
    title Reach and engagement of campaigns
    x-axis Low Reach --> High Reach
    y-axis Low Engagement --> High Engagement
    quadrant-1 We should expand
    quadrant-2 Need to promote
    quadrant-3 Re-evaluate
    quadrant-4 May be improved
    Campaign A: [0.3, 0.6]
    Campaign B: [0.45, 0.23]
    Campaign C: [0.57, 0.69]
    Campaign D: [0.78, 0.34]
    Campaign E: [0.40, 0.34]
    Campaign F: [0.35, 0.78]`,
  },
  {
    title: 'Quadrant: Effort vs Value',
    category: 'Quadrant',
    description: 'A prioritization matrix — tasks plotted by effort and value to decide what to do, plan, delegate, or drop.',
    source: `quadrantChart
    title Prioritization matrix
    x-axis Low Effort --> High Effort
    y-axis Low Value --> High Value
    quadrant-1 Do now
    quadrant-2 Plan
    quadrant-3 Drop
    quadrant-4 Delegate
    Onboarding revamp: [0.2, 0.9]
    Platform migration: [0.8, 0.8]
    Legacy cleanup: [0.25, 0.2]
    Vendor swap: [0.7, 0.3]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  GANTT
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Gantt: A Gantt Diagram',
    category: 'Gantt',
    description: 'The classic Mermaid docs Gantt: sections, explicit dates, `after` dependencies, and inherited starts.',
    source: `gantt
    title A Gantt Diagram
    dateFormat YYYY-MM-DD
    section Section
        A task          :a1, 2014-01-01, 30d
        Another task    :after a1, 20d
    section Another
        Task in Another :2014-01-12, 12d
        another task    :24d`,
  },
  {
    title: 'Gantt: Status & Milestones',
    category: 'Gantt',
    description: 'Status tags (`done`, `active`, `crit`), a milestone diamond, a `vert` marker that consumes no row, and weekends excluded from working durations.',
    source: `gantt
    title Release train
    dateFormat YYYY-MM-DD
    excludes weekends
    section Build
        Completed task :done, des1, 2024-01-08, 2024-01-10
        Active task    :active, des2, 2024-01-11, 3d
        Future task    :des3, after des2, 5d
    section Ship
        Crit review    :crit, rev1, after des3, 2d
        Code freeze    :vert, v1, 2024-01-19, 0d
        Release        :milestone, m1, after rev1, 0d`,
  },
  {
    title: 'Gantt: Compact Display Mode',
    category: 'Gantt',
    description: 'Dense overlapping tasks packed into shared rows with `displayMode: compact` — deterministic first-fit lanes per section.',
    source: `---
displayMode: compact
---
gantt
    title Compact packing
    dateFormat YYYY-MM-DD
    section Stream
        One   :a, 2024-01-01, 5d
        Two   :b, 2024-01-03, 6d
        Three :c, 2024-01-08, 4d
        Four  :d, 2024-01-10, 3d`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  MINDMAP — promoted real-content corpus scenarios
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Mindmap: Incident Response Command Map',
    category: 'Mindmap',
    description: 'A 40-node operational map with thirteen first-level branches for testing broad, real-world incident coordination.',
    palettePeers: { count: 13, kind: 'first-level branches' },
    source: promotedCorpusSource('mindmap/wide-incident-response.mmd'),
  },
  {
    title: 'Mindmap: Multilingual Global Launch',
    category: 'Mindmap',
    description: 'Long wrapped Markdown with CJK, Arabic, emoji grapheme clusters, ampersands, and comparison characters.',
    source: promotedCorpusSource('mindmap/multilingual-long-content.mmd'),
  },
  {
    title: 'Mindmap: Explicit Tidy Tree',
    category: 'Mindmap',
    description: 'A one-sided compiler dependency hierarchy using explicit tidy-tree layout instead of the central bilateral default.',
    source: promotedCorpusSource('mindmap/tidy-tree-explicit.mmd'),
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  GITGRAPH — promoted real-content corpus scenarios
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'GitGraph: Monorepo Delivery Lanes',
    category: 'GitGraph',
    description: 'Twelve delivery lanes with explicit main placement, double-digit branch orders, and a tagged coordination commit.',
    palettePeers: { count: 12, kind: 'delivery lanes' },
    source: promotedCorpusSource('gitgraph/many-lanes-and-ordering.mmd'),
  },
  {
    title: 'GitGraph: Merge Backports',
    category: 'GitGraph',
    description: 'A merge commit backported to a maintenance line with explicit immediate-parent ancestry.',
    source: promotedCorpusSource('gitgraph/merge-cherry-pick-backports.mmd'),
  },
  {
    title: 'GitGraph: CI/CD Promotion',
    category: 'GitGraph',
    description: 'Build, test, canary, and production promotion modeled through ordered branches, typed commits, tags, and merges.',
    source: promotedCorpusSource('gitgraph/cicd-promotion-pipeline.mmd'),
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  STYLE + PALETTE SHOWCASE
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Style + Palette: Flowchart',
    category: 'Style + Palette',
    description: 'One Mermaid source rendered with a named style and palette stack; appearance stays outside the source.',
    source: `flowchart TD
  subgraph product [Product Loop]
    A[Capture request] --> B{Ready?}
    B -->|yes| C[Ship]
    B -.->|needs work| D[Refine]
  end`,
    options: stylePaletteShowcaseOptions,
  },
  {
    title: 'Style + Palette: Architecture',
    category: 'Style + Palette',
    description: 'Architecture services, groups, and connectors use the same Style + Palette render options.',
    source: `architecture-beta
  group edge(cloud)[Edge Layer]
  group core(server)[Core Services]
  service web(server)[Web App] in edge
  service api(server)[API] in core
  service db(database)[Postgres] in core
  web:R --> L:api
  api:R --> L:db`,
    options: stylePaletteShowcaseOptions,
  },
  {
    title: 'Style + Palette: Sequence',
    category: 'Style + Palette',
    description: 'Sequence participants and messages keep their Mermaid meaning while the render call changes presentation.',
    source: `sequenceDiagram
  participant U as User
  participant E as Editor
  participant R as Renderer
  U->>E: Pick style and palette
  E->>R: render(source, options)
  R-->>E: SVG`,
    options: stylePaletteShowcaseOptions,
  },
  {
    title: 'Style + Palette: Class',
    category: 'Style + Palette',
    description: 'Class boxes and relationships share the same named look without source-level styling directives.',
    source: `classDiagram
  class Renderer {
    +renderSVG(source) string
    +renderASCII(source) string
  }
  class StyleStack {
    +style string
    +palette string
  }
  Renderer --> StyleStack : uses`,
    options: stylePaletteShowcaseOptions,
  },
  {
    title: 'Style + Palette: ER',
    category: 'Style + Palette',
    description: 'ER entities and relationships get a publication-ready treatment from render options.',
    source: `erDiagram
  USER {
    string id PK
    string email
  }
  DIAGRAM {
    string id PK
    string source
  }
  EXPORT {
    string id PK
    string format
  }
  USER ||--o{ DIAGRAM : creates
  DIAGRAM ||--o{ EXPORT : renders`,
    options: stylePaletteShowcaseOptions,
  },
  {
    title: 'Style + Palette: Timeline',
    category: 'Style + Palette',
    description: 'Timeline periods and events reuse the same style stack as the other families.',
    source: `timeline
  title Fork Roadmap
  section Discover
  2024 Q2 : Audit forks
          : Extract small PRs
  section Ship
  2024 Q3 : Style + Palette
          : Live editor examples`,
    options: stylePaletteShowcaseOptions,
  },
  {
    title: 'Style + Palette: Journey',
    category: 'Style + Palette',
    description: 'Journey task cards, sections, actors, and scores inherit the named look through render options.',
    source: `journey
  title Editor adoption
  section Try
    Open preset: 5: User
    Choose palette: 4: Designer, Developer
  section Share
    Copy URL: 5: User
    Export SVG: 4: Developer`,
    options: stylePaletteShowcaseOptions,
  },
  {
    title: 'Style + Palette: XY Chart',
    category: 'Style + Palette',
    description: 'XY chart labels, axes, grid, and series render with the same style stack while chart config still controls axes.',
    source: `xychart
  title "Styled Adoption"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Renders" 0 --> 100
  bar [25, 42, 58, 74, 88]
  line [18, 35, 52, 70, 95]`,
    options: { ...stylePaletteShowcaseOptions, interactive: true },
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  RADAR
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Radar: Model comparison (circle)',
    category: 'Radar',
    description: 'The default `graticule circle`: circular rings and smooth closed Catmull-Rom curves. Two model profiles compared across six shared axes — the silhouette is the message.',
    source: `radar-beta
  title Model comparison
  axis speed["Speed"], accuracy["Accuracy"], cost["Cost"]
  axis latency["Latency"], context["Context"], safety["Safety"]
  curve a["Model A"]{4, 5, 3, 4, 4, 5}
  curve b["Model B"]{5, 3, 4, 3, 5, 3}
  max 5`,
  },
  {
    title: 'Radar: Student grades (keyed values)',
    category: 'Radar',
    description: 'Keyed curve values (`{ english: 4, math: 5, … }`, colon optional) are reordered to axis order, so authoring order does not matter.',
    source: `radar-beta
  title Student grades
  axis math["Math"], science["Science"], english["English"], history["History"]
  curve alice["Alice"]{ english: 4, math: 5, history: 3, science: 4 }
  curve bob["Bob"]{ math: 3, science: 5, english: 4, history: 5 }
  max 5`,
  },
  {
    title: 'Radar: Incident response (polygon triangle)',
    category: 'Radar',
    description: '`graticule polygon` with three axes draws a triangular graticule and straight polygon edges.',
    source: `radar-beta
  title Incident response
  axis detect["Detect"], respond["Respond"], recover["Recover"]
  curve q3["Q3"]{3, 2, 4}
  curve q4["Q4"]{4, 4, 3}
  graticule polygon
  max 5`,
  },
  {
    title: 'Radar: Restaurant (polygon square)',
    category: 'Radar',
    description: 'Four axes under `graticule polygon` draw a square (diamond) graticule.',
    source: `radar-beta
  title Restaurant comparison
  axis food["Food Quality"], service["Service"], price["Price"], ambiance["Ambiance"]
  curve a["Restaurant A"]{4, 3, 2, 4}
  curve b["Restaurant B"]{3, 4, 3, 3}
  graticule polygon
  max 5`,
  },
  {
    title: 'Radar: Team skills (polygon pentagon)',
    category: 'Radar',
    description: 'Five axes under `graticule polygon` draw a pentagonal graticule — the polygon shape always follows the axis count.',
    source: `radar-beta
  title Team skills
  axis design["Design"], code["Code"], comms["Comms"], ops["Ops"], data["Data"]
  curve alice["Alice"]{4, 5, 3, 2, 4}
  curve bob["Bob"]{3, 3, 5, 4, 3}
  graticule polygon
  max 5`,
  },
  {
    title: 'Radar: Seasonal wind rose (polygon octagon)',
    category: 'Radar',
    description: 'Eight compass axes under `graticule polygon` draw an octagonal graticule — a natural fit for directional data.',
    source: `radar-beta
  title Seasonal wind rose
  axis n["N"], ne["NE"], e["E"], se["SE"], s["S"], sw["SW"], w["W"], nw["NW"]
  curve winter["Winter"]{5, 3, 2, 1, 2, 4, 5, 4}
  curve summer["Summer"]{2, 4, 5, 4, 3, 2, 1, 2}
  graticule polygon
  max 5`,
  },
  {
    title: 'Radar: Delivery Team Profiles',
    category: 'Radar',
    description: 'Eight peer team profiles share six delivery axes, stress-testing curve, point, fill, and legend identity above the legacy six-color boundary.',
    palettePeers: { count: 8, kind: 'peer curves' },
    source: `radar-beta
  title Delivery team profiles
  axis speed["Speed"], quality["Quality"], reliability["Reliability"]
  axis security["Security"], docs["Docs"], support["Support"]
  curve product["Product"]{4, 4, 3, 3, 4, 5}
  curve web["Web"]{5, 4, 4, 3, 3, 4}
  curve api["API"]{4, 5, 5, 4, 3, 3}
  curve data["Data"]{3, 4, 5, 4, 3, 3}
  curve mobile["Mobile"]{4, 4, 3, 4, 3, 4}
  curve security["Security"]{2, 4, 4, 5, 3, 3}
  curve qa["QA"]{3, 5, 4, 4, 3, 4}
  curve docs["Docs"]{3, 4, 3, 3, 5, 5}
  max 5`,
  },
]
