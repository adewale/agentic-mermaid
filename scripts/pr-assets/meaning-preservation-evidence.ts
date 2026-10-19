// Same-input production renders at immutable revisions, for PR review only.
// bun run scripts/pr-assets/meaning-preservation-evidence.ts BASE_SHA HEAD_SHA OUT_DIR [FIXTURE_ID...]
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { denseDag } from '../../eval/degenerate-etn/generators.ts'
import { collectSamples } from '../../eval/layout-compare/run.ts'
import { extractOfficialCorpus } from '../../eval/shared/official-fences.ts'
import { contactSheetScenarios } from '../../eval/visual-rubric/scenarios.ts'
import { getFamily, knownBuiltinFamilies } from '../../src/agent/families.ts'
import type { AnyMutationOp, ClassMutationOp } from '../../src/agent/types.ts'
import type { RenderOptions } from '../../src/types.ts'

const ROOT = resolve(import.meta.dir, '../..')
const [base, head, destination, ...selectedFixtureIds] = process.argv.slice(2)
if (!base || !head || !destination || ![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha))) {
  throw new Error('Expected BASE_SHA HEAD_SHA OUT_DIR [FIXTURE_ID...], with full commit SHAs')
}
const out = resolve(destination)
mkdirSync(out, { recursive: true })
interface Fixture {
  id: string
  title: string
  source: string
  cue: string
  renderOptions?: RenderOptions
  pngWidth?: number
  pngScale?: number
  measurementProfile?: 'nonadditive-tracking'
  captureLayout?: true
  classMutation?: ClassMutationOp
  mutation?: AnyMutationOp
  directFragmentLabel?: string
}
const measurementProfiles = {
  'nonadditive-tracking': { id: 'pr422:nonadditive-tracking', version: '1.0.0', wholeStringWidth: 2, glyphWidth: 18, boldGlyphWidth: 27 },
} as const
const sequenceSpanSource = 'sequenceDiagram\nparticipant A\nparticipant B\nparticipant C\nA->>C: Label across B\nactivate B\nA->>C: Begin work\nA->>C: Label across active B\ndeactivate B'
const sankeyIdentitySource = '---\ntitle: Caption\n---\nsankey-beta\nA,B,1\nA,B,2\nA,B#1,3\nlink:A->B#1,X,4\ntitle,title#1,5'
const parallelReciprocalSource = 'flowchart LR\nA[Client] -->|request 0| B[Server]\nA -->|request 1| B\nB -->|reply| A'
const whitespaceIdentitySource = 'sankey-beta\n"A\nB",X,1\n"A B",Y,2\n"A\tB",Z,3\n"A\rB",CR,4\n"A\tB",Z,5\n"link:A\tB->Z",Other,6\n"A\n\nB",Blank,7'
const fiveLineTitle = ['First authored title line', 'Second authored title line', 'Third authored title line', 'Fourth authored title line', 'Fifth authored title line'].join('\n')
const withTitle = (source: string): string => `---\ntitle: ${JSON.stringify(fiveLineTitle)}\n---\n${source}`
const trackedRoles: RenderOptions = {
  style: {
    roles: {
      node: { fontSize: 20, fontWeight: 800, letterSpacing: 2, textTransform: 'capitalize' },
      edge: { fontSize: 20, fontWeight: 800, letterSpacing: 2, textTransform: 'capitalize' },
      group: { fontSize: 22, fontWeight: 800, letterSpacing: 2, textTransform: 'capitalize' },
    },
  },
}
const literalLabel = '<b>This is a very long label that describes the work in detail</b>'
const sequenceEntitySource = 'sequenceDiagram\nparticipant A as #lt;b#gt;code#lt;/b#gt; and *styled*\nparticipant B as Receiver\nA->>B: #lt;i#gt;literal#lt;/i#gt; and **bold**\nB-->>A: #42;stars#42; and *italic*'
const c4AncestorSource = 'C4Deployment\nNode(parent,"Parent","Cloud") {\nContainer(child,"Child","JS")\n}\nRel(child,parent,"Reports up")'
const c4OutlineSource = 'C4Context\nSystem_Boundary(app,"Application") {\nSystem(a,"Card")\n}'
const architectureOutlineSource = 'architecture-beta\ngroup app(cloud)[Application]\nservice api(server)[Public API] in app\nservice db(database)[Primary DB]\napi:R --> L:db'
const c4DenseSource =
  'C4Container\nSystem_Boundary(app,"Application") {\n' +
  Array.from({ length: 7 }, (_, index) => `Container(n${index},"Service ${index}","HTTP")`).join('\n') +
  '\n}\n' +
  Array.from({ length: 7 }, (_, from) => Array.from({ length: 6 - from }, (_, offset) => `Rel(n${from},n${from + offset + 1},"Interaction ${from} to ${from + offset + 1}","HTTPS")`).join('\n')).join('\n')
const c4OfficialFixtures: Fixture[] = extractOfficialCorpus()
  .filter(fence => fence.family === 'c4')
  .map((fence, index) => ({
    id: `c4-official-${index}`,
    title: `Official C4 example ${index}: visible relationship ownership`,
    source: fence.source,
    captureLayout: true,
    pngWidth: 2400,
    cue: 'Inspect halos clear of cards, boundary headers and other relationship routes; visible arrowheads; and retained authored offsets. Compare complete labels, endpoint identities and layout sidecars alongside the pixels. Measured corridors grow rather than shrinking text or removing markers; these official examples do not establish arbitrary dense graph readability.',
  }))
const corpusSamples = collectSamples()
const stableReviewFamilies = ['packet', 'kanban', 'requirement', 'treemap', 'ishikawa', 'block'] as const
const stableRepresentativeCues = {
  packet: 'Thirteen authored fields retain inclusive bit addresses across eight descending-numbered word rows. Follow Sequence across the 64-bit boundary and both 64-bit spans; field widths remain proportional. The authored 40px bit width gives Flags room without changing any address or ratio.',
  kanban: 'Four ordered workflow columns contain nine cards with named owners, tickets and all five priority levels. Inspect card membership, complete labels and metadata, especially the GW-210 failure rehearsal in Validation. No network ticket or icon fetch is required.',
  requirement: 'Five requirements and three evidence elements retain eight relationships covering all seven relation kinds. Follow delivery/replay containment and derivation, contract/legacy copying, and both evidence verification links; compartment fields and relationship endpoints remain inspectable.',
  treemap: 'Three root allocations each total 100 engineer days. Build contains the nested Platform allocation, whose Authentication 24 and Event delivery 16 areas retain their exact ratio. All ten leaf labels and values must be visible; the authored landscape canvas provides room without changing quantities.',
  ishikawa: 'One release-delay effect retains four category bones and eleven contributing causes. Follow the third-level approval deadline and both Slow CI causes; branch ancestry and complete labels matter alongside the recognizable causal spine.',
  block:
    'Seven components occupy four authored composite groups, including nested Delivery/Persistence inside a two-column Gateway plane span, two empty cells and durable queue/store artwork. Follow six complete labeled connections; Batch enters Ingress from the west while Enqueue leaves south, preserving distinct physical contacts.',
} as const
const fixtures: Fixture[] = [
  ...['Z', 'AC', 'AL'].map((letter): Fixture => ({
    id: `performance-${letter.toLowerCase()}`,
    title: `Default forest: ${letter} geometry golden`,
    source: contactSheetScenarios().find(scenario => scenario.letter === letter)!.source,
    captureLayout: true,
    cue: 'Review the intentionally updated fan-out golden: all labels and directed connections remain, while the forest uses a 12px deeper child band. AL also shifts horizontally and widens by about 5px. Inspect sibling order, complete labels and clear arrow contacts; the owning contact-sheet tests keep hard violations at zero.',
  })),
  {
    id: 'performance-forest',
    title: 'Selected forest layout preserves labels and connections',
    source: 'flowchart TD\nRoot[Service entry] --> Cache[Cache]\nRoot --> Worker[Long-running worker]\nCache --> A[First result]\nCache --> B[Second result]\nWorker --> C[Stored output]\nWorker --> D[Final delivery]',
    captureLayout: true,
    cue: 'Compare all seven complete labels, six directed connections and authored sibling order under ordinary startup defaults. The selected forest and ELK can use different spacing. Layout sidecars and independent forest tests check final certification; this finite witness does not prove arbitrary graph readability or performance.',
  },
  {
    id: 'stable-class-interface-occurrences',
    title: 'Class lollipops retain independent interface occurrences',
    source: 'classDiagram\nnamespace Gateway {\nclass Client\nclass Server\nclass Port\n}\nClient --() Port : requests\nServer --() Port : serves\nClient --> Server : dispatches',
    renderOptions: { style: 'publication-figure', seed: 17, embedFontImport: false },
    captureLayout: true,
    cue: 'Inspect two separate circular Port interface occurrences beside the ordinary Port class compartment, both relationship labels, namespace ownership and dispatches. The prior implementation conflates endpoint labels with ordinary class identities. Compare public node IDs, endpoints and parents in the layout sidecars; this finite witness does not establish arbitrary dense Class layout.',
  },
  {
    id: 'stable-gantt-empty-plan',
    title: 'An empty Gantt plan has an explicit honest empty state',
    source: 'gantt\n  title Release readiness\n  dateFormat YYYY-MM-DD\n  section Verification',
    renderOptions: { style: 'publication-figure', seed: 17, embedFontImport: false },
    captureLayout: true,
    cue: 'Before: retain the actual no-tasks render refusal. After: inspect the authored title and Verification section with No tasks scheduled. No task bar or calendar tick may be invented. Independent Gantt tests retain the existing EMPTY_DIAGRAM verification diagnostic.',
  },
  ...stableReviewFamilies.flatMap(family =>
    ['default', 'hand-drawn', 'excalidraw', 'watercolor'].map(
      (style): Fixture => ({
        id: `stable-${family}-${style}`,
        title: `${family}: official pinned example in ${style}`,
        source: readFileSync(join(ROOT, 'docs/design/families', `${family}-demo.mmd`), 'utf8'),
        renderOptions: style === 'default' ? {} : { style },
        captureLayout: true,
        cue: 'Before: preserve the actual unsupported-family error. After: inspect complete labels, domain geometry, identities and parent/endpoint correspondence in the layout sidecar. The same input uses Agentic typography and the selected existing style backend. Terminal hierarchy projections do not claim SVG geometry.',
      }),
    ),
  ),
  ...stableReviewFamilies.map(
    (family): Fixture => ({
      id: `stable-${family}-representative`,
      title: `${getFamily(family)!.label}: representative gateway example`,
      source: readFileSync(join(ROOT, 'eval/stable-families/fixtures', `${family}.mmd`), 'utf8'),
      renderOptions: { style: 'publication-figure', seed: 17, security: 'strict', embedFontImport: false },
      pngScale: 1,
      captureLayout: true,
      cue: `${stableRepresentativeCues[family]} The common publication-figure style uses Agentic typography and palette. These authored examples are independent of the retained official demos; inspect the semantic/layout sidecars with the pixels. Preserve any actual baseline unsupported-family error.`,
    }),
  ),
  ...stableReviewFamilies.flatMap(family =>
    ['hand-drawn', 'excalidraw', 'watercolor', 'hand-drawn-dark'].map(
      (look): Fixture => ({
        id: `stable-${family}-representative-${look}`,
        title: `${getFamily(family)!.label}: representative gateway example in ${look}`,
        source: readFileSync(join(ROOT, 'eval/stable-families/fixtures', `${family}.mmd`), 'utf8'),
        renderOptions: { style: look === 'hand-drawn-dark' ? ['hand-drawn', 'dracula'] : look, seed: 17, security: 'strict', embedFontImport: false },
        pngScale: 1,
        captureLayout: true,
        cue: `${stableRepresentativeCues[family]} Compare the same complex source at both revisions: primary node and group surfaces must receive the shared sketch treatment while separators and label knockouts remain quiet. Inspect complete labels, readable ink on light/dark surfaces, exact bit/area proportions and unchanged identities, membership and endpoints in the layout sidecars. The finite bundled-font example does not certify arbitrary density or an authored low-contrast palette.`,
      }),
    ),
  ),
  ...['default', 'hand-drawn', 'watercolor'].map(
    (style): Fixture => ({
      id: `stable-block-parallel-${style}`,
      title: `Block reciprocal and parallel labeled links: ${style}`,
      source: 'block\ncolumns 2\nA["API"] B["Database"]\nA -- "Read" --> B\nB -- "Reply" --> A\nA -- "Write" --> B',
      renderOptions: style === 'default' ? {} : { style },
      captureLayout: true,
      cue: "Follow Read, Reply and Write on three distinct orthogonal lanes, with complete labels and visible endpoint arrows. The author's API/Database cells and endpoint identities remain intact. Preserve any actual baseline refusal: the unsupported baseline and a supported revision with occluded labels are different failure states. Inspect route and label coordinates in the layout sidecars; these finite examples do not establish arbitrary multigraph readability.",
    }),
  ),
  {
    id: 'stable-block-nested-group-style',
    title: 'Block nested semantic containers honor independent group and node Styles',
    source: 'block\nblock:outer["Outer"]\nblock:inner["Inner"]\nA["API"]\nend\nend',
    renderOptions: { style: { roles: { node: { textColor: '#b91c1c' }, group: { textColor: '#174ea6', fontSize: 22, fontWeight: 800, paddingX: 36, paddingY: 28, cornerRadius: 17, lineWidth: 3, borderColor: '#008800', headerFillColor: '#fef3c7' } } } },
    captureLayout: true,
    cue: 'Inspect blue 22px group headings on pale header bands, green rounded frames, visible child padding and the separate red API label. Outer must contain Inner, which contains API, in both actual SVG nesting and public layout parents/members. The same source and Style reach both revisions; preserve any unsupported baseline error. Color differences alone do not establish containment.',
  },
  {
    id: 'stable-requirement-relationship-style',
    title: 'Requirement consumes its true relationship Style while preserving node ink',
    source: 'requirementDiagram\nrequirement r {\ntext: "Measured card"\n}\nelement proof {\ntype: "test"\n}\nproof - verifies -> r',
    renderOptions: { style: { roles: { node: { textColor: '#b91c1c' }, relationship: { strokeColor: '#174ea6', textColor: '#166534' } } } },
    captureLayout: true,
    cue: 'Inspect red requirement/element compartment text, a blue verifies connector and matching arrow outline, and the separate green relationship label. These are static roles.relationship overrides, not category bindings. Node names, attributes and the proof-to-r relationship remain unchanged; preserve any unsupported baseline error and compare endpoint identities in the sidecars.',
  },
  {
    id: 'stable-requirement-source-spacing',
    title: 'Requirement family spacing controls actual node and rank clearance',
    source: '---\nconfig:\n  requirement:\n    nodeSpacing: 120\n    rankSpacing: 180\n---\nrequirementDiagram\nrequirement a {\ntext: Ingress validation\n}\nrequirement b {\ntext: Replay protection\n}\nrequirement c {\ntext: Deliver accepted events\n}\na - traces -> c\nb - traces -> c',
    renderOptions: { style: 'publication-figure', seed: 17, embedFontImport: false },
    captureLayout: true,
    cue: 'The exact same source requests requirement.nodeSpacing 120 and rankSpacing 180. Compare with the previous native-family head to see the formerly ignored settings take effect: sibling and layer clearance grow while all three requirement cards and both traceability endpoints remain. The feature baseline remains honestly unsupported. Explicit host spacing still wins, including zero; independent public-geometry tests cover both layout directions.',
  },
  {
    id: 'er-nested-group-route',
    title: 'ER ancestor relationships avoid the contained entity',
    source: 'erDiagram\n  subgraph commerce [Commerce Domain]\n    CUSTOMER\n    subgraph orders [Order Domain]\n      ORDER\n    end\n  end\n  commerce ||--o{ orders : contains\n  "This **is** _Markdown_"',
    captureLayout: true,
    cue: 'Inspect the Commerce-to-Orders relationship, its complete contains label and both cardinality markers. The baseline connects opposite frame faces through the ORDER card; the repaired route must preserve both group identities while clearing the entity and retained group titles. Compare physical contacts and group membership in the layout sidecars. This nested-frame witness does not establish arbitrary compound-route readability.',
  },
  {
    id: 'er-frame-label-demand',
    title: 'ER repeated frame labels retain their measured space',
    source: 'erDiagram\nsubgraph p\nsubgraph c\nA\nend\nB\nend\np ||--|| c : first\np ||--|| c : second\nc ||--|| p : reply',
    captureLayout: true,
    renderOptions: { style: { roles: { relationship: { fontSize: 22, letterSpacing: 1 }, group: { fontSize: 18 } } } },
    cue: 'Same 22px relationship text with 1px tracking and 18px group text at both revisions. Inspect complete first, second and reply labels, all cardinality marks, the sibling B card and both frame headers. Layout sidecars retain identities and membership; the finite example checks measured allocation and final paint, not general dense-layout readability.',
  },
  {
    id: 'er-neighboring-frame-route',
    title: 'ER frame relationships clear opaque headers',
    source: corpusSamples.find(sample => sample.id === 'corpus/er/16')!.source,
    captureLayout: true,
    cue: 'Follow title2 to C2 past the title3 header. The repaired route reserves the retained label halo instead of crossing the header. Inspect the complete links labels, all cardinality marks and unchanged entity/group membership; the wider canvas records actual corridor demand.',
  },
  {
    id: 'tracked-host-metrics',
    title: 'Retained tracked glyphs determine the node allocation',
    source: 'flowchart LR\nA["ABCD"]',
    renderOptions: { font: 'Inter', style: { roles: { node: { fontSize: 36, fontWeight: 400, letterSpacing: 4 } } } },
    pngScale: 2,
    measurementProfile: 'nonadditive-tracking',
    cue: 'Nonadditive host-profile stress case, not ordinary bundled-font metrics: the same host callback returns 2px for whole strings and 18px per glyph (27px when bold, unused here) at both revisions. SVG explicitly fits each tracked glyph to its selected width. Inspect C/D leaving the narrow baseline node and D clipping at the viewport; retained glyph allocations let the candidate size its node before painting. Source, Inter 36px, weight 400, tracking 4px, strict security, white PNG background and scale 2 are identical. The receipt records the profile configuration and render options.',
  },
  {
    id: 'class-watercolor-preservation',
    title: 'Class watercolor artwork preservation control',
    source: readFileSync(join(ROOT, 'eval', 'layout-compare', 'fixtures', 'class-basic.mmd'), 'utf8'),
    renderOptions: { style: 'watercolor' },
    cue: 'Ordinary bundled-font preservation control using the existing Class watercolor golden source and style. Compare complete labels, members, relationships and painted artwork. These revisions are expected to render the same image; this pair does not claim a visual improvement or establish the nonadditive host-profile repair.',
  },
  {
    id: 'state-marker-label-clearance',
    title: 'State labels preserve endpoint marker ink',
    source: corpusSamples.find(sample => sample.id === 'corpus/state/14')!.source,
    captureLayout: true,
    cue: 'Inspect both complete transition labels and all six arrowheads entering the Off states. Label separation must retain each label on its own route while clearing its own and neighboring marker artwork. Compare final label coordinates and unchanged routes in the sidecars; marker-resource and strict-certification assertions provide the geometry evidence.',
  },
  ...['AI', 'AJ'].map(
    (letter): Fixture => ({
      id: `native-priority-${letter.toLowerCase()}`,
      title: `Route priorities: contact sheet ${letter}`,
      source: contactSheetScenarios().find(scenario => scenario.letter === letter)!.source,
      captureLayout: true,
      cue:
        letter === 'AI'
          ? 'Inspect the existing C-to-D straight canonical contact. Cosmetic lane alignment must preserve an already valid contact without a higher-priority geometry repair. All labels and endpoints are controls.'
          : 'Inspect both complete long labels and their actual routes. Crossing prevention outranks symmetric outer lanes, and retained text plus actual pill halos determine clearance. Compare crossings and label coordinates in the sidecars; this is one deterministic topology.',
    }),
  ),
  {
    id: 'sequence-created-header-arrow',
    title: 'Creation messages attach to the participant header',
    source: 'sequenceDiagram\nparticipant A\ncreate participant C as Created\nA->>C: Welcome',
    captureLayout: true,
    cue: 'Inspect the Welcome arrow at Created. The baseline ends at the actor centre and hides the arrowhead under the card; the candidate ends at its near outline. The message keeps its author, recipient and label. Later messages still attach to the lifeline. This fixture covers participant cards; icon participants retain their own geometry.',
  },
  {
    id: 'parallel-lane-priority',
    title: 'Lane proposals preserve hard validity before preferred separation',
    source: 'flowchart LR\n  N0((n0))\n  N1[\\n1/]\n  N2[[n2]]\n  N2 -- go --> N1\n  N2 -- go --> N1\n  N2 --> N1\n  N1 --> N2\n  N0 --> N1\n  N2 --> N1\n  N1 --> N2',
    captureLayout: true,
    cue: 'Compare duplicated and reciprocal routes and the complete go labels. A lane proposal may not add crossings just to improve preferred separation. Inspect the exact layout sidecars alongside the pixels; this finite witness does not establish arbitrary graph readability.',
  },
  ...[
    { id: 'crisp', style: 'crisp' },
    { id: 'hand-drawn-dracula', style: ['hand-drawn', 'dracula'] },
    { id: 'watercolor-dracula', style: ['watercolor', 'dracula'] },
  ].map(
    ({ id, style }): Fixture => ({
      id: `c4-automatic-outline-${id}`,
      title: `C4 automatic card and boundary outlines: ${id}`,
      source: c4OutlineSource,
      renderOptions: { style, mermaidConfig: { c4: { typeLegend: false } } },
      cue: 'Compare the card and enclosing frame against their page. The candidate repairs automatic outline ink to at least 3:1 on the known opaque background, while retaining the same labels and geometry. Owning SVG and PNG tests check structural ink; this image does not certify every antialiased pixel or an unknown transparent host.',
    }),
  ),
  {
    id: 'architecture-automatic-outline',
    title: 'Architecture shares automatic outline repair',
    source: architectureOutlineSource,
    renderOptions: { style: ['hand-drawn', 'dracula'] },
    cue: 'Inspect the service cards and enclosing Application frame. Palette border candidates previously bypassed shared contrast repair in this family; the candidate uses the repaired automatic ink. Compare the same service identities and connection as controls.',
  },
  {
    id: 'architecture-deliberate-outline',
    title: 'Architecture preserves deliberate named and absent borders',
    source: architectureOutlineSource,
    renderOptions: { style: ['dracula', { roles: { group: { borderColor: 'midnightblue' }, node: { borderColor: 'none' } } }] },
    cue: 'The deliberately dark midnightblue frame and absent service outlines are authored overrides, so the candidate preserves them exactly. The baseline silently substitutes fallback strokes for these non-hex aliases. Visibility repair applies to automatic ink; this is a preservation control rather than a contrast endorsement.',
  },
  {
    id: 'er-order-after-removing-entity',
    title: 'ER order survives removing the entity that first introduced A (#372)',
    source: 'erDiagram\n  A ||--o{ X : r\n  subgraph G\n  B\n  end\n  subgraph I\n  A ||--o{ C : s\n  end',
    mutation: { kind: 'remove_entity', id: 'X' },
    cue: 'PR418 edit witness: request removal of X at both revisions. The intended remaining order is A, B, C, with A/C in I and B in G. Compare any baseline refusal, exported declarations and typed/reloaded order and ownership facts in the sidecars. Images can be identical; they do not alone establish semantic order. This repair is owned by PR418.',
  },
  {
    id: 'journey-all-break-labels',
    title: 'Journey admits title, section and task labels made entirely of breaks (#367)',
    source: 'journey\n  title <br/>\n  section <br/>\n  <br/>: 5: Me',
    cue: 'PR418 admission witness: render title, section and task labels made entirely of breaks at both revisions. Inspect any actual baseline refusal and the Me actor; blank label lines intentionally have no text ink. This earlier repair is owned by PR418. The fixture covers admission and rendering, not every Journey editing operation.',
  },
  {
    id: 'pie-remove-only-slice',
    title: 'Pie permits removing the only slice while retaining its title (#367)',
    source: 'pie\n  title Queue\n  "Only" : 1',
    mutation: { kind: 'remove_slice', label: 'Only' },
    cue: 'PR418 edit witness: request removal of Only at both revisions. Inspect any actual baseline refusal, exported source and empty slice facts. The resulting empty pie retains Queue. This earlier repair is owned by PR418; checked, CLI and MCP paths have separate owning tests.',
  },
  {
    id: 'flowchart-literal-runs-wrapped',
    title: 'Flowchart keeps literal entity tags beside bold text through wrapping and casing (CONS-46)',
    source: 'flowchart LR\nA["#lt;b#gt;code#lt;/b#gt; and <b>real bold</b>"] --> B[Done]',
    renderOptions: { wrappingWidth: 140, style: { roles: { node: { fontSize: 16, letterSpacing: 1, textTransform: 'uppercase' } } } },
    cue: 'Inspect A: the literal &lt;B&gt;CODE&lt;/B&gt; delimiters remain visible, while REAL BOLD alone carries the authored bold style. Both revisions receive the same 140px wrapping budget, uppercase transform and tracking. This pair shows public SVG/PNG rendering; source-span and edit preservation have separate owning tests.',
  },
  {
    id: 'er-literal-runs',
    title: 'ER distinguishes entity-produced delimiters from authored formatting (CONS-46)',
    source: 'erDiagram\nA["#lt;b#gt;code#lt;/b#gt; and **bold**"] ||--o{ B["Other"] : "#lt;i#gt;link#lt;/i#gt; and *styled*"',
    cue: 'Inspect the entity header and relationship: literal &lt;b&gt;code&lt;/b&gt; and &lt;i&gt;link&lt;/i&gt; delimiters stay visible beside genuinely bold and italic words. The endpoints and cardinality markers are controls. Spacing between formatted fragments remains imperfect in bundled-font PNGs at both revisions; the SVG retains the authored spaces. This pair establishes text interpretation, not a spacing repair, mutation behavior or upstream visual parity.',
  },
  {
    id: 'class-entity-label-members',
    title: 'Class decodes label, annotation and member entities as literal display text (CONS-46)',
    source: 'classDiagram\nclass A["#lt;b#gt;code#lt;/b#gt;"]\nclass A {\n <<#lt;i#gt;tag#lt;/i#gt;>>\n +String field#35;tag\n}\nA --> B : unchanged',
    cue: 'Inspect A’s literal &lt;b&gt;code&lt;/b&gt; label, the &lt;i&gt;tag&lt;/i&gt; text inside its annotation brackets, and the # in field#tag. Entity expansion must not create formatting or alter the member’s public visibility. The unchanged relationship is a control; this fixture does not exercise member editing.',
  },
  {
    id: 'sequence-literal-runs',
    title: 'Sequence aliases and messages retain literal entity text beside real emphasis (CONS-46)',
    source: sequenceEntitySource,
    cue: 'Inspect the visible &lt;b&gt;code&lt;/b&gt; alias, &lt;i&gt;literal&lt;/i&gt; message and *stars* characters. Authored styled, bold and italic words retain their actual emphasis. Compare both message directions and their arrowheads as controls. Spacing between formatted fragments remains imperfect in bundled-font PNGs at both revisions; the SVG retains the authored spaces. This pair covers graphical text interpretation; the matching terminal fixture shows plain cell text separately.',
  },
  {
    id: 'state-literal-percent-pairs',
    title: 'State description, transition and note retain literal percent pairs (#372)',
    source: 'stateDiagram-v2\nA : 100%% ready\nA --> B : status%%complete\nnote right of B : keep%%note',
    cue: 'Inspect all three complete text values: 100%% ready, status%%complete and keep%%note. Percent pairs inside these label contexts must remain visible instead of starting comments. This is a public render witness; source-loss warnings and editing paths have separate owning tests.',
  },
  {
    id: 'mindmap-literal-percent-pairs',
    title: 'Mindmap labels retain percent pairs while a real trailing comment stays hidden (#372)',
    source: 'mindmap\n root[100%% ready]\n  child[keep%%label]\n  final[Done] %% actual trailing comment',
    cue: 'Inspect the complete 100%% ready root and keep%%label child; Done remains a control, and actual trailing comment is not label text. The baseline panel records its actual refusal after truncating the root at the percent pair. This pair covers these bounded label/comment contexts, not every Mindmap delimiter form.',
  },
  {
    id: 'sequence-matching-fragment-setter',
    title: 'A matching Sequence setter publishes a directly changed fragment caption',
    source: 'sequenceDiagram\nalt Previous\nA->>B: request\nelse Alternate\nB->>A: reply\nend',
    directFragmentLabel: 'Updated',
    mutation: { kind: 'set_fragment_label', index: 0, label: 'Updated' },
    cue: 'At both revisions, change the mutable fragment label to Updated and call its matching public setter. Inspect alt Updated in the rendered export and matching facts/reloadedFacts in the edit sidecar. The audited 1d397dfd candidate kept Previous; main already publishes Updated. Owning tests cover first and continuation branch setters too. This does not establish serialization support for arbitrary direct body writes.',
  },
  {
    id: 'flowchart-anonymous-group-identity',
    title: 'Anonymous group allocation preserves authored identities',
    source: 'flowchart TD\nsubgraph A_B[Explicit]\nC[First member]\nend\nsubgraph "A--B"\nD[Second member]\nend',
    captureLayout: true,
    cue: 'Inspect two separate frames, Explicit and A--B, owning their respective members. Main preserves these groups; the audited intermediate PR head merged them. Use the recorded base/head receipt to distinguish the main comparison from the follow-up comparison against the audited candidate. The layout sidecar independently records the two identities and memberships.',
  },
  {
    id: 'xychart-visible-point-labels',
    title: 'XY point labels remain visible at range extremes',
    source: 'xychart-beta\n x-axis [A,B]\n y-axis 0 --> 10\n line [10 "Top",0 "Bottom"]',
    captureLayout: true,
    cue: 'Inspect the complete Top and Bottom text inside the viewport. Previously Top was drawn at y=-1 and clipped; the candidate moves only text, retaining both authored data coordinates. Painted text bounds appear separately in layout.labels, so this measurement does not invent data nodes.',
  },
  {
    id: 'flowchart-repeated-group-content',
    title: 'Repeated Flowchart group declarations retain both members',
    source: 'flowchart LR\nsubgraph S[First]\nA[Alpha]\nend\nsubgraph S[Later]\nB[Beta]\nend\nA e1@-->B\nB e2@-->A',
    captureLayout: true,
    cue: 'The baseline cannot render this repeated declaration; its actual error remains in the before panel. After, inspect one S frame containing Alpha and Beta, with the first authored title, First. Public layout sidecars expose group membership and reciprocal endpoints; SVG data-id attributes retain e1/e2. Complete labels alone do not establish correct containment.',
  },
  {
    id: 'er-neighboring-frame-corridors',
    title: 'ER corpus 16: neighboring frames reserve relationship-label corridors',
    source: corpusSamples.find(sample => sample.id === 'corpus/er/16')!.source,
    captureLayout: true,
    cue: 'Compare the three sibling frames and all six links labels, including the relationships between title1/title2/title3 and from title2 to C2. Each label must stay on its own connector and clear entity cards and sibling frames. Larger gaps and canvas bounds reserve measured label and marker space; unchanged labels do not by themselves prove routing ownership.',
  },
  {
    id: 'er-scoped-compound-corridors',
    title: 'ER corpus 17: scoped compound directions and relationship-label corridors',
    source: corpusSamples.find(sample => sample.id === 'corpus/er/17')!.source,
    captureLayout: true,
    cue: 'Inspect TOP containing separate B1/B2 frames: B1 keeps its right-to-left I1/F1 order and B2 its bottom-to-top I2/F2 order. All five links labels must remain attached to their own routes, especially A-to-TOP and I1-to-F1. Frame separation and label corridors grow without changing authored endpoints or parent membership; compare the public layout sidecars as well as the image.',
  },
  {
    id: 'class-inheritance-after-member-edit',
    title: 'Class inheritance survives an unrelated member edit (#406)',
    source: 'classDiagram\nPerson --|> Animal',
    classMutation: { kind: 'add_member', class: 'Person', text: '+name: String' },
    cue: 'Both revisions add the same member to Person. Before, canonical serialization reverses the inheritance triangle toward Person; after, it remains at Animal. Inspect the triangle and exported source, not the unchanged node labels. This witness covers one inheritance relation; the owning tests exercise the other marker kinds.',
  },
  {
    id: 'class-dashed-diamond-after-member-edit',
    title: 'Class dashed diamonds retain their shaft through an edit',
    source: 'classDiagram\nWhole o..* Part',
    classMutation: { kind: 'add_member', class: 'Whole', text: '+name: String' },
    cue: 'Both revisions add the same member to Whole. Before, export and rendering turn the dashed diamond relationship solid; after, the shaft stays dashed and both diamond endpoints remain. Inspect shaft gaps and the exported o..* spelling. This fixture does not establish every mixed marker combination.',
  },
  {
    id: 'class-multi-lollipop-after-member-edit',
    title: 'Class two-ended lollipops become editable and render natively',
    source: 'classDiagram\nPort ()..() Service : contract',
    classMutation: { kind: 'add_member', class: 'Port', text: '+name: String' },
    cue: 'The base revision refuses the edit because this relationship stays opaque; its honest error is the before evidence. The head exports and renders the same edit with two circle endpoints and a dashed shaft. Inspect authored Port/Service identities, both circles and the exported ()..() spelling; the image does not prove every public operation path.',
  },
  {
    id: 'mermaid-12-yaml-labels',
    title: 'Mermaid 12 metadata keeps numeric-looking labels as text',
    source: 'flowchart LR\nA@{ label: 1_0 } --> B@{ label: 1e309 }',
    cue: 'Inspect both authored labels: the baseline converts 1_0 to 10 and 1e309 to Infinity; the candidate retains 1_0 and 1e309 as the pinned Mermaid 12 YAML reader does. This focused witness checks scalar interpretation, not general layout quality.',
  },
  {
    id: 'mermaid-12-yaml-alias',
    title: 'Mermaid 12 participant alias keeps numeric separators',
    source: 'sequenceDiagram\nparticipant A@{ alias: 1_0 }\nA->>B: unchanged message',
    cue: 'Inspect A’s participant header: the baseline displays 10; the candidate preserves the authored 1_0 alias. The same message endpoints and text remain as a control.',
  },
  {
    id: 'yaml-flow-anchor-wrapper',
    title: 'An anchored multiline YAML value keeps its supported frontmatter footer',
    source: '---\nconfig: {custom: &a "foo\n  x: |\n    bar"}\n    ---\nflowchart TD\nA-->B',
    cue: 'The same anchored multiline value and indented footer reach both revisions. Inspect the native A-to-B Flowchart rather than preserved unknown-family source. The audited 8900adb7 candidate refused this render; main already renders it. Owning tests also cover tags and quoted keys. This witness proves family detection and rendering, not every YAML construct.',
  },
  {
    id: 'c4-ancestor-clearance',
    title: 'C4 ancestor relationship with a visible arrow',
    source: c4AncestorSource,
    captureLayout: true,
    cue: 'At source6724062 the Reports up halo covers the entire shaft and arrow. Inspect a complete label and a visible marker connecting Child to the actual Parent frame. The geometry test checks emitted halo and marker envelopes.',
  },
  {
    id: 'c4-dense-labels',
    title: 'C4 seven cards and twenty-one distinct interactions',
    source: c4DenseSource,
    captureLayout: true,
    cue: 'Inspect every complete interaction label and its arrow; the previous native C4 output had nine overlapping label pairs. Any remaining measured visibility limitation must appear in verification. This finite topology does not establish arbitrary dense graph readability.',
  },
  ...c4OfficialFixtures,
  {
    id: 'c4-responsive-width',
    title: 'C4 measured reflow within a 500-pixel budget',
    source: 'C4Context\nSystem(a,"Alpha")\nSystem(b,"Beta")\nSystem(c,"Gamma")\nSystem(d,"Delta")',
    renderOptions: { mermaidConfig: { c4: { maxWidth: 500 } } },
    captureLayout: true,
    cue: 'The same width request at both revisions changes row packing. Cards retain readable measured text and size; this is reflow rather than shrinking the completed picture. Impossible minimum geometry is separately diagnosed.',
  },
  {
    id: 'c4-checkout',
    title: 'Native C4 checkout with nested boundary and repeated interactions',
    source: readFileSync(join(ROOT, 'docs/design/families/c4-context-demo.mmd'), 'utf8'),
    captureLayout: true,
    cue: 'The baseline refuses C4. The candidate preserves the nested checkout boundary, external/database/queue distinctions, technology and all five distinct interactions. Inspect the complete Publishes order / AMQP label beside the database; public layout sidecars establish identity and parentage beyond the pixels.',
  },
  {
    id: 'c4-person-tight-padding',
    title: 'C4 person silhouette with zero vertical padding',
    source: 'C4Context\nPerson(a,"Customer","Uses the shop")',
    renderOptions: { style: { roles: { node: { paddingY: 0 } } } },
    cue: 'The baseline refuses C4. The candidate reserves the person silhouette above the complete label even when node paddingY is zero; the figure must not strike through Customer.',
  },
  {
    id: 'sankey-whitespace-identities',
    title: 'Sankey authored whitespace identities',
    source: whitespaceIdentitySource,
    captureLayout: true,
    cue: 'The identity oracle is the decoded XML DOM and graphical/terminal sidecars: TAB, LF, CR and quoted empty rows must remain distinct from spaces, including repeated links and generated-looking names. Display controls stay inert. Pixels alone do not prove identity preservation.',
  },
  { id: 'pie-five-line-title', title: 'Pie authored multiline title (#381)', source: withTitle('pie\n "n0" : 1\n "n1" : 2'), cue: 'All five title lines stay on the canvas and clear the pie and legend. This is the original multiline-title failure family.' },
  { id: 'sankey-five-line-title', title: 'Sankey authored multiline title (#381)', source: withTitle('sankey-beta\n n0,nsink,1'), cue: 'The complete centered title owns a band above the flows, without clipping its first lines or overlapping node labels.' },
  {
    id: 'architecture-title-and-header',
    title: 'Architecture multiline title and group header (#381)',
    source: withTitle('architecture-beta\n group ng(cloud)["First<br/>Second<br/>Third<br/>Fourth<br/>Fifth"]\n service ns0(server)[S0] in ng\n service ns1(server)[S1] in ng\n ns0:R -- L:ns1'),
    cue: 'The title clears the complete group header; the header band expands above both services, and routed edges retain their port positions.',
  },
  {
    id: 'quadrant-capitalized-title',
    title: 'Quadrant capitalization before wrapping (#382)',
    source: `---\ntitle: "${'pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(3)}"\n---\nquadrantChart\n A: [0.3,0.6]`,
    renderOptions: { style: { roles: { group: { textTransform: 'capitalize' } } } },
    cue: 'Only the first authored letter becomes uppercase. Wrapped continuation fragments keep their original lowercase letters; automatic hyphens do not create new words.',
  },
  {
    id: 'quadrant-complete-axes',
    title: 'Quadrant complete half-axis labels',
    source: 'quadrantChart\n x-axis A very detailed low effort description that cannot fit in only two lines while retaining every word --> An equally detailed high effort description that also retains its complete authored ending\n y-axis Small --> Large\n A: [0.3,0.6]',
    cue: 'Both full horizontal labels wrap within their half-plot widths; their gutter grows instead of silently replacing the ending with an ellipsis.',
  },
  {
    id: 'quadrant-tall-axis-shaping',
    title: 'Quadrant complete Arabic and accented axis bands',
    source: `quadrantChart\n x-axis ${'مرحبا '.repeat(25)} --> far\n y-axis ${'ÉǗẼ '.repeat(25)} --> high\n A: [0.3,0.6]`,
    cue: 'The baseline truncates long axis descriptions. The candidate retains every word, with horizontal and rotated gutters sized from the prepared shaping bands. Inspect the lowest Arabic line and the leftmost accented line: neither clips the canvas nor intrudes into the plot.',
  },
  {
    id: 'sankey-tall-node-labels',
    title: 'Sankey complete adjacent tall node labels',
    source: `sankey-beta\n"First ${Array(7).fill('ÉǗẼ').join('\n')}",Sink1,1\n"Second ${Array(7).fill('ÉǗẼ').join('\n')}",Sink2,1`,
    cue: 'The baseline compresses the authored node text into shorter line bands. The candidate retains complete accent bands and separates adjacent labels without clipping the canvas. Both equal-valued ribbons retain equal widths; only placement and canvas bounds grow.',
  },
  {
    id: 'gantt-literal-tags',
    title: 'Gantt literal task delimiters (#383)',
    source: `gantt\n dateFormat YYYY-MM-DD\n ${literalLabel} :a, 2024-01-01, 10d`,
    cue: 'The single authored opening and closing delimiter pair remains literal across wrapped task lines. No extra delimiters are inserted and the column uses the painted width.',
  },
  {
    id: 'radar-literal-tags',
    title: 'Radar literal axis and legend delimiters (#383)',
    source: `radar-beta\n axis a["${literalLabel}"], b["B"], c["C"]\n curve value["<i>A detailed curve label that must wrap without multiplying literal delimiters</i>"]{1,2,3}`,
    cue: 'Each axis or legend label keeps its one authored delimiter pair. Axis clearance and legend rows use the complete literal block.',
  },
  {
    id: 'gantt-prepared-roles',
    title: 'Gantt multiple text roles with resolved tracking',
    source: withTitle('gantt\n dateFormat YYYY-MM-DD\n topAxis\n section A sufficiently detailed section heading that wraps\n <i>Literal task delimiters</i> and é👩🏽‍💻 remain complete while wrapping :a, 2024-01-01, 10d\n Next task :b, after a, 4d'),
    renderOptions: trackedRoles,
    cue: 'Title, section, task and tick roles share the resolved casing, weight and tracking. Inspect the combining accent inside the wrapped literal task and title clearance above the top axis. Bundled PNG fonts lack this emoji; its missing-glyph boxes document a font-coverage limitation, while the source and glyph positioning remain reviewable in the SVG.',
  },
  {
    id: 'radar-combining-tracking',
    title: 'Radar visible combining Latin graphemes with tracking',
    source: `---\ntitle: ${JSON.stringify('Café Ångström niño résumé')}\n---\nradar-beta\n axis a["${'é Å ñ '.repeat(8).trim()}"], b["Complete accent clusters"], c["C"]\n curve value["Café résumé and Ångström keep complete accents while wrapping"]{1,2,3}`,
    renderOptions: trackedRoles,
    cue: 'These combining Latin graphemes are covered by the bundled PNG fonts. Inspect accent attachment under casing, wrapping, heavy weight and positive tracking, across title, axis and legend roles.',
  },
  {
    id: 'radar-grapheme-tracking',
    title: 'Radar tracked mixed-script text across roles',
    source: `---\ntitle: ${JSON.stringify('漢字ひらがな é 👩🏽‍💻 👨‍👩‍👧‍👦')}\n---\nradar-beta\n axis a["${'é👩🏽‍💻'.repeat(8)}"], b["${'漢字ひらがな'.repeat(5)}"], c["C"]\n curve value["${literalLabel}"]{1,2,3}`,
    renderOptions: trackedRoles,
    cue: 'The source and positioned SVG spans retain complete graphemes. Positive tracking and heavy weight are measured before placement. Bundled PNG fonts lack these CJK and emoji glyphs, so the visible missing-glyph boxes establish a font-coverage limit; this witness proves placement and source retention, not script legibility.',
  },
  {
    id: 'xychart-title',
    title: 'XY-chart nightly title counterexample',
    source: '---\ntitle: Quarterly Quarterly Quarterly Quarterly Quarterly Quarterly Quarterly Quarterly\n---\nxychart-beta\n  x-axis [n0, n1, n2]\n  y-axis 0 --> 100\n  bar [1, 2, 3]',
    cue: 'Inspect the complete title inside the canvas and the plot below its wrapped lines.',
  },
  {
    id: 'xychart-literal-title',
    title: 'Horizontal XY-chart literal title',
    source: 'xychart-beta horizontal\n  title "Worldwide <b>quarterly revenue by region and channel for the North American market forecast</b>"\n  x-axis [Jan, Feb, Mar]\n  y-axis 0 --> 100\n  bar [10, 20, 30]',
    cue: 'The title wraps without interpreting or duplicating the literal angle brackets.',
  },
  {
    id: 'class-marker-native',
    title: 'Class: native vertical endpoint orientation',
    source: 'classDiagram\ndirection TB\nA <|-- B\nA *-- C',
    renderOptions: { style: { roles: { edge: { strokeColor: '#dc2626' } } } },
    cue: 'Inspect the red inheritance triangle and composition diamond beneath A. Before, native PNG fixes their orientation horizontally; after, they align with their shafts and meet A. The public SVG was already correct. Nodes and routes do not move.',
  },
  {
    id: 'sequence-arrow-native',
    title: 'Sequence: native reverse and bidirectional heads',
    source: 'sequenceDiagram\nA<<->>B: both\nB->>A: response\nA<<->>A: self',
    renderOptions: { style: { roles: { edge: { strokeColor: '#dc2626' } } } },
    cue: 'Inspect the left endpoint of both and the response into A: native heads used to point right regardless of message direction; after, they point toward their authored endpoints. Public SVG direction was already correct. Typed Scene markers are also retained.',
  },
  ...[849, 1368].map(seed => ({
    id: `rectangle-terminal-${seed}`,
    title: `Sub-pixel rectangle-face jog: denseDag ${seed}`,
    source: denseDag(seed),
    cue: `Inspect ${seed === 849 ? 'the two unlabelled N6→N5 arrows' : 'both N2→N3 arrows'}: a terminal run below 0.5px along the rectangle face rotated the whole arrow sideways. After, the existing normal shaft ends on that same face. No shaft is added; contact moves below 1px and route certificates are refreshed.`,
  })),
  ...(
    [
      ['L', 'R'],
      ['B', 'T'],
      ['T', 'B'],
      ['R', 'L'],
    ] as const
  ).map(([sourceSide, targetSide]) => ({
    id: `architecture-arrow-${sourceSide.toLowerCase()}`,
    title: `Architecture two-way arrow: ${sourceSide} to ${targetSide}`,
    source: `architecture-beta\nservice api(server)[API]\nservice db(database)[Database]\napi:${sourceSide} <--> ${targetSide}:db`,
    renderOptions: { architecture: { visual: { edgeStroke: '#dc2626', edgeLineWidth: 1 } } },
    cue:
      sourceSide === 'R'
        ? 'Rightward raster control: both heads are already visible in the baseline PNG. Compare the marker definitions in the SVG to inspect the source orientation and tip-reference correction. Service and route geometry stay the same.'
        : `Inspect the red arrowhead at API's ${sourceSide} face: before, it is missing or malformed; after, its tip points at API with its body outside. Database is the opposite-end control. Only marker orientation and reference points change; service and route geometry stay the same.`,
  })),
  {
    id: 'sequence-label-span',
    title: 'Sequence labels crossing a middle lifeline and activation',
    source: sequenceSpanSource,
    cue: 'Inspect B behind the first and final labels: structural ink should leave their measured areas, while the lifeline and activation remain visible above and below. The middle message begins the activation.',
  },
  {
    id: 'sequence-label-nested-surfaces',
    title: 'Sequence multiline numbered bidirectional label over nested colors',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nparticipant C\nrect rgba(30,90,150,0.25)\nrect rgb(25,45,65)\nactivate B\nA->>C: Begin work\nautonumber 10.5 0.25\nA<<-->>C: Numbered span<br/>across active B<br/>on the inner surface\ndeactivate B\nend\nend',
    cue: 'Inspect all label lines, the 10.5 prefix and both arrowheads. The gap through B should reveal the inner authored surface, without a page-colored patch; the outer translucent band is a color control.',
  },
  {
    id: 'sequence-label-transparent',
    title: 'Sequence label gaps on a transparent canvas',
    source: sequenceSpanSource,
    renderOptions: { transparent: true },
    cue: 'Inspect the gaps over the checkerboard: removing lifeline and activation ink should preserve canvas transparency. The checkerboard belongs only to this review page; the PNG uses an explicitly transparent raster background.',
  },
  {
    id: 'sequence-label-sketch',
    title: 'Sequence label gaps with the hand-drawn style',
    source: sequenceSpanSource,
    renderOptions: { style: 'hand-drawn', seed: 17 },
    cue: 'Inspect the first and final labels with a fixed sketch seed. This is a check of one styled backend; it does not establish parity across every look.',
  },
  {
    id: 'sequence-created-empty-child',
    title: 'Sequence created actor inside a frame with an empty child',
    source: 'sequenceDiagram\nparticipant A\nNote over A: before\nloop Outer\ncreate actor C as New\nA->>C: spawn\nloop Empty\nend\nend\nNote over A: after',
    cue: 'The Outer frame clears the before note, contains the full created actor, and reserves a separate empty child below the creation row.',
  },
  {
    id: 'sequence-self-empty-section',
    title: 'Sequence self-message followed by an empty alternative',
    source: 'sequenceDiagram\nparticipant A\nNote over A: before\nalt Next\nA->>A: self\nelse EmptySection\nend\nNote over A: after',
    cue: 'The reserved frame top clears the before note; the empty alternative divider follows the self-message and stays inside its frame.',
  },
  {
    id: 'sequence-note-only-rect',
    title: 'Sequence note-only background below actor headers',
    source: 'sequenceDiagram\nparticipant A\nrect rgba(0,0,0,0.1)\nNote over A: inside\nend\nNote over A: outside',
    cue: 'The background begins below the participant header, contains its note with declared padding, and ends before the outside note.',
  },
  {
    id: 'sequence-empty-sections',
    title: 'Sequence empty children in distinct alternative sections',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nalt First\nloop C1\nend\nelse Second\nloop C2\nend\nelse Third\nloop C3\nend\nend\nNote over A: outside',
    cue: 'Each empty child stays in its authored branch; the dividers clear the header, preceding children and their labels.',
  },
  {
    id: 'sequence-note-closure',
    title: 'Sequence note after a closed fragment',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop inside\nA->>B: hi\nNote over B: inside note\nend\nNote over B: outside note\nA->>B: done',
    cue: 'The inside note stays within its loop; the outside note begins below the closing frame.',
  },
  {
    id: 'sequence-nested-closures',
    title: 'Sequence notes between nested closures',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop Outer\nloop Inner\nA->>B: hi\nNote over B: inner owned\nend\nNote over B: outer owned\nend\nNote over B: outside both\nA->>B: done',
    cue: 'Each note belongs to its authored scope: inner, outer, then outside both frames.',
  },
  {
    id: 'sequence-sibling-leading-note',
    title: 'Sequence sibling fragment with a leading note',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop First\nA->>B: hi\nNote over B: inside first\nend\nNote over B: between\nopt Second\nNote over B: leading second\nA->>B: next\nend\nNote over B: outside second',
    cue: 'The between note clears both sibling frames; the Second header reserves space above its leading note.',
  },
  { id: 'sequence-note-only', title: 'Sequence fragment containing only a note', source: 'sequenceDiagram\nparticipant A\nloop L\nNote over A: inside\nend\nNote over A: outside', cue: 'The note-only loop contains its inside note and ends before the outside note, without requiring a message.' },
  {
    id: 'sequence-created-icon',
    title: 'Sequence created actor with a multiline label',
    source: 'sequenceDiagram\nparticipant A\nloop Spawn\ncreate actor C as Support<br/>Engineer<br/>On call\nA->>C: spawn\nNote over A: owned created note\nend\nNote over C: outside created note\nC->>A: ready',
    cue: 'The Spawn frame contains the created actor and its full label; the following outside note clears the frame.',
  },
  {
    id: 'sequence-self-loop',
    title: 'Sequence self-message and long fragment header',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop A very long block header that must remain within the enclosing fragment\nA->>A: This very long self message should have clear space before B\nend\nA->>B: done',
    cue: 'The self-message clears B, its return arrow clears the loop bottom, and the full header fits inside the frame and canvas.',
  },
  {
    id: 'sequence-empty-frames',
    title: 'Sequence nested empty frames between notes',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: first\nNote over A: before\nloop Outer\nloop Inner\nend\nend\nNote over A: after\nB->>A: last',
    cue: 'Both empty frames remain visible between the before and after notes, without capturing either neighboring message.',
  },
  {
    id: 'sequence-final-note-branch',
    title: 'Sequence final branch containing only a note',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nalt First\nNote over A: intro\nA->>B: work\nelse Second\nNote over A: second branch\nend\nNote over B: outside',
    cue: 'The Second divider follows the intro note and work message; its note clears the section label and the outside note clears the frame.',
  },
  { id: 'sequence-five-line-message', title: 'Sequence five-line message inside a loop', source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop Work\nA->>B: one<br/>two<br/>three<br/>four<br/>five\nend', cue: 'All five message lines remain inside the loop, below its header and above the arrow shaft.' },
  {
    id: 'sequence-corpus-26',
    title: 'Corpus sequence 26: nested parallel fragments',
    source:
      'sequenceDiagram\n    par Alice to Bob\n        Alice->>Bob: Go help John\n    and Alice to John\n        Alice->>John: I want this done today\n        par John to Charlie\n            John->>Charlie: Can we do this today?\n        and John to Diana\n            John->>Diana: Can you help us today?\n        end\n    end',
    cue: 'Compare both parallel frames, their headers and bottom clearance; this earlier sequence repair is a compatibility control.',
  },
  {
    id: 'sequence-corpus-30',
    title: 'Corpus sequence 30: nested backgrounds with a leading note',
    source:
      'sequenceDiagram\n    participant Alice\n    participant John\n\n    rect rgb(191, 223, 255)\n    note right of Alice: Alice calls John.\n    Alice->>+John: Hello John, how are you?\n    rect rgb(200, 150, 255)\n    Alice->>+John: John, can you hear me?\n    John-->>-Alice: Hi Alice, I can hear you!\n    end\n    John-->>-Alice: I feel great!\n    end\n    Alice ->>+ John: Did you want to go to the game tonight?\n    John -->>- Alice: Yeah! See you there.',
    cue: 'Compare the leading note, nested background boundaries and following messages; this earlier sequence repair is a compatibility control.',
  },
  { id: 'timeline', title: 'Timeline milestone', source: 'timeline\n2020 : A\nTimeline redesign : Ship', cue: 'Both the Timeline redesign period and Ship event remain visible.' },
  { id: 'state', title: 'Unknown State statement', source: 'stateDiagram-v2\nA --> B\nbogus -->', cue: 'Compare how each revision reports the unknown statement, including any explicit diagnostic.' },
  { id: 'diamond-lr', title: 'Horizontal decision duplicates', source: 'flowchart LR\nC{Verify} -->|ok| D[View]\nC -->|warnings| D', cue: 'Both labels and distinct arrowheads are visible, without crossing routes.' },
  { id: 'diamond-td', title: 'Vertical decision duplicates', source: 'flowchart TD\nC{Verify} -->|ok| D[View]\nC -->|warnings| D', cue: 'Both labels and distinct arrowheads are visible, without crossing routes.' },
  { id: 'diamond-feeder', title: 'Decision duplicates with another feeder', source: 'flowchart TD\nC{Verify} -->|ok| D[View]\nC -->|warnings| D\nA[Start] --> D', cue: 'The two decision labels remain readable without crossing the extra feeder.' },
  { id: 'diamond-feedback', title: 'Decision duplicates with feedback', source: 'flowchart TD\nC{Verify} -->|ok| D[View]\nC -->|warnings| D\nD --> C', cue: 'The forward pair remains readable without crossing the return edge.' },
  {
    id: 'sankey-public-identities',
    title: 'Sankey duplicate rows and generated-looking authored names',
    source: sankeyIdentitySource,
    captureLayout: true,
    cue: 'The ribbons are a visual compatibility control. Inspect the SVG data-id attributes and public layout sidecars: every authored link keeps distinct identity and correct endpoints, including the literal node link:A->B#1. Pixels cannot establish identity uniqueness.',
  },
]
const terminalFixtures = [
  {
    id: 'terminal-sequence-literal-runs',
    source: sequenceEntitySource,
    cue: 'Current text-change witness: visible alias and message cells retain <b>code</b>, <i>literal</i> and *stars*, with entity codes decoded once. Terminal output shows the plain visible words for genuine emphasis. Inspect complete text and both message directions; the separate owning test establishes connector receipt correspondence. All following terminal panels are retained historical controls.',
  },
  {
    id: 'terminal-c4-compact',
    source: '---\nconfig:\n  c4:\n    compact: true\n---\nC4Container\nPerson(user,"User")\nContainer(api,"API","Go")\nContainerDb(db,"Store","SQL")\nRel(user,api,"Calls")\nRel(api,db,"Reads")',
    cue: 'The same opt-in compact setting at both revisions reduces terminal spacing using independently measured cells. Inspect all three complete type labels, both relationship labels and connected owned routes; no pixel drawing is downscaled.',
  },
  {
    id: 'terminal-c4-checkout',
    source: readFileSync(join(ROOT, 'docs/design/families/c4-context-demo.mmd'), 'utf8'),
    cue: 'The baseline refuses C4. The candidate owns a separate cell layout with the complete boundary, metadata text and five connected interactions. Compare node/edge identities and parents with the graphical sidecar; terminal geometry is checked independently by owned-cell connectivity tests.',
  },
  {
    id: 'terminal-state-nested-note',
    source: 'stateDiagram-v2\nstate Outer {\n B\n}\nnote right of B: Note',
    cue: 'Before, the dotted attachment stops at the Outer frame while metadata declares a connected note. After, visible owned ink reaches the note through a perpendicular frame crossing. Inspect the retained frame and both physical endpoint ports in the sidecars.',
  },
  {
    id: 'terminal-state-note-incoming-marker',
    source: 'stateDiagram-v2\ndirection LR\nstate Outer {\n A --> B\n}\nnote left of B: Note & 界',
    cue: 'The note connects to an available border row beside B without erasing its incoming arrow. Inspect the wide note text, the full dotted path through Outer, and the unchanged transition head. Independent tests check corresponding plain, ANSI and HTML cells.',
  },
  {
    id: 'terminal-state-interleaved-notes',
    source: 'stateDiagram-v2\nstate X {\n A --> B\n}\nstate Y {\n C --> D\n}\nA --> D\nC --> B\nnote right of A: Anote\nnote left of D: Dnote',
    cue: 'Both notes retain independent attachment approaches and complete routes despite the interleaved groups. Inspect Anote and Dnote as well as all four original transition heads. The pre-existing transition layout may diagnose unrelated overlaps; this witness proves the note attachments, not arbitrary graph feasibility.',
  },
  {
    id: 'terminal-class-protected-approaches',
    source: 'classDiagram\ndirection LR\nC --> D : relation 0\nA ..> F : relation 1\nC --* F : relation 2\nC --o B : relation 3\nA --> D : relation 4\nC ..> F : relation 5',
    cue: 'Crossings retain complete marker approaches. Inspect every diamond and arrow, especially the final C-to-F relationship, and the connected owned-cell sidecars. Labels leave each planned exit accessible. The baseline can return output despite a marker interrupting a route; successful rendering alone is not the oracle.',
  },
  {
    id: 'terminal-er-protected-approaches',
    source: 'erDiagram\ndirection LR\nC ||--o{ F : relation 0\nA }o..|| B : relation 1\nC ||--|| F : relation 2\nE ||--o{ B : relation 3\nE }o..|| B : relation 4\nE ||--|| D : relation 5\nE ||--o{ B : relation 6\nE }o..|| D : relation 7',
    cue: 'All two-cell cardinality markers retain their original owners, and line crossings stay outside their protected approaches. Inspect the parallel E-to-B and E-to-D relationships. Independent tests traverse actual marker/stroke cells between both physical ports in all four directions and both alphabets.',
  },
  {
    id: 'terminal-class-namespace-approach',
    source: 'classDiagram\ndirection TB\nclass A["Actual source"]\nnamespace A["First 界<br/>complete header"] {\n class B["Actual target"]\n}\nA --> B : relation 0',
    cue: 'The namespace reserves its full multiline header and normal marker approach. Inspect the complete arrow into Actual target beneath the header. The class and namespace sharing raw ID A retain separate typed ownership; a source identity is not substituted with its group.',
  },
  {
    id: 'terminal-er-group-approach',
    source: 'erDiagram\ndirection TB\nA["Actual source"]\nsubgraph G["First 界<br/>complete header"]\n B["Actual target"]\nend\nA ||--o{ B : relation 0',
    cue: 'The group header and child card leave space for the complete two-cell cardinality approach and routing row. Inspect the normal connection into Actual target, retained source markers and complete relationship label. Larger frame clearance is an allocation decision before painting.',
  },
  { id: 'terminal-mixed-marker-ports', source: 'flowchart LR\nA o--o B\nA x--x B\nA <--> B', cue: 'Before, circle, cross and arrow markers compete for one cell and later meanings disappear. After, native face capacity and separate ports preserve all six endpoint markers.' },
  { id: 'terminal-sequence-self-heads', source: 'sequenceDiagram\nA<<->>A: both heads\nA\\|-A: half start\nA-|/A: half return', cue: 'Both self-message heads point into their own lifeline. The old upper head points away; half heads retain their authored kind in the metadata.' },
  { id: 'terminal-container-entry', source: 'flowchart LR\nX --> S\nsubgraph S [One]\na1\na2\nend\nsubgraph T [Two]\nb1\nb2\nend', cue: 'Before, the route enters through the top and points outward at the left face from inside. After, it stops at the first actual container boundary with an inward head.' },
  {
    id: 'terminal-rl-physical-ports',
    source: contactSheetScenarios()
      .find(scenario => scenario.letter === 'AI')!
      .source.replace('flowchart TD', 'flowchart RL'),
    cue: 'Existing contact-sheet AI counterexample, reflected to RL. Inspect the heads entering EEEE from DDDD and F? from DDDD: both disappear at stale grid boundaries in the baseline and survive at physical native ports after the repair. The other heads and all labels are controls.',
  },
  {
    id: 'terminal-gantt-dependencies',
    source: 'gantt\ndateFormat YYYY-MM-DD\nFirst :a, 2026-01-01, 1d\nNext :b, after a, 1d\nUntil :c, 2026-01-01, until b',
    cue: 'The bars and dates stay unchanged. Owned after/until summaries now preserve the dependency graph, and diagnostics explicitly distinguish them from geometric arrows.',
  },
  { id: 'terminal-authored-empty-rows', source: 'flowchart LR\nA -->|long label<br><br>x| B', cue: 'The drawing is unchanged. Compare projectedText in the metadata: its deliberate empty row must agree with the existing visible row gap and authoredTextCells, without inventing text cells.' },
  {
    id: 'terminal-sequence-empty-rows',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: first<br><br>last',
    cue: 'The complete message is one logical occurrence. The drawing retains its original rows; metadata must include first, the deliberate empty row and last, while actor header/footer occurrences remain separate.',
  },
  {
    id: 'terminal-whitespace-identities',
    source: whitespaceIdentitySource,
    cue: 'Authored LF, TAB, CR, space and quoted empty-row identifiers remain distinct. Inspect exact node/edge IDs and endpoints in both projections, including generated-looking IDs and duplicate links. The display may show the same safe label for different source elements.',
  },
  ...knownBuiltinFamilies().flatMap(id => {
    const source = getFamily(id)?.example
    return source ? [{ id: `terminal-${id}`, source, cue: 'Compare labels, native marks and structure; the JSON sidecars show exact ownership separately.' }] : []
  }),
  {
    id: 'terminal-sequence-boundaries',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop outer\nNote over A,B: Owned inside\nA->>B: work\nend\nNote over A,B: After close\nopt empty sibling\nend\nautonumber 10 2\nB->>A: numbered\nautonumber off\nA->>B: hidden\nautonumber\nB->>A: resumes',
    cue: 'The post-close note is outside the loop, empty siblings keep their own bounds, and numbering resumes the shared counter.',
  },
  { id: 'terminal-class-ports', source: 'classDiagram\nclass A {\n +String name\n +run() void\n}\nclass B\nA "1" --> "*" B : complete relation\nA --> A : self\nA --> B : parallel', cue: 'Inspect both cardinalities, every complete label, the self loop and separate physical ports.' },
  { id: 'terminal-zero-pie', source: 'pie showData\n title Zero values\n "Still present" : 0\n "Also present" : 0', cue: 'Both revisions should preserve zero labels and values without inventing positive bars; this earlier Pie repair is a compatibility control.' },
  { id: 'terminal-xy-baseline', source: 'xychart-beta\n x-axis [A, B, C]\n y-axis 1 --> 14\n bar [1, 6.5, 14]', cue: 'The authored minimum-valued bar has zero length; ticks, marks and baseline use the same quantizer.' },
  { id: 'terminal-xy-mixed-coverage', source: 'xychart-beta\n x-axis [A, B, C, D]\n y-axis 0 --> 100\n bar [20, 50, 80, 40]\n line [20, 90, 30, 70]', cue: 'Bars retain their full numeric coverage. The line is visible outside bars and explicitly occluded behind them; compare the exact cell spans in the metadata.' },
  { id: 'terminal-xy-horizontal-coverage', source: 'xychart-beta horizontal\n x-axis [A, B, C, D]\n y-axis 0 --> 100\n bar [22.5, 52.5, 82.5, 42.5]\n line [20, 90, 30, 70]', cue: 'The horizontal form preserves half-cell bar endpoints using the same opaque-mark policy.' },
  { id: 'terminal-class-namespace-headers', source: 'classDiagram\ndirection LR\nnamespace Alpha["First<br/>complete header"] {\n class A\n}\nnamespace Beta["Second<br/>complete header"] {\n class B\n}\nA --> B : edge', cue: 'Both complete namespace headers clear sibling envelopes and the owned relationship.' },
  { id: 'terminal-sequence-central-markers', source: 'sequenceDiagram\nA->>()B: central end\nB() ->>A: central start\nA() <<->>()B: both ends\nA->>()A: self end', cue: 'Inspect central circles at every authored endpoint, including the self message.' },
  { id: 'terminal-container-cycle', source: 'flowchart TD\nsubgraph G[Group]\n subgraph H[Inner]\n A[Member]\n end\nend\nB[External] --> G\nG --> B', cue: 'Both reciprocal relationships should survive a component without an initial root; any actual refusal remains visible in its revision panel.' },
  { id: 'terminal-gantt-task-identities', source: 'gantt\ndateFormat YYYY-MM-DD\nFirst :2024-01-01, 1d\nSecond :task-0, 2024-01-03, 1d\nclick task-0 href "https://example.com"', cue: 'The task-0 owned spans identify only Second; the anonymous task has its own stable identity.' },
  { id: 'terminal-sankey-policy', source: '---\nconfig:\n sankey:\n  linkColor: "#ff0000"\n---\nsankey-beta\nSource,Target,2\nSource,Target,1', cue: 'Static link paint reaches the owned bars. Parallel adjacency regions retain their endpoints and distinct identities.' },
  { id: 'terminal-tall-frame', source: 'flowchart LR\nsubgraph S["One<br>Two<br>Three<br>Four<br>Five"]\n A[Node]\nend', cue: 'Every header line is complete and clears the node; neither wrapping nor composition rewrites source.' },
  { id: 'terminal-reflected-text-footprint', source: 'flowchart BT\nA["ab<br>x"] --> B[Other]', cue: 'The reflected card retains both ragged lines, ab and x. Text and its opaque footprint move together without reversing reading order.' },
  { id: 'terminal-header-route-feasibility', source: 'flowchart TD\nX\nsubgraph one\n A --> B\nend\nY\nX --> A\nB --> Y', cue: 'The complete one header stays clear of the incoming relationship. Inspect the continuous route around its reserved text rectangle.' },
  { id: 'terminal-empty-header-route-feasibility', source: 'flowchart TD\nsubgraph Parent[Empty parent]\n subgraph Empty[Nothing here]\n end\nend\nA[Start] --> Empty', cue: 'Both complete headers remain visible while the relationship detours around the parent header and attaches to the actual empty container.' },
  { id: 'terminal-reciprocal-label-feasibility', source: 'flowchart TD\nA -->|down| B\nB -->|up| A', cue: 'Both complete labels and physical routes survive. A label must not erase the other relationship when it crosses a parallel run.' },
  { id: 'terminal-intercontainer-label-feasibility', source: 'flowchart LR\nsubgraph one\n A -->|sends| B\nend\nsubgraph two\n C -->|receives| D\nend\nB -->|data| C', cue: 'The data label fits in free space without erasing either container frame. Both internal labels and all three relationships remain visible.' },
  { id: 'terminal-long-reciprocal-label-feasibility', source: `flowchart TD\nA -->|${'a'.repeat(50)}| B\nB -->|return| A`, cue: 'The complete 50-character label fits beside its actual route without erasing the opposite relationship. Placement follows measured demand rather than a fixed search-radius cutoff.' },
  {
    id: 'terminal-nested-external-node-feasibility',
    source: 'flowchart TB\nsubgraph G0[Group 0 日本]\nsubgraph G1[Group 1 日本]\nsubgraph G2[Group 2 日本]\nsubgraph G3[Group 3 日本]\nA[日本語 👩‍💻 long label] -->|handoff labels| B[Wide terminal label]\nend\nend\nend\nend\nB --> C[Finish]',
    cue: 'All nested frames contain their own members and exclude the external Finish card. Its complete label and the outgoing relationship survive without erasing the outer frame.',
  },
  {
    id: 'terminal-interleaved-containment',
    source: 'flowchart TD\nsubgraph Outer\nsubgraph Inner\nA[First]\nB[Last]\nend\nX[Outside]\nend\nA --> X --> B',
    cue: 'A and B belong inside Inner; X belongs inside Outer and wholly outside Inner. Compare the complete frames, label cells, parent references and connected relationship ownership. The baseline containment diagnostic is a refused layout, not successful separation.',
  },
  { id: 'terminal-gitgraph-composite-identities', source: 'gitGraph\ncommit id: "a:b"\ncommit id: "c"\ncommit id: "a"\ncommit id: "b:c"', cue: 'All four commits remain visible. Metadata keeps the distinct a:b→c and a→b:c parent relationships; punctuation must not alias their semantic keys.' },
  {
    id: 'terminal-class-typed-parent',
    source: 'classDiagram\nnamespace A["Container"] {\nclass A["Target"]\n}\nclick A href "https://example.com"',
    cue: 'The class and namespace share raw ID A. Inspect separate node/cluster geometry and parentKind in the sidecar; the public action regression additionally checks node:A→group:A.',
  },
  {
    id: 'terminal-sequence-background-reservations',
    source: 'sequenceDiagram\nparticipant A\nparticipant B\nparticipant C\nactivate B\nalt Complete active fragment header\nA->>C: hello across B\nNote over B: Opaque active note\nend\ndeactivate B',
    cue: 'Complete message, fragment header and note text clear intermediate lifelines and active bands. Intentional background gaps must not produce geometry-collision diagnostics.',
  },
  { id: 'terminal-parallel-reciprocal-capacity', source: parallelReciprocalSource, cue: 'All three complete labels must be attached to their own connected routes and real endpoint markers. Inspect request 1, which the baseline omits, and compare the endpoint/owned-span sidecars.' },
  {
    id: 'terminal-multimember-container-capacity',
    source: 'flowchart TD\nsubgraph G[Header]\nA[Left]\nC[Right]\nend\nG -->|one| B[Outside]\nG -->|two| B\nB -->|back| G',
    cue: 'The semantic endpoint is the complete multi-member G frame, rather than a representative child card. Compare all three attached relationship labels and marker approaches against the actual container face.',
  },
  {
    id: 'terminal-sibling-container-capacity',
    source: 'flowchart TD\nsubgraph G1\nA[Inside one]\nend\nsubgraph G2\nB[Inside two]\nend\nG1 -->|one| G2\nG1 -->|two| G2\nG2 -->|back| G1',
    cue: 'All three relationships connect actual sibling frames. Their measured exterior approaches and complete labels must fit without coincident undeclared runs or losing the return relationship.',
  },
  {
    id: 'terminal-nested-approach-capacity',
    source: 'flowchart TD\nsubgraph Parent[Outer 日本]\nsubgraph Child[Inner 👩‍💻]\nA[Member]\nend\nend\nParent o--o|界 👩‍💻 = é| Child\nParent x--x|again<br>日本| Child\nChild -->|back| Parent\nChild -->|self| Child',
    cue: 'Nested endpoints need compatible marker approaches across different frame faces, as well as valid individual ports. Inspect all four complete relationships, both circle/cross marker ends, multiline wide labels and the reciprocal path through the measured nested-frame corridor.',
  },
  {
    id: 'terminal-compound-parallel-reciprocal',
    source: 'flowchart TD\nsubgraph Outer["外側 👩‍💻<br>é header"]\nsubgraph Inner["内側<br>second"]\nA["日本<br>👩‍💻 é"]\nB[End]\nend\nX[Outside]\nend\nA -->|界 👩‍💻 = é| X\nX -->|back| B\nA -->|again| X\nX -->|return| A\nB -->|self| B',
    cue: 'Combined witness: Inner contains A/B and excludes X; all five parallel, reciprocal and self relationships retain their complete labels and physical endpoints. Inspect multiline CJK/ZWJ/combining text together with actual owned paths. Sidecars preserve baseline refusals honestly; the independent test also checks a hard 200-column width.',
  },
  { id: 'terminal-sankey-public-identities', source: sankeyIdentitySource, cue: 'Compare terminal edge identities/endpoints with the graphical Sankey layout sidecars. Authored names resembling generated IDs stay distinct; the existing complete adjacency text is a compatibility control.' },
]
if (selectedFixtureIds.length > 0) {
  const selected = new Set(selectedFixtureIds)
  for (const id of selected) {
    if (![...fixtures, ...terminalFixtures].some(fixture => fixture.id === id)) throw new Error(`Unknown evidence fixture: ${id}`)
  }
  fixtures.splice(0, fixtures.length, ...fixtures.filter(fixture => selected.has(fixture.id)))
  terminalFixtures.splice(0, terminalFixtures.length, ...terminalFixtures.filter(fixture => selected.has(fixture.id)))
}
const fixtureOptions = Object.fromEntries(
  fixtures.map(fixture => {
    const svg = { security: 'strict' as const, ...fixture.renderOptions }
    return [
      fixture.id,
      {
        svg,
        png: { ...svg, background: svg.transparent ? '#00000000' : '#ffffff', ...(fixture.pngWidth ? { fitTo: { width: fixture.pngWidth } } : {}), ...(fixture.pngScale !== undefined ? { scale: fixture.pngScale } : {}) },
        ...(fixture.measurementProfile ? { measurementProfile: { kind: fixture.measurementProfile, ...measurementProfiles[fixture.measurementProfile] } } : {}),
      },
    ]
  }),
)
interface Evidence {
  svg?: string
  png?: string
  layout?: unknown
  source?: string
  edit?: unknown
  error?: string
}
interface TerminalEvidence {
  ascii?: string
  html?: string
  meta?: unknown
  error?: string
}
interface RevisionEvidence {
  renders: Record<string, Evidence>
  terminals: Record<string, TerminalEvidence>
  classExport: string
}

function renderRevision(sha: string): RevisionEvidence {
  const directory = mkdtempSync(join(tmpdir(), 'am-meaning-review-'))
  const checkout = join(directory, 'checkout')
  execFileSync('git', ['worktree', 'add', '--detach', checkout, sha], { cwd: ROOT, stdio: 'pipe' })
  try {
    symlinkSync(join(ROOT, 'node_modules'), join(checkout, 'node_modules'), 'dir')
    writeFileSync(
      join(checkout, 'probe.ts'),
      `
      import { writeFileSync } from 'node:fs'
      import { renderMermaidSVG, renderMermaidPNG, createMermaidPNGRenderer, layoutMermaidWithReceipt, parseRegisteredMermaid, asClass, asSequence, mutate, serializeMermaid, describeMermaidFacts } from './src/agent/index.ts'
      import { createMermaidRenderer } from './src/index.ts'
      import { renderMermaidASCIIWithMeta } from './src/ascii/meta.ts'
      const fixtures = ${JSON.stringify(fixtures)}
      const fixtureOptions = ${JSON.stringify(fixtureOptions)}
      const renders = {}
      const terminals = {}
      for (const fixture of fixtures) {
        try {
          let input = fixture.source
          let edit
          if (fixture.classMutation) {
            const parsed = parseRegisteredMermaid(fixture.source)
            if (!parsed.ok) throw new Error('Class edit witness did not parse')
            const diagram = asClass(parsed.value)
            if (!diagram) throw new Error('Class edit witness was not editable')
            const edited = mutate(diagram, fixture.classMutation)
            if (!edited.ok) throw new Error(edited.error.message)
            input = serializeMermaid(edited.value)
          } else if (fixture.mutation) {
            const parsed = parseRegisteredMermaid(fixture.source)
            if (!parsed.ok) throw new Error('Edit witness did not parse')
            if (fixture.directFragmentLabel !== undefined) {
              const fragment = asSequence(parsed.value)?.body.statements.find(statement => statement.kind === 'fragment')
              if (!fragment) throw new Error('Sequence edit witness had no fragment')
              fragment.fragment.label = fixture.directFragmentLabel
            }
            const edited = mutate(parsed.value, fixture.mutation)
            if (!edited.ok) throw new Error(edited.error.message)
            input = serializeMermaid(edited.value)
            const reloaded = parseRegisteredMermaid(input)
            if (!reloaded.ok) throw new Error('Edited source did not reload')
            edit = {
              facts: describeMermaidFacts(edited.value),
              reloadedFacts: describeMermaidFacts(reloaded.value),
              ...(edited.value.body.kind === 'er' ? { entityOrder: edited.value.body.entities.map(entity => entity.id) } : {}),
              ...(reloaded.value.body.kind === 'er' ? { reloadedEntityOrder: reloaded.value.body.entities.map(entity => entity.id) } : {}),
            }
          }
          const measurement = fixtureOptions[fixture.id].measurementProfile
          const host = measurement ? { textMeasurement: {
            id: measurement.id, version: measurement.version,
            measure: ({ text, fontWeight }) => text.length > 1 ? measurement.wholeStringWidth : fontWeight >= 700 ? measurement.boldGlyphWidth : measurement.glyphWidth,
          } } : undefined
          renders[fixture.id] = {
            svg: host ? createMermaidRenderer(host).renderMermaidSVG(input, fixtureOptions[fixture.id].svg) : renderMermaidSVG(input, fixtureOptions[fixture.id].svg),
            png: Buffer.from(host ? createMermaidPNGRenderer(host).renderMermaidPNG(input, fixtureOptions[fixture.id].png) : renderMermaidPNG(input, fixtureOptions[fixture.id].png)).toString('base64'),
            ...(fixture.classMutation || fixture.mutation ? { source: input } : {}),
            ...(edit ? { edit } : {}),
            ...(fixture.captureLayout ? { layout: layoutMermaidWithReceipt(input, { ...fixtureOptions[fixture.id].svg, regions: true }).layout } : {}),
          }
        } catch (error) { renders[fixture.id] = { error: String(error) } }
      }
      for (const fixture of ${JSON.stringify(terminalFixtures)}) {
        try {
          const plain = renderMermaidASCIIWithMeta(fixture.source, { colorMode: 'none', useAscii: true })
          const colored = renderMermaidASCIIWithMeta(fixture.source, { colorMode: 'html', useAscii: false })
          const failure = [...plain.warnings, ...colored.warnings].find(warning => warning.code === 'ASCII_RENDER_FAILED')
          terminals[fixture.id] = { ascii: plain.ascii, html: colored.ascii, ...(failure ? { error: failure.message } : {}), meta: { ascii: plain.regions, unicode: colored.regions, warnings: colored.warnings } }
        } catch (error) { terminals[fixture.id] = { error: String(error) } }
      }
      const parsed = parseRegisteredMermaid('classDiagram\\nnamespace N {\\nclass A\\n}\\nclass B')
      if (!parsed.ok) throw new Error('Class witness did not parse')
      const diagram = asClass(parsed.value)
      if (!diagram) throw new Error('Class witness was not editable')
      const edited = mutate(diagram, { kind: 'remove_class', id: 'A' })
      if (!edited.ok) throw new Error(edited.error.message)
      writeFileSync('probe-result.json', JSON.stringify({ renders, terminals, classExport: serializeMermaid(edited.value) }))
    `,
    )
    execFileSync(process.execPath, ['probe.ts'], { cwd: checkout, stdio: 'pipe' })
    return JSON.parse(readFileSync(join(checkout, 'probe-result.json'), 'utf8')) as RevisionEvidence
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', checkout], { cwd: ROOT, stdio: 'pipe' })
    rmSync(directory, { recursive: true, force: true })
  }
}

const revisions = { before: renderRevision(base), after: renderRevision(head) }
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rows = fixtures
  .map(fixture => {
    writeFileSync(join(out, `${fixture.id}.mmd`), `${fixture.source}\n`)
    const panels = (['before', 'after'] as const)
      .map(phase => {
        const result = revisions[phase].renders[fixture.id]!
        if (result.svg && result.png) {
          writeFileSync(join(out, `${fixture.id}-${phase}.svg`), result.svg)
          writeFileSync(join(out, `${fixture.id}-${phase}.png`), Buffer.from(result.png, 'base64'))
        }
        if (result.layout) writeFileSync(join(out, `${fixture.id}-${phase}-layout.json`), JSON.stringify(result.layout, null, 2))
        if (result.source) writeFileSync(join(out, `${fixture.id}-${phase}-export.mmd`), result.source)
        if (result.edit) writeFileSync(join(out, `${fixture.id}-${phase}-edit.json`), JSON.stringify(result.edit, null, 2))
        const semanticSidecar = result.layout ? `<p><a href="${fixture.id}-${phase}-layout.json">${phase} public layout identities and regions</a></p>` : ''
        const editSidecar = result.edit ? `<p><a href="${fixture.id}-${phase}-edit.json">${phase} typed and reloaded edit facts/order</a></p><pre>${esc(JSON.stringify(result.edit, null, 2))}</pre>` : ''
        const exportedSource = result.source ? `<p><a href="${fixture.id}-${phase}-export.mmd">${phase} exported Mermaid source</a></p><pre>${esc(result.source)}</pre>` : ''
        return `<figure${fixture.renderOptions?.transparent ? ' class="transparent"' : ''}><figcaption>${phase}</figcaption>${
          result.png ? `<img alt="${phase}: ${esc(fixture.title)}" src="data:image/png;base64,${result.png}">` : `<pre>${esc(result.error ?? 'No render')}</pre>`
        }${semanticSidecar}${editSidecar}${exportedSource}</figure>`
      })
      .join('')
    const optionsCaption =
      (fixture.renderOptions ? `<p>Render options at both revisions: <code>${esc(JSON.stringify(fixture.renderOptions))}</code>.</p>` : '') +
      (fixture.pngWidth ? `<p>PNG previews are scaled to ${fixture.pngWidth}px wide at both revisions; SVG and layout sidecars retain native geometry.</p>` : '') +
      (fixture.pngScale !== undefined ? `<p>PNG scale at both revisions: ${fixture.pngScale}.</p>` : '') +
      (fixture.measurementProfile ? `<p>Host measurement profile at both revisions: <code>${esc(JSON.stringify({ kind: fixture.measurementProfile, ...measurementProfiles[fixture.measurementProfile] }))}</code>. The callback is bound through the public renderer constructors.</p>` : '')
    const mutation = fixture.classMutation ?? fixture.mutation
    const mutationCaption = mutation ? `<p>${fixture.classMutation ? 'Class edit' : 'Edit'} at both revisions: <code>${esc(JSON.stringify(mutation))}</code>.</p>` : ''
    return `<section><h2>${fixture.title}</h2><p>${fixture.cue}</p>${optionsCaption}${mutationCaption}<div class="pair">${panels}</div></section>`
  })
  .join('')
const terminalRows = terminalFixtures
  .map(fixture => {
    writeFileSync(join(out, `${fixture.id}.mmd`), `${fixture.source}\n`)
    const panels = (['before', 'after'] as const)
      .map(phase => {
        const result = revisions[phase].terminals[fixture.id]!
        writeFileSync(join(out, `${fixture.id}-${phase}.txt`), result.ascii ?? result.error ?? 'No output')
        writeFileSync(join(out, `${fixture.id}-${phase}-meta.json`), JSON.stringify(result.meta ?? result.error, null, 2))
        return `<figure><figcaption>${phase}</figcaption><pre class="terminal">${result.error ? esc(result.error) : (result.html ?? 'Empty output')}</pre></figure>`
      })
      .join('')
    return `<section><h2>${fixture.id}</h2><p>${esc(fixture.cue)}</p><div class="pair">${panels}</div></section>`
  })
  .join('')
for (const phase of ['before', 'after'] as const) writeFileSync(join(out, `class-export-${phase}.mmd`), revisions[phase].classExport)
writeFileSync(
  join(out, 'review.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Diagram meaning: before and after</title><style>body{font:16px/1.5 system-ui;margin:40px auto;padding:0 24px;max-width:1100px;color:#222;background:white}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{border-top:1px solid #ddd;margin-top:32px}figure{margin:0}figcaption{font-weight:bold}img{display:block;width:100%;height:auto}figure.transparent img{background-color:white;background-image:conic-gradient(#ddd 25%,transparent 0 50%,#ddd 0 75%,transparent 0);background-size:16px 16px}pre{white-space:pre-wrap;background:#f6f6f6;padding:16px}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>Diagram meaning: before and after</h1><p>Baseline SHA: <code>${base}</code><br>Head SHA: <code>${head}</code></p><p>Same sources and render options at both revisions, with strict security and bundled PNG fonts. Default style and opaque PNGs use a white background unless a fixture states otherwise; explicit options are shown beside that fixture and recorded in receipt.json. Captions identify repair witnesses, host-measurement stress profiles and artwork-preservation controls. Historical fixtures and the final Class export may already be fixed at this baseline; only the displayed outputs establish a difference between these revisions. Focused witnesses do not prove all-layout or cross-platform visual parity.</p>${rows}<section><h2>Class export after deleting A</h2><p>Compare the serialized result after deleting A: class B should remain and the empty namespace should be omitted.</p><div class="pair"><pre>${esc(revisions.before.classExport)}</pre><pre>${esc(revisions.after.classExport)}</pre></div></section></html>`,
)
writeFileSync(
  join(out, 'terminal-review.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Terminal composition review</title><style>body{font:16px/1.5 system-ui;margin:32px;color:#222;background:white}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{min-width:0;margin:0}pre.terminal{white-space:pre;overflow:auto;font:12px/1.3 Menlo,Consolas,monospace;background:#f7f7f7;padding:12px}section{border-top:1px solid #ddd;margin-top:24px}</style><h1>Terminal composition: same input before and after</h1><p>Baseline SHA: ${base}<br>Head SHA: ${head}<br>Bun: ${Bun.version}</p><p>Production ASCII text files and exact metadata accompany every pair. Browser monospace/font coverage is a visual limitation; independent owned-cell and grapheme tests establish logical geometry and encoding parity.</p>${terminalRows}</html>`,
)
writeFileSync(
  join(out, 'receipt.json'),
  JSON.stringify(
    {
      base,
      head,
      bun: Bun.version,
      fixtures: fixtures.map(fixture => fixture.id),
      sources: Object.fromEntries(fixtures.map(fixture => [fixture.id, fixture.source])),
      terminalFixtures: terminalFixtures.map(fixture => fixture.id),
      terminalOptions: { ascii: { colorMode: 'none', useAscii: true }, unicode: { colorMode: 'html', useAscii: false } },
      options: { security: 'strict', style: 'default unless fixtureOptions overrides it', fonts: 'bundled' },
      fixtureOptions,
    },
    null,
    2,
  ) + '\n',
)
console.log(`Wrote immutable before/after evidence to ${out}`)
