var EDITOR_SEMANTIC_STYLE = {
  style: {
    text: { fontSize: 13, letterSpacing: 0.1 },
    node: {
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: -0.1,
      paddingX: 22,
      paddingY: 14,
      cornerRadius: 16,
      lineWidth: 1.5,
    },
    edge: {
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: 0.1,
      lineWidth: 2.25,
      bendRadius: 12,
    },
    group: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      paddingX: 24,
      paddingY: 18,
      cornerRadius: 18,
      borderColor: '#f97316',
      lineWidth: 1.5,
    },
  },
};

var EDITOR_EXAMPLES = [
  {
    id: 'flowchart-basic',
    label: 'Flowchart',
    category: 'Supported diagrams',
    diagramType: 'Flowchart',
    description: 'Decision flow with labeled branches.',
    source: `flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do the thing]
  B -->|No| D[Skip it]
  C --> E[End]
  D --> E`,
  },
  {
    id: 'state-basic',
    label: 'State diagram',
    category: 'Supported diagrams',
    diagramType: 'State',
    description: 'Lifecycle using Mermaid stateDiagram-v2 syntax.',
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Processing: start
  Processing --> Complete: done
  Processing --> Failed: error
  Failed --> Idle: retry
  Complete --> [*]`,
  },
  {
    id: 'architecture-basic',
    label: 'Architecture',
    category: 'Supported diagrams',
    diagramType: 'Architecture',
    description: 'Services, groups, icons, and routed connections.',
    source: `architecture-beta
  group app(cloud)[Application]
  group data(database)[Data]
  service web(server)[Web App] in app
  service api(server)[API] in app
  service db(database)[Postgres] in data
  web:R --> L:api
  api:R --> L:db`,
  },
  {
    id: 'sequence-basic',
    label: 'Sequence',
    category: 'Supported diagrams',
    diagramType: 'Sequence',
    description: 'Request/response messages between participants.',
    source: `sequenceDiagram
  participant User
  participant App
  participant API
  User->>App: Click export
  App->>API: Render SVG
  API-->>App: SVG string
  App-->>User: Download`,
  },
  {
    id: 'class-basic',
    label: 'Class',
    category: 'Supported diagrams',
    diagramType: 'Class',
    description: 'Classes with members and relationships.',
    source: `classDiagram
  class Renderer {
    +renderSVG(source) string
    +renderASCII(source) string
  }
  class Theme {
    +bg string
    +fg string
  }
  Renderer --> Theme : uses`,
  },
  {
    id: 'er-basic',
    label: 'ER diagram',
    category: 'Supported diagrams',
    diagramType: 'ER',
    description: 'Entities, attributes, keys, and cardinality markers.',
    source: `erDiagram
  CUSTOMER {
    string id PK
    string email
  }
  ORDER {
    string id PK
    date created
  }
  LINE_ITEM {
    string id PK
    int quantity
  }
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains`,
  },
  {
    id: 'timeline-basic',
    label: 'Timeline',
    category: 'Supported diagrams',
    diagramType: 'Timeline',
    description: 'Chronological milestones with sections.',
    source: `timeline
  title Product roadmap
  section Foundation
  2024 Q1 : Prototype
          : Parser coverage
  section Launch
  2024 Q2 : Public editor
          : SVG export`,
  },
  {
    id: 'journey-basic',
    label: 'User journey',
    category: 'Supported diagrams',
    diagramType: 'Journey',
    description: 'Scored user tasks grouped by section.',
    source: `journey
  title Editor adoption
  section Try
    Open editor: 5: User
    Load example: 4: User, Developer
  section Share
    Copy URL: 5: User
    Export SVG: 4: Developer`,
  },
  {
    id: 'xychart-basic',
    label: 'XY chart',
    category: 'Supported diagrams',
    diagramType: 'XY Chart',
    description: 'Bar and line series using xychart syntax.',
    source: `xychart
  title "Weekly renders"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Renders" 0 --> 100
  bar [25, 42, 58, 74, 88]
  line [18, 35, 52, 70, 95]`,
    options: { interactive: true },
  },
  {
    id: 'pie-basic',
    label: 'Pie chart',
    category: 'Supported diagrams',
    diagramType: 'Pie',
    description: 'Proportional slices with values shown in the legend.',
    source: `pie showData
  title Export requests by format
  "SVG" : 42
  "PNG" : 28
  "ASCII" : 18
  "Unicode" : 12`,
  },
  {
    id: 'quadrant-basic',
    label: 'Quadrant chart',
    category: 'Supported diagrams',
    diagramType: 'Quadrant',
    description: 'Two-axis priority map with labeled regions and points.',
    source: `quadrantChart
  title Feature priorities
  x-axis Low impact --> High impact
  y-axis Low effort --> High effort
  quadrant-1 Plan carefully
  quadrant-2 Big bets
  quadrant-3 Defer
  quadrant-4 Quick wins
  SVG export: [0.78, 0.28]
  MCP setup: [0.62, 0.72]
  Theme polish: [0.35, 0.24]`,
  },
  {
    id: 'gantt-basic',
    label: 'Gantt chart',
    category: 'Supported diagrams',
    diagramType: 'Gantt',
    description: 'Sections, dependencies, status tags, and a milestone.',
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
    Release        :milestone, m1, after rev1, 0d`,
  },
  {
    id: 'styled-flowchart',
    label: 'Styled flowchart',
    category: 'Role style presets',
    diagramType: 'Flowchart',
    description: 'Flowchart using semantic node, edge, text, and group roles.',
    source: `flowchart TD
  subgraph product [Product Loop]
    A[Capture request] --> B{Ready?}
    B -->|yes| C[Ship]
    B -.->|needs work| D[Refine]
  end`,
    options: EDITOR_SEMANTIC_STYLE,
  },
  {
    id: 'styled-state',
    label: 'Styled state',
    category: 'Role style presets',
    diagramType: 'State',
    description: 'State diagram consuming the same flowchart/state role mapping.',
    source: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review: submit
  Review --> Draft: request changes
  Review --> Published: approve
  Published --> [*]`,
    options: EDITOR_SEMANTIC_STYLE,
  },
  {
    id: 'styled-architecture',
    label: 'Styled architecture',
    category: 'Role style presets',
    diagramType: 'Architecture',
    description: 'Architecture services, groups, and connectors styled semantically.',
    source: `architecture-beta
  group edge(cloud)[Edge Layer]
  group core(server)[Core Services]
  service web(server)[Web App] in edge
  service api(server)[API] in core
  service db(database)[Postgres] in core
  web:R --> L:api
  api:R --> L:db`,
    options: EDITOR_SEMANTIC_STYLE,
  },
  {
    id: 'styled-sequence',
    label: 'Styled sequence',
    category: 'Role style presets',
    diagramType: 'Sequence',
    description: 'Participants use node style; messages use edge style.',
    source: `sequenceDiagram
  participant U as User
  participant E as Editor
  participant R as Renderer
  U->>E: Change style role
  E->>R: render(source, options.style)
  R-->>E: SVG`,
    options: EDITOR_SEMANTIC_STYLE,
  },
  {
    id: 'styled-class',
    label: 'Styled class',
    category: 'Role style presets',
    diagramType: 'Class',
    description: 'Class boxes and relationships through shared style roles.',
    source: `classDiagram
  class Renderer {
    +renderSVG(source) string
    +renderASCII(source) string
  }
  class StyleResolver {
    +resolveRenderStyle(options) object
  }
  Renderer --> StyleResolver : uses`,
    options: EDITOR_SEMANTIC_STYLE,
  },
  {
    id: 'styled-er',
    label: 'Styled ER',
    category: 'Role style presets',
    diagramType: 'ER',
    description: 'ER entities and relationships inherit node/edge roles.',
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
    options: EDITOR_SEMANTIC_STYLE,
  },
  {
    id: 'styled-timeline',
    label: 'Styled timeline',
    category: 'Role style presets',
    diagramType: 'Timeline',
    description: 'Timeline periods and events styled as semantic cards/groups.',
    source: `timeline
  title Fork Roadmap
  section Discover
  2024 Q2 : Audit forks
          : Extract small PRs
  section Ship
  2024 Q3 : Style roles
          : Live editor presets`,
    options: EDITOR_SEMANTIC_STYLE,
  },
  {
    id: 'styled-journey',
    label: 'Styled journey',
    category: 'Role style presets',
    diagramType: 'Journey',
    description: 'Journey sections, task cards, and actor chips use role styles.',
    source: `journey
  title Editor adoption
  section Try
    Open preset: 5: User
    Tune roles: 4: Designer, Developer
  section Share
    Copy URL: 5: User
    Export SVG: 4: Developer`,
    options: EDITOR_SEMANTIC_STYLE,
  },
  {
    id: 'styled-xychart',
    label: 'Styled xychart',
    category: 'Role style presets',
    diagramType: 'XY Chart',
    description: 'XY chart title, axes, grid, and series labels with shared roles.',
    source: `xychart
  title "Styled Adoption"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Renders" 0 --> 100
  bar [25, 42, 58, 74, 88]
  line [18, 35, 52, 70, 95]`,
    options: Object.assign({}, EDITOR_SEMANTIC_STYLE, { interactive: true }),
  },
];

var selectedExampleId = '';

function cloneEditorConfig(config) {
  return config ? JSON.parse(JSON.stringify(config)) : {};
}

function findEditorExample(id) {
  for (var i = 0; i < EDITOR_EXAMPLES.length; i++) {
    if (EDITOR_EXAMPLES[i].id === id) return EDITOR_EXAMPLES[i];
  }
  return null;
}

function exampleGroups() {
  var groups = [];
  var groupMap = {};
  EDITOR_EXAMPLES.forEach(function(example) {
    var category = example.category || 'Examples';
    if (!groupMap[category]) {
      groupMap[category] = { category: category, examples: [] };
      groups.push(groupMap[category]);
    }
    groupMap[category].examples.push(example);
  });
  return groups;
}

function exampleGlyph(example) {
  var type = example.diagramType || 'Example';
  var glyphs = {
    Flowchart: 'F',
    State: 'S',
    Architecture: 'A',
    Sequence: 'Q',
    Class: 'C',
    ER: 'ER',
    Timeline: 'T',
    Journey: 'J',
    'XY Chart': 'XY',
    Pie: 'P',
    Quadrant: '4Q',
    Gantt: 'G',
  };
  return glyphs[type] || type.slice(0, 2).toUpperCase();
}

function renderExamplePaletteHtml() {
  var examplesHtml = exampleGroups().map(function(group) {
    return '<section class="example-category">'
      + '<div class="example-category-title">' + escHtml(group.category) + '</div>'
      + '<div class="example-category-grid">'
      + group.examples.map(function(example) {
        return '<button class="example-dropdown-item" type="button" role="menuitem" data-example="' + escAttr(example.id) + '" data-diagram="' + escAttr(example.diagramType || '') + '" title="' + escAttr(example.description || example.label) + '">'
          + '<span class="example-item-title"><span class="example-item-glyph" aria-hidden="true">' + escHtml(exampleGlyph(example)) + '</span>' + escHtml(example.label) + '</span>'
          + '<span class="example-item-meta">' + escHtml(example.diagramType || '') + '</span>'
          + '<span class="example-item-description">' + escHtml(example.description || '') + '</span>'
          + '</button>';
      }).join('')
      + '</div>'
      + '</section>';
  }).join('');

  return examplesHtml
    + '<div class="example-menu-footer">'
    + '<button class="example-clear-btn" type="button" data-action="clear-editor">New blank diagram</button>'
    + '</div>';
}

function renderExamplePalettes() {
  if (examplesSidebarList) examplesSidebarList.innerHTML = renderExamplePaletteHtml();
}

function markActiveExample(id) {
  selectedExampleId = id || '';
  document.querySelectorAll('.example-dropdown-item').forEach(function(item) {
    item.classList.toggle('active', item.dataset.example === selectedExampleId);
  });
}

function loadEditorExample(id) {
  var example = findEditorExample(id);
  if (!example) return;

  editor.value = example.source.trim();
  state.config = cloneEditorConfig(example.options);
  markActiveExample(example.id);

  // Examples are source/config presets only; keep the user's selected theme.
  if (typeof applyThemeToPage === 'function') applyThemeToPage(state.theme);
  if (typeof updateThemeButton === 'function') updateThemeButton();

  updateLineNumbers();
  updateCursorPos();
  scheduleRender(0);
  updateHash();
  showToast('Loaded ' + example.label);
}

var examplesSidebar = document.getElementById('examples-sidebar');
var examplesSidebarBtn = document.getElementById('examples-sidebar-btn');
var examplesSidebarClose = document.getElementById('examples-sidebar-close');
var examplesSidebarList = document.getElementById('examples-sidebar-list');

function setExamplesSidebarOpen(open) {
  if (!examplesSidebar) return;
  examplesSidebar.classList.toggle('open', open);
  examplesSidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (examplesSidebarBtn) {
    examplesSidebarBtn.classList.toggle('active', open);
    examplesSidebarBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    examplesSidebarBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

function openExamplesSidebar() {
  setExamplesSidebarOpen(true);
  if (examplesSidebarList) {
    var activeItem = examplesSidebarList.querySelector('.example-dropdown-item.active') || examplesSidebarList.querySelector('.example-dropdown-item');
    if (activeItem) activeItem.focus({ preventScroll: false });
  }
}

renderExamplePalettes();

if (examplesSidebarBtn && examplesSidebar) {
  examplesSidebarBtn.addEventListener('click', function() {
    setExamplesSidebarOpen(!examplesSidebar.classList.contains('open'));
  });
}

if (examplesSidebarClose) {
  examplesSidebarClose.addEventListener('click', function() {
    setExamplesSidebarOpen(false);
  });
}

if (examplesSidebarList) {
  examplesSidebarList.addEventListener('click', function(e) {
    var item = e.target.closest('.example-dropdown-item');
    if (!item) return;
    loadEditorExample(item.dataset.example || '');
  });
}

document.addEventListener('click', function(e) {
  var starter = e.target.closest('.placeholder-chip[data-example]');
  if (starter) {
    loadEditorExample(starter.dataset.example || '');
    return;
  }
  if (e.target.closest('[data-action="load-example"]')) {
    openExamplesSidebar();
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  if (examplesSidebar && examplesSidebar.classList.contains('open')) {
    setExamplesSidebarOpen(false);
    if (examplesSidebarBtn) examplesSidebarBtn.focus();
  }
});
