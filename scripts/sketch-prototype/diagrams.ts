// The 12 supported diagram types (canonical sources from editor/js/examples.js).
export const DIAGRAMS: { type: string; src: string }[] = [
  { type: 'Flowchart', src: `flowchart TD\n  A[Start] --> B{Decision?}\n  B -->|Yes| C[Do the thing]\n  B -->|No| D[Skip it]\n  C --> E[End]\n  D --> E` },
  { type: 'State', src: `stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing: start\n  Processing --> Complete: done\n  Processing --> Failed: error\n  Failed --> Idle: retry\n  Complete --> [*]` },
  { type: 'Architecture', src: `architecture-beta\n  group app(cloud)[Application]\n  group data(database)[Data]\n  service web(server)[Web App] in app\n  service api(server)[API] in app\n  service db(database)[Postgres] in data\n  web:R --> L:api\n  api:R --> L:db` },
  { type: 'Sequence', src: `sequenceDiagram\n  participant User\n  participant App\n  participant API\n  User->>App: Click export\n  App->>API: Render SVG\n  API-->>App: SVG string\n  App-->>User: Download` },
  { type: 'Class', src: `classDiagram\n  class Renderer {\n    +renderSVG(source) string\n    +renderASCII(source) string\n  }\n  class Theme {\n    +bg string\n    +fg string\n  }\n  Renderer --> Theme : uses` },
  { type: 'ER', src: `erDiagram\n  CUSTOMER {\n    string id PK\n    string email\n  }\n  ORDER {\n    string id PK\n    date created\n  }\n  LINE_ITEM {\n    string id PK\n    int quantity\n  }\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains` },
  { type: 'Timeline', src: `timeline\n  title Product roadmap\n  section Foundation\n  2024 Q1 : Prototype\n          : Parser coverage\n  section Launch\n  2024 Q2 : Public editor\n          : SVG export` },
  { type: 'Journey', src: `journey\n  title Editor adoption\n  section Try\n    Open editor: 5: User\n    Load example: 4: User, Developer\n  section Share\n    Copy URL: 5: User\n    Export SVG: 4: Developer` },
  { type: 'XY Chart', src: `xychart\n  title "Weekly renders"\n  x-axis [Mon, Tue, Wed, Thu, Fri]\n  y-axis "Renders" 0 --> 100\n  bar [25, 42, 58, 74, 88]\n  line [18, 35, 52, 70, 95]` },
  { type: 'Pie', src: `pie showData\n  title Export requests by format\n  "SVG" : 42\n  "PNG" : 28\n  "ASCII" : 18\n  "Unicode" : 12` },
  { type: 'Quadrant', src: `quadrantChart\n  title Feature priorities\n  x-axis Low impact --> High impact\n  y-axis Low effort --> High effort\n  quadrant-1 Plan carefully\n  quadrant-2 Big bets\n  quadrant-3 Defer\n  quadrant-4 Quick wins\n  SVG export: [0.78, 0.28]\n  MCP setup: [0.62, 0.72]\n  Theme polish: [0.35, 0.24]` },
  { type: 'Gantt', src: `gantt\n  title Release train\n  dateFormat YYYY-MM-DD\n  excludes weekends\n  section Build\n    Completed task :done, des1, 2024-01-08, 2024-01-10\n    Active task    :active, des2, 2024-01-11, 3d\n    Future task    :des3, after des2, 5d\n  section Ship\n    Crit review    :crit, rev1, after des3, 2d\n    Release        :milestone, m1, after rev1, 0d` },
]
