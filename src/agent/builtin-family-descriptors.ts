// Built-in discovery data, independent of executable registry state.
import * as familyDetection from '../shared/builtin-family-detection.ts'
import { STABLE_FAMILY_DESCRIPTOR_SEEDS } from './stable-family-metadata.ts'
import type { SceneRole } from '../scene/roles.ts'
import type { CoreScenePrimitive } from '../scene/capabilities.ts'
import { C4_CONFIG_KEYS, C4_NOOP_CONFIG_KEYS } from '../c4/config.ts'

import type { SemanticChannelName } from '../scene/ir.ts'
import type { BuiltinFamilyMetadata, FamilyMaturity, FamilySceneRolePrimitiveDeclaration, FamilyConfigContract } from './family-registry.ts'

export interface BuiltinFamilyDescriptorSeed extends BuiltinFamilyMetadata {
  upstreamId: string
  maturity: FamilyMaturity
  detect: (firstLineLower: string) => boolean
  detectLoose?: (firstLineLower: string) => boolean
  aliases?: readonly string[]
  sceneRoles: readonly FamilySceneRolePrimitiveDeclaration[]
  semanticChannels: readonly SemanticChannelName[]
  config: FamilyConfigContract
}

function nativeSceneRole(role: SceneRole, ...primitives: readonly CoreScenePrimitive[]): FamilySceneRolePrimitiveDeclaration {
  return { role, primitives }
}

const SEQUENCE_SCENE_ROLES = [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('actor', 'container', 'shape'),
      nativeSceneRole('lifeline', 'container', 'connector'),
      nativeSceneRole('activation', 'container', 'shape'),
      nativeSceneRole('message', 'container', 'connector'),
      nativeSceneRole('block', 'container', 'connector', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('note', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('icon', 'container', 'shape', 'text'),
    ]

export const BUILTIN_FAMILY_DESCRIPTOR_SEEDS = [
  {
    id: 'flowchart',
    upstreamId: 'flowchart-v2',
    maturity: 'stable',
    label: 'Flowchart',
    headers: ['flowchart', 'graph'],
    aliases: ['swimlane'],
    narrower: 'asFlowchart',
    editorDiagramType: 'Flowchart',
    editorLabel: 'Flowchart',
    editorDescription: 'Decision flow with labeled branches.',
    editorExampleId: 'flowchart-basic',
    editorGlyph: 'F',
    config: {
      section: 'flowchart',
      keys: ['nodeSpacing', 'rankSpacing', 'wrappingWidth', 'titleTopMargin', 'subGraphTitleMargin', 'arrowMarkerAbsolute', 'diagramPadding', 'htmlLabels', 'curve', 'padding', 'defaultRenderer', 'inheritDir', 'look', 'minNodeWidth', 'theme'],
      noopKeys: ['arrowMarkerAbsolute', 'curve', 'defaultRenderer', 'diagramPadding', 'htmlLabels', 'inheritDir', 'look', 'minNodeWidth', 'padding', 'subGraphTitleMargin', 'theme', 'titleTopMargin'],
    },
    semanticChannels: [],
    detect: familyDetection.detectsFlowchartFamily,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('edge', 'connector'),
      nativeSceneRole('edge-label', 'container'),
      nativeSceneRole('node', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('icon', 'container', 'shape', 'text'),
    ],
    example: 'flowchart TD\n  A[Start] --> B{Ship?}\n  B -->|yes| C[Deploy]\n  B -->|no| D[Fix]',
    editorExample: `flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do the thing]
  B -->|No| D[Skip it]
  C --> E[End]
  D --> E`,
  },
  {
    id: 'state',
    upstreamId: 'stateDiagram',
    maturity: 'stable',
    label: 'State',
    headers: ['stateDiagram', 'stateDiagram-v2'],
    narrower: 'asState',
    editorDiagramType: 'State',
    editorLabel: 'State diagram',
    editorDescription: 'Lifecycle using Mermaid stateDiagram-v2 syntax.',
    editorExampleId: 'state-basic',
    editorGlyph: 'S',
    config: {
      section: 'state',
      keys: [
        'arrowMarkerAbsolute',
        'compositTitleSize',
        'defaultRenderer',
        'dividerMargin',
        'edgeLengthFactor',
        'fontSize',
        'fontSizeFactor',
        'forkHeight',
        'forkWidth',
        'labelHeight',
        'layout',
        'look',
        'miniPadding',
        'minNodeWidth',
        'nodeSpacing',
        'noteMargin',
        'padding',
        'radius',
        'rankSpacing',
        'sizeUnit',
        'textHeight',
        'theme',
        'titleShift',
        'titleTopMargin',
        'wrappingWidth',
      ],
    },
    semanticChannels: ['status'],
    detect: familyDetection.detectsStateFamily,
    detectLoose: familyDetection.detectsStateFamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('edge', 'connector'),
      nativeSceneRole('edge-label', 'container'),
      nativeSceneRole('node', 'container', 'shape'),
      nativeSceneRole('note', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review : submit\n  Review --> [*] : approve',
    editorExample: `stateDiagram-v2
  [*] --> Idle
  Idle --> Processing: start
  Processing --> Complete: done
  Processing --> Failed: error
  Failed --> Idle: retry
  Complete --> [*]`,
  },
  {
    id: 'sequence',
    upstreamId: 'sequence',
    maturity: 'stable',
    label: 'Sequence',
    headers: ['sequenceDiagram'],
    narrower: 'asSequence',
    editorDiagramType: 'Sequence',
    editorLabel: 'Sequence',
    editorDescription: 'Request/response messages between participants.',
    editorExampleId: 'sequence-basic',
    editorGlyph: 'Q',
    config: {
      section: 'sequence',
      keys: [
        'actorMargin',
        'width',
        'height',
        'diagramMarginX',
        'diagramMarginY',
        'messageMargin',
        'noteMargin',
        'activationWidth',
        'showSequenceNumbers',
        'boxMargin',
        'boxTextMargin',
        'messageAlign',
        'mirrorActors',
        'bottomMarginAdj',
        'rightAngles',
        'wrap',
        'wrapPadding',
        'labelBoxWidth',
        'labelBoxHeight',
        'hideUnusedParticipants',
        'forceMenus',
        'arrowMarkerAbsolute',
        'noteAlign',
        'actorFontSize',
        'actorFontFamily',
        'actorFontWeight',
        'noteFontSize',
        'noteFontFamily',
        'noteFontWeight',
        'messageFontSize',
        'messageFontFamily',
        'messageFontWeight',
        'actorFont',
        'noteFont',
        'messageFont',
        'useMaxWidth',
        'useWidth',
        'look',
        'theme',
      ],
      noopKeys: [
        'actorFont',
        'actorFontFamily',
        'actorFontSize',
        'actorFontWeight',
        'arrowMarkerAbsolute',
        'bottomMarginAdj',
        'boxMargin',
        'boxTextMargin',
        'forceMenus',
        'hideUnusedParticipants',
        'labelBoxHeight',
        'labelBoxWidth',
        'look',
        'messageAlign',
        'messageFont',
        'messageFontFamily',
        'messageFontSize',
        'messageFontWeight',
        'mirrorActors',
        'noteAlign',
        'noteFont',
        'noteFontFamily',
        'noteFontSize',
        'noteFontWeight',
        'rightAngles',
        'theme',
        'useMaxWidth',
        'useWidth',
        'wrapPadding',
      ],
    },
    semanticChannels: ['category'],
    detect: familyDetection.detectsSequenceFamily,
    detectLoose: familyDetection.detectsSequenceFamilyLoose,
    sceneRoles: SEQUENCE_SCENE_ROLES,
    example: 'sequenceDiagram\n  participant U as User\n  participant S as Server\n  U->>S: request\n  S-->>U: response',
    editorExample: `sequenceDiagram
  participant User
  participant App
  participant API
  User->>App: Click export
  App->>API: Render SVG
  API-->>App: SVG string
  App-->>User: Download`,
  },
  {
    id: 'timeline',
    upstreamId: 'timeline',
    maturity: 'experimental',
    label: 'Timeline',
    headers: ['timeline'],
    narrower: 'asTimeline',
    editorDiagramType: 'Timeline',
    editorLabel: 'Timeline',
    editorDescription: 'Chronological milestones with sections.',
    editorExampleId: 'timeline-basic',
    editorGlyph: 'T',
    config: {
      section: 'timeline',
      keys: [
        'disableMulticolor',
        'sectionFills',
        'sectionColours',
        'diagramMarginX',
        'diagramMarginY',
        'leftMargin',
        'width',
        'height',
        'padding',
        'boxMargin',
        'boxTextMargin',
        'noteMargin',
        'messageMargin',
        'messageAlign',
        'bottomMarginAdj',
        'rightAngles',
        'taskFontSize',
        'taskFontFamily',
        'taskMargin',
        'activationWidth',
        'textPlacement',
        'actorColours',
        'useMaxWidth',
        'useWidth',
      ],
      noopKeys: [
        'diagramMarginX',
        'diagramMarginY',
        'leftMargin',
        'width',
        'height',
        'padding',
        'boxMargin',
        'boxTextMargin',
        'noteMargin',
        'messageMargin',
        'messageAlign',
        'bottomMarginAdj',
        'rightAngles',
        'taskFontSize',
        'taskFontFamily',
        'taskMargin',
        'activationWidth',
        'textPlacement',
        'actorColours',
        'useMaxWidth',
        'useWidth',
      ],
    },
    semanticChannels: ['category'],
    detect: familyDetection.detectsTimelineFamily,
    detectLoose: familyDetection.detectsTimelineFamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('chrome', 'document'),
      nativeSceneRole('rail', 'shape'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('section', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('period', 'container', 'shape'),
      nativeSceneRole('event', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'timeline\n  title Roadmap\n  2025 : Alpha : Beta\n  2026 : GA',
    editorExample: `timeline
  title Product roadmap
  section Foundation
  2024 Q1 : Prototype
          : Parser coverage
  section Launch
  2024 Q2 : Public editor
          : SVG export`,
  },
  {
    id: 'class',
    upstreamId: 'classDiagram',
    maturity: 'stable',
    label: 'Class',
    headers: ['classDiagram', 'classDiagram-v2'],
    narrower: 'asClass',
    editorDiagramType: 'Class',
    editorLabel: 'Class',
    editorDescription: 'Classes with members, inheritance, and composition.',
    editorExampleId: 'class-basic',
    editorGlyph: 'C',
    config: {
      section: 'class',
      keys: ['nodeSpacing', 'rankSpacing', 'titleTopMargin', 'arrowMarkerAbsolute', 'dividerMargin', 'padding', 'textHeight', 'defaultRenderer', 'diagramPadding', 'htmlLabels', 'hideEmptyMembersBox', 'hierarchicalNamespaces', 'look', 'theme'],
      noopKeys: ['arrowMarkerAbsolute', 'defaultRenderer', 'diagramPadding', 'dividerMargin', 'hideEmptyMembersBox', 'htmlLabels', 'look', 'padding', 'textHeight', 'theme', 'titleTopMargin'],
    },
    semanticChannels: [],
    detect: familyDetection.detectsClassFamily,
    detectLoose: familyDetection.detectsClassFamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape', 'connector'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('class-box', 'container', 'shape'),
      nativeSceneRole('member', 'text'),
      nativeSceneRole('relationship', 'connector'),
      nativeSceneRole('cardinality', 'text'),
      nativeSceneRole('note', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'classDiagram\n  class Account {\n    +id: string\n    +close() void\n  }\n  Account <|-- Savings\n  Account "1" o-- "*" Transaction : logs',
    editorExample: `classDiagram
  class Renderer {
    <<abstract>>
    +render(source) string
  }
  class SVGRenderer {
    +render(source) string
  }
  class RenderPipeline {
    +run(source) string
  }
  Renderer <|-- SVGRenderer
  RenderPipeline *-- SVGRenderer : owns`,
  },
  {
    id: 'er',
    upstreamId: 'er',
    maturity: 'stable',
    label: 'ER',
    headers: ['erDiagram'],
    narrower: 'asEr',
    editorDiagramType: 'ER',
    editorLabel: 'ER diagram',
    editorDescription: 'Entities, attributes, keys, and cardinality markers.',
    editorExampleId: 'er-basic',
    editorGlyph: 'ER',
    config: {
      section: 'er',
      keys: ['layoutDirection', 'nodeSpacing', 'rankSpacing', 'titleTopMargin', 'diagramPadding', 'minEntityWidth', 'minEntityHeight', 'entityPadding', 'stroke', 'fill', 'fontSize', 'look', 'theme'],
      noopKeys: ['diagramPadding', 'entityPadding', 'fill', 'fontSize', 'look', 'minEntityHeight', 'minEntityWidth', 'stroke', 'theme', 'titleTopMargin'],
    },
    semanticChannels: ['category'],
    detect: familyDetection.detectsErFamily,
    detectLoose: familyDetection.detectsErFamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('defs', 'document'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'shape'),
      nativeSceneRole('entity', 'container', 'shape'),
      nativeSceneRole('attribute', 'container', 'text'),
      nativeSceneRole('relationship', 'connector'),
      nativeSceneRole('cardinality', 'shape'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER {\n    string id\n  }',
    editorExample: `erDiagram
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
    id: 'journey',
    upstreamId: 'journey',
    maturity: 'stable',
    label: 'Journey',
    headers: ['journey'],
    narrower: 'asJourney',
    editorDiagramType: 'Journey',
    editorLabel: 'User journey',
    editorDescription: 'Scored user tasks grouped by section.',
    editorExampleId: 'journey-basic',
    editorGlyph: 'J',
    config: {
      section: 'journey',
      keys: [
        'diagramMarginX',
        'diagramMarginY',
        'leftMargin',
        'maxLabelWidth',
        'width',
        'height',
        'taskFontSize',
        'taskFontFamily',
        'taskMargin',
        'actorColours',
        'sectionFills',
        'sectionColours',
        'titleColor',
        'titleFontFamily',
        'titleFontSize',
        'useMaxWidth',
        'boxMargin',
        'boxTextMargin',
        'noteMargin',
        'messageMargin',
        'messageAlign',
        'bottomMarginAdj',
        'rightAngles',
        'activationWidth',
        'textPlacement',
      ],
      noopKeys: ['boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign', 'bottomMarginAdj', 'rightAngles', 'activationWidth', 'textPlacement'],
    },
    semanticChannels: ['value', 'category'],
    detect: familyDetection.detectsJourneyFamily,
    detectLoose: familyDetection.detectsJourneyFamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('series', 'connector'),
      nativeSceneRole('grid', 'container', 'connector'),
      nativeSceneRole('axis', 'text'),
      nativeSceneRole('rail', 'connector'),
      nativeSceneRole('legend', 'container', 'text'),
      nativeSceneRole('actor', 'shape'),
      nativeSceneRole('section', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('task', 'container', 'shape', 'data-mark'),
      nativeSceneRole('marker-line', 'connector'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('score', 'container', 'shape', 'data-mark'),
    ],
    example: 'journey\n  title Checkout\n  section Browse\n    Find product: 4: Shopper\n  section Buy\n    Pay: 3: Shopper',
    editorExample: `journey
  title Editor adoption
  section Try
    Open editor: 5: User
    Load example: 4: User, Developer
  section Share
    Copy URL: 5: User
    Export SVG: 4: Developer`,
  },
  {
    id: 'architecture',
    upstreamId: 'architecture',
    maturity: 'stable',
    label: 'Architecture',
    headers: ['architecture', 'architecture-beta'],
    narrower: 'asArchitecture',
    editorDiagramType: 'Architecture',
    editorLabel: 'Architecture',
    editorDescription: 'Services, groups, icons, and routed connections.',
    editorExampleId: 'architecture-basic',
    editorGlyph: 'A',
    config: { section: 'architecture', keys: ['padding', 'iconSize', 'fontSize', 'nodeSeparation', 'idealEdgeLengthMultiplier', 'edgeElasticity', 'numIter', 'seed', 'randomize'], noopKeys: ['edgeElasticity', 'numIter', 'randomize', 'seed'] },
    semanticChannels: [],
    detect: familyDetection.detectsArchitectureFamily,
    detectLoose: familyDetection.detectsArchitectureFamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'shape'),
      nativeSceneRole('icon', 'container', 'shape', 'text'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('service', 'container', 'shape'),
      nativeSceneRole('junction', 'container', 'shape'),
      nativeSceneRole('edge', 'connector'),
    ],
    example: 'architecture-beta\n  group backend(cloud)[Backend]\n  service api(server)[API] in backend\n  service db(database)[Database] in backend\n  service cache(disk)[Cache] in backend\n  api:R --> L:db\n  api:B -[reads]-> T:cache',
    editorExample: `architecture-beta
  group app(cloud)[Application]
  group data(database)[Data]
  service web(server)[Web App] in app
  service api(server)[API] in app
  service db(database)[Postgres] in data
  web:R --> L:api
  api:R --> L:db`,
  },
  {
    id: 'xychart',
    upstreamId: 'xychart',
    maturity: 'stable',
    label: 'XY chart',
    headers: ['xychart', 'xychart-beta'],
    narrower: 'asXyChart',
    editorDiagramType: 'XY Chart',
    editorLabel: 'XY chart',
    editorDescription: 'Bar and line series using xychart syntax.',
    editorExampleId: 'xychart-basic',
    editorGlyph: 'XY',
    config: { section: 'xyChart', keys: ['width', 'height', 'useMaxWidth', 'useWidth', 'titleFontSize', 'titlePadding', 'chartOrientation', 'plotReservedSpacePercent', 'showDataLabel', 'showDataLabelOutsideBar', 'showTitle', 'showLegend', 'legendFontSize', 'legendPadding', 'xAxis', 'yAxis'] },
    semanticChannels: ['value', 'category'],
    detect: familyDetection.detectsXychartFamily,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document'),
      nativeSceneRole('chrome', 'container', 'document', 'shape'),
      nativeSceneRole('grid', 'shape'),
      nativeSceneRole('bar', 'shape', 'data-mark'),
      nativeSceneRole('series', 'connector'),
      nativeSceneRole('point', 'shape', 'data-mark'),
      nativeSceneRole('axis', 'text', 'shape'),
      nativeSceneRole('legend', 'container', 'text', 'shape'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'xychart-beta\n  title "Revenue"\n  x-axis [Q1, Q2, Q3]\n  y-axis "USD" 0 --> 100\n  bar [45, 62, 80]',
    editorExample: `xychart
  title "Weekly renders"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Renders" 0 --> 100
  bar [25, 42, 58, 74, 88]
  line [18, 35, 52, 70, 95]`,
  },
  {
    id: 'pie',
    upstreamId: 'pie',
    maturity: 'stable',
    label: 'Pie',
    headers: ['pie'],
    narrower: 'asPie',
    editorDiagramType: 'Pie',
    editorLabel: 'Pie chart',
    editorDescription: 'Proportional slices with values shown in the legend.',
    editorExampleId: 'pie-basic',
    editorGlyph: 'P',
    config: { section: 'pie', keys: ['textPosition', 'donutHole', 'legendPosition', 'highlightSlice', 'useMaxWidth', 'useWidth'], noopKeys: ['useMaxWidth', 'useWidth'] },
    semanticChannels: ['value', 'category', 'emphasis'],
    detect: familyDetection.detectsPieFamily,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document', 'shape', 'container'), nativeSceneRole('pie-slice', 'shape', 'data-mark'), nativeSceneRole('legend', 'text', 'shape', 'data-mark'), nativeSceneRole('title', 'text'), nativeSceneRole('label', 'text')],
    example: 'pie title Plans\n  "Free" : 60\n  "Pro" : 30\n  "Enterprise" : 10',
    editorExample: `pie showData
  title Export requests by format
  "SVG" : 42
  "PNG" : 28
  "ASCII" : 18
  "Unicode" : 12`,
  },
  {
    id: 'quadrant',
    upstreamId: 'quadrantChart',
    maturity: 'stable',
    label: 'Quadrant',
    headers: ['quadrantChart'],
    narrower: 'asQuadrant',
    editorDiagramType: 'Quadrant',
    editorLabel: 'Quadrant chart',
    editorDescription: 'Two-axis priority map with labeled regions and points.',
    editorExampleId: 'quadrant-basic',
    editorGlyph: '4Q',
    config: {
      section: 'quadrantChart',
      keys: [
        'chartWidth',
        'chartHeight',
        'titleFontSize',
        'titlePadding',
        'quadrantPadding',
        'quadrantLabelFontSize',
        'xAxisLabelFontSize',
        'yAxisLabelFontSize',
        'xAxisLabelPadding',
        'yAxisLabelPadding',
        'pointLabelFontSize',
        'pointRadius',
        'pointTextPadding',
        'quadrantInternalBorderStrokeWidth',
        'quadrantExternalBorderStrokeWidth',
        'useMaxWidth',
        'quadrantTextTopPadding',
        'xAxisPosition',
        'yAxisPosition',
        'useWidth',
      ],
      noopKeys: ['quadrantTextTopPadding', 'xAxisPosition', 'yAxisPosition', 'useWidth'],
    },
    aliases: ['quadrant'],
    semanticChannels: ['category'],
    detect: familyDetection.detectsQuadrantFamily,
    detectLoose: familyDetection.detectsQuadrantFamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('chrome', 'document', 'shape', 'container'),
      nativeSceneRole('plate', 'shape'),
      nativeSceneRole('grid', 'shape'),
      nativeSceneRole('point', 'shape'),
      nativeSceneRole('axis', 'text'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'quadrantChart\n  title Prioritize\n  x-axis Low Effort --> High Effort\n  y-axis Low Value --> High Value\n  Quick win: [0.2, 0.8]\n  Money pit: [0.8, 0.2]',
    editorExample: `quadrantChart
  title Feature priorities
  x-axis Low impact --> High impact
  y-axis Low effort --> High effort
  quadrant-1 Plan carefully
  quadrant-2 Big bets
  quadrant-3 Defer
  quadrant-4 Quick wins
  SVG export: [0.78, 0.28]
  MCP setup: [0.62, 0.72]
  Palette polish: [0.35, 0.24]`,
  },
  {
    id: 'gantt',
    upstreamId: 'gantt',
    maturity: 'stable',
    label: 'Gantt',
    headers: ['gantt'],
    narrower: 'asGantt',
    editorDiagramType: 'Gantt',
    editorLabel: 'Gantt chart',
    editorDescription: 'Sections, dependencies, status tags, and a milestone.',
    editorExampleId: 'gantt-basic',
    editorGlyph: 'G',
    config: {
      section: 'gantt',
      keys: ['displayMode', 'barHeight', 'topAxis', 'tickInterval', 'axisFormat', 'barGap', 'topPadding', 'leftPadding', 'gridLineStartPadding', 'fontSize', 'sectionFontSize', 'numberSectionStyles', 'todayMarker', 'weekday', 'rightPadding', 'titleTopMargin'],
      noopKeys: ['barGap', 'topPadding', 'leftPadding', 'rightPadding', 'titleTopMargin', 'gridLineStartPadding', 'fontSize', 'sectionFontSize', 'numberSectionStyles', 'todayMarker', 'weekday'],
    },
    semanticChannels: ['status', 'progress', 'emphasis', 'category'],
    detect: familyDetection.detectsGanttFamily,
    detectLoose: familyDetection.detectsGanttFamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'container'),
      nativeSceneRole('section', 'text', 'shape'),
      nativeSceneRole('grid', 'shape'),
      nativeSceneRole('axis', 'text'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('task', 'shape'),
      nativeSceneRole('milestone', 'shape'),
      nativeSceneRole('edge', 'connector'),
      nativeSceneRole('marker-line', 'shape'),
      nativeSceneRole('title', 'text'),
    ],
    example: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Implement :a1, 2026-01-05, 5d\n  Review :after a1, 2d',
    editorExample: `gantt
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
    id: 'mindmap',
    upstreamId: 'mindmap',
    maturity: 'stable',
    label: 'Mindmap',
    headers: ['mindmap'],
    narrower: 'asMindmap',
    editorDiagramType: 'Mindmap',
    editorLabel: 'Mindmap',
    editorDescription: 'A centered, bilateral hierarchy with shapes, Markdown, Unicode, accessibility, and deep quality branches.',
    editorExampleId: 'mindmap-basic',
    editorGlyph: 'M',
    config: { section: 'mindmap', keys: ['padding', 'maxNodeWidth', 'layoutAlgorithm', 'colorBy'], noopKeys: ['colorBy', 'layoutAlgorithm'] },
    semanticChannels: ['importance', 'category'],
    detect: familyDetection.detectsMindmapFamily,
    detectLoose: familyDetection.detectsMindmapFamilyLoose,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('title', 'text'), nativeSceneRole('chrome', 'document', 'shape'), nativeSceneRole('edge', 'connector'), nativeSceneRole('node', 'container'), nativeSceneRole('icon', 'container', 'shape', 'text'), nativeSceneRole('label', 'text')],
    example: 'mindmap\n  root((Product))\n    Research\n      Interviews\n      Evidence\n    Delivery\n      Launch',
    editorExample: `mindmap
  root((Agent-native release))
    discovery[Discovery]
      ::icon(fa fa-book)
      :::urgent large
      evidence["\`**Evidence** across
interviews, benchmarks, and Unicode naïve café\`"]
      constraints{{Constraints}}
        Security
        Determinism
    delivery(Delivery)
      beta))Beta signal((
      launch)Launch cloud(
      quality[Quality gates]
        Parser round-trip
        SVG identity
        Terminal width
    Ecosystem
      Mermaid parity
      Terminal tools`,
  },
  {
    id: 'gitgraph',
    upstreamId: 'gitGraph',
    maturity: 'stable',
    label: 'GitGraph',
    headers: ['gitGraph'],
    narrower: 'asGitGraph',
    editorDiagramType: 'GitGraph',
    editorLabel: 'GitGraph',
    editorDescription: 'Ordered branches, commit types, tags, a semantic merge, and a merge-parent backport.',
    editorExampleId: 'gitgraph-basic',
    editorGlyph: 'Git',
    config: { section: 'gitGraph', keys: ['showBranches', 'showCommitLabel', 'mainBranchName', 'mainBranchOrder', 'parallelCommits', 'rotateCommitLabel', 'arrowMarkerAbsolute', 'diagramPadding', 'nodeLabel', 'titleTopMargin'], noopKeys: ['arrowMarkerAbsolute', 'diagramPadding', 'nodeLabel', 'titleTopMargin'] },
    semanticChannels: ['status', 'category'],
    detect: familyDetection.detectsGitgraphFamily,
    detectLoose: familyDetection.detectsGitgraphFamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('group', 'container'),
      nativeSceneRole('rail', 'shape'),
      nativeSceneRole('edge', 'connector'),
      nativeSceneRole('node', 'container'),
      nativeSceneRole('label', 'text'),
    ],
    example: 'gitGraph\n  commit id:"base"\n  branch feature\n  commit id:"work"\n  checkout main\n  commit id:"release"\n  merge feature id:"merge"',
    editorExample: `---
title: Release train with backport
config:
  gitGraph:
    mainBranchName: main
    mainBranchOrder: 0
    showBranches: true
    showCommitLabel: true
    rotateCommitLabel: true
---
gitGraph LR:
  accTitle: Release history with feature merge and backport
  accDescr: Develop and release branches diverge, main merges develop, and release cherry-picks the merge
  commit id:"ROOT" tag:"v1.0.0" msg:"Foundation"
  branch develop order:2
  commit id:"API" type:HIGHLIGHT tag:"beta" msg:"Build API"
  branch release order:3
  commit id:"RC" type:REVERSE tag:"rc.1" msg:"Cut release candidate"
  checkout develop
  commit id:"UI" msg:"Finish interface"
  checkout main
  commit id:"HOTFIX" type:REVERSE msg:"Patch production"
  merge develop id:"MERGE" tag:"v2.0.0" type:HIGHLIGHT
  checkout release
  cherry-pick id:"MERGE" parent:"UI" tag:"backport"
  commit id:"PATCH" msg:"Verify release"`,
  },
  {
    id: 'radar',
    upstreamId: 'radar',
    maturity: 'experimental',
    label: 'Radar',
    headers: ['radar-beta'],
    narrower: 'asRadar',
    editorDiagramType: 'Radar',
    editorLabel: 'Radar chart',
    editorDescription: 'Multivariate profiles compared across shared axes — the silhouette is the message.',
    editorExampleId: 'radar-basic',
    editorGlyph: 'R',
    config: { section: 'radar', keys: ['width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'axisScaleFactor', 'axisLabelFactor', 'curveTension', 'useMaxWidth', 'tickLabels', 'useWidth'], noopKeys: ['useWidth'] },
    semanticChannels: ['category'],
    detect: familyDetection.detectsRadarFamily,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document'), nativeSceneRole('grid', 'shape'), nativeSceneRole('pie-slice', 'shape'), nativeSceneRole('point', 'shape'), nativeSceneRole('axis', 'text'), nativeSceneRole('legend', 'shape', 'text'), nativeSceneRole('title', 'text')],
    example: 'radar-beta\n  title Skills\n  axis speed["Speed"], power["Power"], range["Range"]\n  curve now["Current"]{4, 3, 5}\n  curve goal["Target"]{5, 5, 4}\n  max 5',
    editorExample: `radar-beta
  title Model comparison
  axis speed["Speed"], accuracy["Accuracy"], cost["Cost"]
  axis latency["Latency"], context["Context"], safety["Safety"]
  curve a["Model A"]{4, 5, 3, 4, 4, 5}
  curve b["Model B"]{5, 3, 4, 3, 5, 3}
  graticule polygon
  max 5`,
  },
  {
    id: 'sankey',
    upstreamId: 'sankey',
    maturity: 'experimental',
    label: 'Sankey',
    headers: ['sankey', 'sankey-beta'],
    narrower: 'asSankey',
    editorDiagramType: 'Sankey',
    editorLabel: 'Sankey diagram',
    editorDescription: 'Conserved flows between layered stages — ribbon width is the quantity.',
    editorExampleId: 'sankey-basic',
    editorGlyph: 'SK',
    config: { section: 'sankey', keys: ['width', 'height', 'linkColor', 'nodeAlignment', 'showValues', 'prefix', 'suffix', 'labelStyle', 'nodeWidth', 'nodePadding', 'nodeColors', 'useMaxWidth'], noopKeys: ['useMaxWidth'] },
    semanticChannels: ['value', 'category'],
    detect: familyDetection.detectsSankeyFamily,
    detectLoose: familyDetection.detectsSankeyFamilyLoose,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document'), nativeSceneRole('defs', 'document'), nativeSceneRole('edge', 'connector'), nativeSceneRole('bar', 'shape', 'data-mark'), nativeSceneRole('label', 'text'), nativeSceneRole('title', 'text')],
    // Balanced by construction (Electricity grid: in 127.93 = out 71.24 + 56.69):
    // the example agents copy must clear the FLOW_IMBALANCE conservation lint.
    example: 'sankey-beta\n  Coal,Electricity grid,127.93\n  Electricity grid,Industry,71.24\n  Electricity grid,Losses,56.69',
    editorExample: `sankey-beta
  Coal,Electricity,60
  Gas,Electricity,80
  Solar,Electricity,40
  Electricity,Homes,120
  Electricity,Industry,60`,
  },
  {
    id: 'c4',
    upstreamId: 'c4',
    maturity: 'experimental',
    label: 'C4',
    headers: ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'],
    narrower: 'asC4',
    editorDiagramType: 'C4',
    editorLabel: 'C4 architecture',
    editorDescription: 'People, software systems, containers and components within nested architecture boundaries.',
    editorExampleId: 'c4-basic',
    editorGlyph: 'C4',
    config: { section: 'c4', keys: [...C4_CONFIG_KEYS, ...C4_NOOP_CONFIG_KEYS], noopKeys: C4_NOOP_CONFIG_KEYS },
    semanticChannels: ['category', 'status'],
    detect: familyDetection.detectsC4Family,
    detectLoose: familyDetection.detectsC4FamilyLoose,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'),
      nativeSceneRole('title', 'text'),
      nativeSceneRole('defs', 'document', 'marker'),
      nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('group', 'container', 'shape'),
      nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('edge', 'connector'),
      nativeSceneRole('edge-label', 'container'),
      nativeSceneRole('node', 'container', 'shape'),
      nativeSceneRole('label', 'text'),
      nativeSceneRole('legend', 'container', 'shape', 'text'),
    ],
    example: 'C4Context\n  Person(user, "Customer")\n  System(api, "API", "Serves requests")\n  Rel(user, api, "Uses", "HTTPS")',
    editorExample: `C4Container
  title Internet banking
  Person(customer, "Customer", "Checks balances and makes payments")
  System_Boundary(bank, "Internet banking") {
    Container(web, "Web application", "TypeScript", "Customer portal")
    Container(api, "API", "Node.js", "Accounts and payments")
    ContainerDb(db, "Accounts", "PostgreSQL", "Balances and transactions")
  }
  Rel(customer, web, "Uses", "HTTPS")
  Rel(web, api, "Calls", "JSON/HTTPS")
  Rel(api, db, "Reads and writes", "SQL")`,
  },
  ...STABLE_FAMILY_DESCRIPTOR_SEEDS,
  {
    id: 'zenuml', upstreamId: 'zenuml', maturity: 'experimental',
    label: 'ZenUML', headers: ['zenuml'], narrower: 'asZenUML',
    editorDiagramType: 'ZenUML', editorLabel: 'ZenUML interactions',
    editorDescription: 'Nested calls, replies and control scopes with checked native edits.',
    editorExampleId: 'zenuml-checkout', editorGlyph: 'ZU',
    config: { section: 'zenuml', keys: [], noopKeys: [] },
    semanticChannels: ['category'],
    sceneRoles: SEQUENCE_SCENE_ROLES.filter(cell => cell.role !== 'group').map(cell => ({
      role: cell.role,
      primitives: cell.primitives.filter(primitive => !(cell.role === 'chrome' && primitive === 'shape') && !(cell.role === 'icon' && primitive === 'text')),
    })),
    detect: familyDetection.detectsZenumlFamily,
    example: 'zenuml\nAlice->Bob: Hello\nBob->Alice: Reply',
    editorExample: 'zenuml\ntitle Checkout\nBuyer as Customer\nAPI\nStore\nBuyer->API.placeOrder() {\n  Store.reserve()\n  if (inStock) {\n    return confirmation\n  } else {\n    return unavailable\n  }\n}\nAPI->Buyer: accepted',
  },
  {
    id: 'railroad', upstreamId: 'railroad', maturity: 'beta', label: 'Railroad',
    headers: ['railroad-beta', 'railroad-ebnf-beta', 'railroad-abnf-beta', 'railroad-peg-beta'], narrower: 'asRailroad',
    editorDiagramType: 'Railroad', editorLabel: 'Railroad grammars',
    editorDescription: 'Grammar sequences, choices, optional branches, repetition tracks and lookahead.', editorExampleId: 'railroad-basic', editorGlyph: 'RR',
    config: { section: 'railroad', keys: ['arcRadius', 'commentFill', 'commentStroke', 'commentTextColor', 'compactMode', 'fontFamily', 'fontSize', 'horizontalSeparation', 'lineColor', 'markerFill', 'markerRadius', 'nonTerminalFill', 'nonTerminalStroke', 'nonTerminalTextColor', 'padding', 'ruleNameColor', 'showMarkers', 'specialFill', 'specialStroke', 'strokeWidth', 'terminalFill', 'terminalStroke', 'terminalTextColor', 'verticalSeparation'], noopKeys: ['arcRadius', 'commentFill', 'commentStroke', 'commentTextColor', 'compactMode', 'fontFamily', 'fontSize', 'horizontalSeparation', 'lineColor', 'markerFill', 'markerRadius', 'nonTerminalFill', 'nonTerminalStroke', 'nonTerminalTextColor', 'padding', 'ruleNameColor', 'showMarkers', 'specialFill', 'specialStroke', 'strokeWidth', 'terminalFill', 'terminalStroke', 'terminalTextColor', 'verticalSeparation'] }, semanticChannels: [], detect: familyDetection.detectsRailroadFamily,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document'), nativeSceneRole('title', 'text'), nativeSceneRole('group', 'container', 'shape'), nativeSceneRole('node', 'shape'), nativeSceneRole('label', 'text')],
    example: 'railroad-beta\nentry = sequence(terminal("start"), optional(nonterminal("item")));',
    editorExample: 'railroad-ebnf-beta\nentry = "start", [item], {",", item};\nitem = "word" | "number";',
  },
  {
    id: 'cynefin', upstreamId: 'cynefin', maturity: 'beta', label: 'Cynefin',
    headers: ['cynefin-beta'], narrower: 'asCynefin', editorDiagramType: 'Cynefin',
    editorLabel: 'Cynefin domains', editorDescription: 'Decision domains, retained items and directed domain transitions.',
    editorExampleId: 'cynefin-basic', editorGlyph: 'CY', config: { section: 'cynefin', keys: ['boundaryAmplitude', 'height', 'padding', 'seed', 'showDomainDescriptions', 'width'], noopKeys: ['boundaryAmplitude', 'height', 'padding', 'seed', 'showDomainDescriptions', 'width'] },
    semanticChannels: [], detect: familyDetection.detectsCynefinFamily,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document'), nativeSceneRole('title', 'text'), nativeSceneRole('defs', 'document', 'marker'), nativeSceneRole('group', 'shape'), nativeSceneRole('node', 'container'), nativeSceneRole('label', 'text'), nativeSceneRole('edge', 'connector')],
    example: 'cynefin-beta\ncomplex\n  "Explore"\nclear\n  "Operate"\ncomplex --> clear: "Learn"',
    editorExample: 'cynefin-beta\ncomplex\n  "Explore"\ncomplicated\n  "Analyse"\nclear\n  "Operate"\nchaotic\n  "Stabilise"\nconfusion\n  "Investigate"\ncomplex --> clear: "Learn"',
  },
  {
    id: 'agentflow', upstreamId: 'agentflow', maturity: 'beta', label: 'AgentFlow',
    headers: ['agentflow-beta'], narrower: 'asAgentflow',
    editorDiagramType: 'AgentFlow', editorLabel: 'Agent workflows',
    editorDescription: 'Agent roles, tool metadata, attachments and directed workflow connections.', editorExampleId: 'agentflow-basic', editorGlyph: 'AF',
    config: { section: 'agentflow', keys: ['diagramPadding', 'look', 'minNodeWidth', 'nodeSpacing', 'rankSpacing', 'theme', 'titleTopMargin', 'wrappingWidth'], noopKeys: ['diagramPadding', 'look', 'minNodeWidth', 'nodeSpacing', 'rankSpacing', 'theme', 'titleTopMargin', 'wrappingWidth'] },
    semanticChannels: [], detect: familyDetection.detectsAgentflowFamily,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document', 'shape'), nativeSceneRole('title', 'text'), nativeSceneRole('node', 'container', 'shape'), nativeSceneRole('label', 'text'), nativeSceneRole('defs', 'document', 'marker'), nativeSceneRole('edge', 'connector'), nativeSceneRole('group', 'container', 'shape'), nativeSceneRole('group-header', 'text', 'shape'), nativeSceneRole('edge-label', 'container')],
    example: 'agentflow-beta\n A[Plan]@{ shape: task }\n B[Search]@{ shape: tool }\n A --> B', editorExample: 'agentflow-beta\n A[Plan]@{ shape: task }\n B[Search]@{ shape: tool }\n A --> B',
  },
  {
    id: 'usecase', upstreamId: 'usecase', maturity: 'beta', label: 'UseCase',
    headers: ['usecase-beta'], narrower: 'asUsecase',
    editorDiagramType: 'UseCase', editorLabel: 'Use cases',
    editorDescription: 'Actors and use cases inside system boundaries with typed relationships.', editorExampleId: 'usecase-basic', editorGlyph: 'UC',
    config: { section: 'usecase', keys: ['actorFontFamily', 'actorFontSize', 'actorFontWeight', 'colorScheme', 'diagramPadding', 'look', 'minNodeWidth', 'nodeSpacing', 'rankSpacing', 'theme', 'usecaseFontFamily', 'usecaseFontSize', 'usecaseFontWeight', 'wrappingWidth'], noopKeys: ['actorFontFamily', 'actorFontSize', 'actorFontWeight', 'colorScheme', 'diagramPadding', 'look', 'minNodeWidth', 'nodeSpacing', 'rankSpacing', 'theme', 'usecaseFontFamily', 'usecaseFontSize', 'usecaseFontWeight', 'wrappingWidth'] },
    semanticChannels: ['category', 'emphasis'], detect: familyDetection.detectsUsecaseFamily,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document', 'shape'), nativeSceneRole('title', 'text'), nativeSceneRole('node', 'container', 'shape'), nativeSceneRole('label', 'text'), nativeSceneRole('defs', 'document', 'marker'), nativeSceneRole('edge', 'connector'), nativeSceneRole('group', 'container', 'shape')],
    example: 'usecase-beta\nactor Customer\nCheckout("Checkout")\nCustomer --> Checkout', editorExample: 'usecase-beta\nactor Customer\nCheckout("Checkout")\nCustomer --> Checkout',
  },
  {
    id: 'wardley', upstreamId: 'wardley', maturity: 'beta', label: 'Wardley',
    headers: ['wardley-beta'], narrower: 'asWardley',
    editorDiagramType: 'Wardley', editorLabel: 'Wardley map',
    editorDescription: 'Authored evolution and visibility coordinates, dependencies and pipelines.', editorExampleId: 'wardley-basic', editorGlyph: 'WM',
    config: { section: 'wardley', keys: [], noopKeys: [] },
    semanticChannels: [], detect: familyDetection.detectsWardleyFamily,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document'), nativeSceneRole('title', 'text'), nativeSceneRole('node', 'container', 'shape'), nativeSceneRole('label', 'text'), nativeSceneRole('defs', 'document', 'marker'), nativeSceneRole('edge', 'connector'), nativeSceneRole('group', 'shape'), nativeSceneRole('rail', 'connector')],
    example: 'wardley-beta\ncomponent API [0.8, 0.3]\ncomponent Database [0.3, 0.8]\nAPI -> Database', editorExample: 'wardley-beta\ncomponent API [0.8, 0.3]\ncomponent Database [0.3, 0.8]\nAPI -> Database',
  },
  {
    id: 'venn', upstreamId: 'venn', maturity: 'beta', label: 'Venn',
    headers: ['venn-beta'], narrower: 'asVenn',
    editorDiagramType: 'Venn', editorLabel: 'Venn intersections',
    editorDescription: 'Sets, intersections, exact values and region-owned text.', editorExampleId: 'venn-basic', editorGlyph: 'VN',
    config: { section: 'venn', keys: ['height', 'look', 'padding', 'theme', 'useDebugLayout', 'width'], noopKeys: ['height', 'look', 'padding', 'theme', 'useDebugLayout', 'width'] },
    semanticChannels: ['category'], detect: familyDetection.detectsVennFamily,
    sceneRoles: [nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document'), nativeSceneRole('title', 'text'), nativeSceneRole('node', 'container', 'shape'), nativeSceneRole('label', 'text')],
    example: 'venn-beta\nset A["Frontend"]:20\nset B["Backend"]:12\nunion A,B["Shared"]:3', editorExample: 'venn-beta\nset A["Frontend"]:20\nset B["Backend"]:12\nunion A,B["Shared"]:3',
  },
  {
    id: 'swimlane', upstreamId: 'swimlane', maturity: 'beta', label: 'Swimlane',
    headers: ['swimlane-beta'], narrower: 'asSwimlane',
    editorDiagramType: 'Swimlane', editorLabel: 'Swimlane workflow',
    editorDescription: 'Responsibility lanes with source-ordered tasks and directed connections.',
    editorExampleId: 'swimlane-workflow', editorGlyph: 'SL',
    config: { section: 'swimlane', keys: ['automaticLaneOrdering', 'ignoreCrossLaneEdges', 'layout', 'lineHops', 'look', 'optimizeRanksByCrossings', 'theme'], noopKeys: ['automaticLaneOrdering', 'ignoreCrossLaneEdges', 'layout', 'lineHops', 'look', 'optimizeRanksByCrossings', 'theme'] },
    semanticChannels: [], detect: familyDetection.detectsSwimlaneFamily,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'), nativeSceneRole('title', 'text'),
      nativeSceneRole('defs', 'document', 'marker'), nativeSceneRole('chrome', 'document', 'shape'),
      nativeSceneRole('group', 'container', 'shape'), nativeSceneRole('group-header', 'text', 'shape'),
      nativeSceneRole('edge', 'connector'), nativeSceneRole('edge-label', 'container'),
      nativeSceneRole('node', 'container', 'shape'), nativeSceneRole('label', 'text'),
      nativeSceneRole('icon', 'container', 'shape', 'text'),
    ],
    example: 'swimlane-beta LR\n  subgraph customer[Customer]\n    request[Place order]\n  end\n  subgraph team[Team]\n    fulfill[Fulfil order]\n  end\n  request --> fulfill',
    editorExample: 'swimlane-beta LR\n  subgraph customer[Customer]\n    request[Place order]\n    receive[Receive order]\n  end\n  subgraph team[Team]\n    check{In stock?}\n    fulfill[Fulfil order]\n  end\n  request --> check\n  check -->|Yes| fulfill\n  fulfill --> receive',
  },
  {
    id: 'treeview', upstreamId: 'treeView', maturity: 'beta', label: 'TreeView',
    headers: ['treeView-beta'], narrower: 'asTreeview',
    editorDiagramType: 'TreeView', editorLabel: 'File tree',
    editorDescription: 'Ordered folders and files with descriptions and hierarchy guides.',
    editorExampleId: 'treeview-project', editorGlyph: 'TV',
    config: { section: 'treeView', keys: ['defaultIconPack', 'extensionIcons', 'filenameIcons', 'lineThickness', 'paddingX', 'paddingY', 'rowIndent', 'showIcons'], noopKeys: ['defaultIconPack', 'extensionIcons', 'filenameIcons', 'lineThickness', 'paddingX'] },
    semanticChannels: [], detect: familyDetection.detectsTreeviewFamily,
    sceneRoles: [
      nativeSceneRole('prelude', 'document'), nativeSceneRole('chrome', 'document'),       nativeSceneRole('title', 'text'), nativeSceneRole('node', 'container', 'shape'),
      nativeSceneRole('label', 'text'), nativeSceneRole('edge', 'connector'), nativeSceneRole('icon', 'shape', 'text'),
    ],
    example: 'treeView-beta\n  "src/"\n    "index.ts"\n    "parser.ts"',
    editorExample: 'treeView-beta\n  "project/"\n    "src/"\n      "index.ts"\n      "parser.ts"\n    "tests/"\n      "parser.test.ts"\n    "README.md"',
  },
] as const satisfies readonly BuiltinFamilyDescriptorSeed[]

export type BuiltinFamilyId = (typeof BUILTIN_FAMILY_DESCRIPTOR_SEEDS)[number]['id']
