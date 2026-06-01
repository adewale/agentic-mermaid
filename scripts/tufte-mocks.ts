/**
 * Generate mock SVG + PNG images demonstrating the Tufte theme.
 * Run: bun scripts/tufte-mocks.ts
 */
import { renderMermaidSVG } from '../src/index.ts'
import { THEMES } from '../src/theme.ts'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Resvg } from '@resvg/resvg-js'

const outDir = join(import.meta.dir, '..', 'assets', 'tufte-mocks')
mkdirSync(outDir, { recursive: true })

const tufte = THEMES['tufte']!
const tufteOpts = { ...tufte, font: 'Palatino' }

// ============================================================================
// Diagram sources
// ============================================================================

// 1. Flowchart
const flowchart = `graph TD
  A[Research Question] --> B{Literature Review}
  B --> C[Hypothesis]
  B --> D[Data Collection]
  C --> E[Experimental Design]
  D --> E
  E --> F{Statistical Analysis}
  F -->|Significant| G[Publication]
  F -->|Not Significant| H[Revise Hypothesis]
  H --> C`

// 2. Sequence diagram
const sequence = `sequenceDiagram
  participant R as Researcher
  participant L as Lab
  participant P as Peer Review
  R->>L: Submit experiment
  L->>L: Run trials
  L-->>R: Results
  R->>P: Submit manuscript
  P-->>R: Revisions requested
  R->>P: Revised manuscript
  P-->>R: Accepted`

// 3. Class diagram
const classDiagram = `classDiagram
  class DataSet {
    +String name
    +Int observations
    +collect()
    +clean()
    +analyze()
  }
  class Visualization {
    +String type
    +render()
    +annotate()
  }
  class StatModel {
    +String method
    +Float confidence
    +fit()
    +predict()
  }
  DataSet --> Visualization : informs
  DataSet --> StatModel : feeds
  StatModel --> Visualization : produces`

// 4. ER diagram
const erDiagram = `erDiagram
  AUTHOR ||--o{ PUBLICATION : writes
  PUBLICATION ||--|{ CITATION : receives
  PUBLICATION }o--|| JOURNAL : "published in"
  AUTHOR }o--o{ INSTITUTION : "affiliated with"`

// 5. Journey
const journey = `journey
  title Research Publication Journey
  section Discovery
    Read literature: 5: Researcher
    Identify gap: 3: Researcher
  section Experiment
    Design study: 4: Researcher, Lab
    Collect data: 3: Lab
    Analyze results: 4: Researcher
  section Publication
    Write manuscript: 2: Researcher
    Peer review: 3: Reviewer
    Revise and publish: 5: Researcher`

// 6. Timeline
const timeline = `timeline
  title History of Data Visualization
  section Early Foundations
    1786 : William Playfair invents bar chart
    1858 : Florence Nightingale's polar area diagram
  section Statistical Graphics
    1900 : Karl Pearson's histogram formalization
    1914 : Willard Brinton's Graphic Methods
  section Modern Era
    1967 : Jacques Bertin's Semiology of Graphics
    1977 : John Tukey's Exploratory Data Analysis
    1983 : Edward Tufte's Visual Display of Quantitative Information`

// 7. XY Chart
const xychart = `xychart-beta
  title "Annual Citations by Publication Year"
  x-axis [2018, 2019, 2020, 2021, 2022, 2023, 2024]
  y-axis "Citations" 0 --> 450
  bar [45, 82, 156, 280, 350, 410, 390]
  line [45, 82, 156, 280, 350, 410, 390]`

// 8. Architecture: Microservices
const archMicroservices = `graph LR
  subgraph Client Layer
    Web[Web App]
    Mobile[Mobile App]
  end
  subgraph API Gateway
    GW[Gateway / Load Balancer]
  end
  subgraph Services
    Auth[Auth Service]
    Users[User Service]
    Orders[Order Service]
    Notify[Notification Service]
  end
  subgraph Data Layer
    DB1[(User DB)]
    DB2[(Order DB)]
    MQ[Message Queue]
  end
  Web --> GW
  Mobile --> GW
  GW --> Auth
  GW --> Users
  GW --> Orders
  Auth --> DB1
  Users --> DB1
  Orders --> DB2
  Orders --> MQ
  MQ --> Notify`

// 9. Architecture: Data Pipeline
const archPipeline = `graph TD
  subgraph Ingestion
    S1[Kafka Broker]
    S2[REST Ingest API]
    S3[File Drop / S3]
  end
  subgraph Processing
    ETL[Spark ETL Jobs]
    Valid[Validation & Schema]
    Enrich[Enrichment Service]
  end
  subgraph Storage
    DW[(Data Warehouse)]
    Lake[(Data Lake)]
    Cache[(Redis Cache)]
  end
  subgraph Serving
    API[Query API]
    Dash[Dashboard]
    ML[ML Pipeline]
  end
  S1 --> ETL
  S2 --> Valid
  S3 --> Valid
  Valid --> ETL
  ETL --> Enrich
  Enrich --> DW
  Enrich --> Lake
  DW --> API
  DW --> Dash
  Lake --> ML
  API --> Cache`

// 10. Architecture: CI/CD
const archCICD = `graph LR
  Dev[Developer] --> Repo[Git Repository]
  Repo --> CI{CI Pipeline}
  CI -->|Lint| Lint[Static Analysis]
  CI -->|Test| Test[Unit + Integration]
  CI -->|Build| Build[Docker Build]
  Lint --> Gate{Quality Gate}
  Test --> Gate
  Build --> Gate
  Gate -->|Pass| Stage[Staging Deploy]
  Gate -->|Fail| Dev
  Stage --> Smoke[Smoke Tests]
  Smoke -->|Pass| Prod[Production Deploy]
  Smoke -->|Fail| Dev`

// ============================================================================
// Diagram registry
// ============================================================================

const diagrams = [
  { name: 'flowchart', source: flowchart },
  { name: 'sequence', source: sequence },
  { name: 'class', source: classDiagram },
  { name: 'er', source: erDiagram },
  { name: 'journey', source: journey },
  { name: 'timeline', source: timeline },
  { name: 'xychart', source: xychart },
  { name: 'arch-microservices', source: archMicroservices },
  { name: 'arch-pipeline', source: archPipeline },
  { name: 'arch-cicd', source: archCICD },
]

// ============================================================================
// SVG to PNG conversion
// ============================================================================

function svgToPng(svg: string, scale: number = 2): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom' as const, value: scale },
    font: {
      // Use system fonts as fallback since Google Fonts aren't available locally
      fontDirs: ['/usr/share/fonts', '/usr/local/share/fonts'],
      defaultFontFamily: 'serif',
    },
  })
  const rendered = resvg.render()
  return Buffer.from(rendered.asPng())
}

// ============================================================================
// Generate all outputs
// ============================================================================

const salmon = THEMES['salmon']!
const salmonOpts = { ...salmon }

const themes = [
  { suffix: 'tufte-light', opts: tufteOpts },
  { suffix: 'zinc-light', opts: {} },
  { suffix: 'salmon', opts: salmonOpts },
]

let svgCount = 0
let pngCount = 0

for (const { name, source } of diagrams) {
  for (const { suffix, opts } of themes) {
    const svg = renderMermaidSVG(source, opts)
    writeFileSync(join(outDir, `${name}-${suffix}.svg`), svg)
    svgCount++

    const png = svgToPng(svg)
    writeFileSync(join(outDir, `${name}-${suffix}.png`), png)
    pngCount++
  }
}

console.log(`Generated ${svgCount} SVGs + ${pngCount} PNGs in ${outDir}`)
console.log('\nDiagram types:')
for (const { name } of diagrams) {
  console.log(`  ${name}`)
}
console.log('\nThemes: tufte-light, zinc-light, salmon')
