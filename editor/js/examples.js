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
    id: 'styled-flowchart',
    label: 'Styled flowchart',
    theme: 'solarized-light',
    source: `flowchart TD
  subgraph product [Product Loop]
    A[Capture request] --> B{Ready?}
    B -->|yes| C[Ship]
    B -.->|needs work| D[Refine]
  end`,
    options: EDITOR_SEMANTIC_STYLE,
  },
  {
    id: 'styled-architecture',
    label: 'Styled architecture',
    theme: 'solarized-light',
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
    theme: 'solarized-light',
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
    theme: 'solarized-light',
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
    theme: 'solarized-light',
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
    theme: 'solarized-light',
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
    theme: 'solarized-light',
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
    theme: 'solarized-light',
    source: `xychart
  title "Styled Adoption"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Renders" 0 --> 100
  bar [25, 42, 58, 74, 88]
  line [18, 35, 52, 70, 95]`,
    options: Object.assign({}, EDITOR_SEMANTIC_STYLE, { interactive: true }),
  },
];

function cloneEditorConfig(config) {
  return config ? JSON.parse(JSON.stringify(config)) : {};
}

function findEditorExample(id) {
  for (var i = 0; i < EDITOR_EXAMPLES.length; i++) {
    if (EDITOR_EXAMPLES[i].id === id) return EDITOR_EXAMPLES[i];
  }
  return null;
}

function loadEditorExample(id) {
  var example = findEditorExample(id);
  if (!example) return;

  editor.value = example.source.trim();
  state.config = cloneEditorConfig(example.options);

  if (typeof setTheme === 'function') {
    setTheme(example.theme || '');
  } else {
    state.theme = example.theme || '';
  }

  updateLineNumbers();
  updateCursorPos();
  scheduleRender(0);
  updateHash();
  showToast('Loaded ' + example.label);
}

var exampleDropdownBtn = document.getElementById('example-dropdown-btn');
var exampleDropdownMenu = document.getElementById('example-dropdown-menu');
var exampleDropdownWrap = document.getElementById('example-dropdown-wrap');

if (exampleDropdownBtn && exampleDropdownMenu && exampleDropdownWrap) {
  exampleDropdownBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var isOpen = exampleDropdownMenu.classList.toggle('open');
    exampleDropdownBtn.classList.toggle('open', isOpen);
  });

  exampleDropdownMenu.addEventListener('click', function(e) {
    var item = e.target.closest('.example-dropdown-item');
    if (!item) return;
    loadEditorExample(item.dataset.example || '');
    exampleDropdownMenu.classList.remove('open');
    exampleDropdownBtn.classList.remove('open');
  });

  document.addEventListener('click', function(e) {
    if (!exampleDropdownWrap.contains(e.target)) {
      exampleDropdownMenu.classList.remove('open');
      exampleDropdownBtn.classList.remove('open');
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      exampleDropdownMenu.classList.remove('open');
      exampleDropdownBtn.classList.remove('open');
    }
  });
}
