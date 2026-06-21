// ============================================================================
// Visual-rubric fixture batteries (docs/design/system/layout-rubric.md).
//
// SIMPLE: a combinatorial battery of small diagrams — every routing pattern
// the route contracts make claims about, across all four directions, and a
// chain per shape so every outline oracle is exercised. These must satisfy
// every HARD rubric metric and the per-class soft thresholds.
//
// COMPLICATED: a small set of real-world-shaped diagrams (the issue #25
// MFA regression, the README hero, nested direction overrides, a dense
// release workflow). Hard metrics must still be zero; soft metrics are
// pinned as ratchets so they can only improve.
// ============================================================================

export interface RubricFixture {
  id: string
  source: string
  /** Soft expectations beyond the hard metrics. */
  expect?: {
    maxCrossings?: number
    maxBendsPerEdge?: number
    minPortAnchoredEdgeRate?: number
    maxPeerBarycenterDelta?: number
  }
}

const DIRECTIONS = ['LR', 'TD', 'RL', 'BT'] as const

const PATTERNS: Record<string, (dir: string) => string> = {
  chain: dir => `flowchart ${dir}\n  A[One] --> B[Two] --> C[Three]`,
  'diamond-chain': dir => `flowchart ${dir}\n  A[Start] --> B{Decide} --> C[End]`,
  'fanout-labeled': dir => `flowchart ${dir}\n  A{Decide} -- Yes --> B[Accept]\n  A -- No --> C[Reject]`,
  fanout3: dir => `flowchart ${dir}\n  A[Hub] --> B[One]\n  A --> C[Two]\n  A --> D[Three]`,
  fanin: dir => `flowchart ${dir}\n  A[One] --> C[Join]\n  B[Two] --> C`,
  reciprocal: dir => `flowchart ${dir}\n  A[Ping] --> B[Pong]\n  B --> A`,
  retry: dir => `flowchart ${dir}\n  A[Page] --> B{Valid?}\n  B -- No --> A\n  B -- Yes --> C[Done]`,
  cycle: dir => `flowchart ${dir}\n  A --> B\n  B --> C\n  C --> A`,
  skip: dir => `flowchart ${dir}\n  A --> B\n  B --> C\n  A --> C`,
  'self-loop': dir => `flowchart ${dir}\n  A[Task] --> A\n  A --> B[Next]`,
  container: dir => `flowchart ${dir}\n  Start --> Pipeline\n  subgraph Pipeline\n    F[Fetch] --> P[Parse]\n  end\n  Pipeline --> Done`,
  'labeled-chain': dir => `flowchart ${dir}\n  A[Input] -- check --> B[Filter] -- emit --> C[Output]`,
}

const SHAPES: Record<string, (label: string) => string> = {
  rect: l => `[${l}]`,
  rounded: l => `(${l})`,
  stadium: l => `([${l}])`,
  circle: l => `((${l}))`,
  diamond: l => `{${l}}`,
  hexagon: l => `{{${l}}}`,
  cylinder: l => `[(${l})]`,
  subroutine: l => `[[${l}]]`,
}

export function simpleFixtures(): RubricFixture[] {
  const fixtures: RubricFixture[] = []
  for (const dir of DIRECTIONS) {
    for (const [pattern, build] of Object.entries(PATTERNS)) {
      fixtures.push({
        id: `${pattern}-${dir}`,
        source: build(dir),
        expect: {
          maxCrossings: 0,
          maxBendsPerEdge: 4,
          ...((pattern === 'fanout3' || pattern === 'fanin') ? { maxPeerBarycenterDelta: 0.75 } : {}),
        },
      })
    }
    for (const [shape, wrap] of Object.entries(SHAPES)) {
      fixtures.push({
        id: `shape-${shape}-${dir}`,
        source: `flowchart ${dir}\n  A${wrap('Aa')} --> B${wrap('Bb')} --> C${wrap('Cc')}`,
        expect: { maxCrossings: 0, maxBendsPerEdge: 2, minPortAnchoredEdgeRate: 1 },
      })
      fixtures.push({
        id: `shape-${shape}-reciprocal-${dir}`,
        source: `flowchart ${dir}\n  A${wrap('Aa')} --> B${wrap('Bb')}\n  B --> A`,
        expect: { maxCrossings: 0, maxBendsPerEdge: 4 },
      })
    }
  }
  // Mixed-shape gauntlet per direction.
  for (const dir of DIRECTIONS) {
    fixtures.push({
      id: `shapes-mixed-${dir}`,
      source: `flowchart ${dir}\n  A((In)) --> B(Round) --> C([Stad]) --> D{{Hex}} --> E[(Cyl)] --> F[[Sub]] --> G{End?}`,
      expect: { maxCrossings: 0, maxBendsPerEdge: 2 },
    })
  }
  return fixtures
}

export function complicatedFixtures(): RubricFixture[] {
  return [
    {
      id: 'mfa-login',
      source: `flowchart LR
  A[User] --> B[Login Page]
  B --> C{Valid Credentials?}
  C -- No --> B
  C -- Yes --> D{MFA Enabled?}
  D -- No --> G[Create Session]
  D -- Yes --> E[Enter MFA Code]
  E --> F{Code Valid?}
  F -- No --> E
  F -- Yes --> G`,
      expect: { maxCrossings: 0, maxBendsPerEdge: 3, minPortAnchoredEdgeRate: 0.8 },
    },
    {
      id: 'hero-td',
      source: `flowchart TD
  User((User)) --> UI[Login Page]
  UI --> Auth{Valid?}
  Auth -->|no| UI
  Auth -->|yes| MFA{MFA}
  MFA -->|ok| Session[Create Session]
  MFA -->|fail| UI
  Session --> Dash[Dashboard]`,
      expect: { maxBendsPerEdge: 4 },
    },
    {
      id: 'auth-flow-dashboard',
      source: `flowchart LR
  A[User] --> B[Login Page]
  B --> C{Valid Credentials?}
  C -->|No| B
  C -->|Yes| D{MFA Enabled?}
  D -->|Yes| E[Enter MFA Code]
  E --> F{Code Valid?}
  F -->|No| E
  D -->|No| G[Create Session]
  F -->|Yes| G
  G --> H[Dashboard]`,
      expect: { maxCrossings: 0, maxBendsPerEdge: 3 },
    },
    {
      id: 'nested-direction-override',
      source: `flowchart LR
  subgraph TOP
    direction TB
    subgraph B1
        direction RL
        i1 --> f1
    end
    subgraph B2
        direction BT
        i2 --> f2
    end
  end
  A --> TOP --> B
  B1 --> B2`,
      expect: { maxBendsPerEdge: 6 },
    },
    {
      id: 'release-workflow',
      source: `flowchart TD
  Plan[Plan Sprint] --> Dev[Develop]
  Dev --> Review{Code Review}
  Review -- changes --> Dev
  Review -- approved --> CI{CI Green?}
  CI -- no --> Fix[Fix Build]
  Fix --> CI
  CI -- yes --> Stage[Deploy Staging]
  Stage --> QA{QA Sign-off?}
  QA -- no --> Dev
  QA -- yes --> Prod[Deploy Prod]
  Prod --> Monitor[Monitor]
  Monitor --> Incident{Incident?}
  Incident -- yes --> Hotfix[Hotfix]
  Hotfix --> Review
  Incident -- no --> Done([Done])`,
      expect: { maxBendsPerEdge: 6 },
    },
    {
      id: 'double-diamond-fan',
      source: `flowchart LR
  In[Request] --> V{Sanitize?}
  V -- ok --> P{Route}
  V -- bad --> Err[Reject]
  P -- a --> S1[Service A]
  P -- b --> S2[Service B]
  S1 --> Out[Response]
  S2 --> Out
  Err --> Out`,
      expect: { maxBendsPerEdge: 4 },
    },
  ]
}
