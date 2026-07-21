import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { markedMutationScopes } from './scripts/quality/marked-mutation-scopes.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const schema = 'https://raw.githubusercontent.com/stryker-mutator/stryker/master/packages/core/schema/stryker-core.schema.json'
const commonIgnores = ['/site/**', '/dist/**', '/coverage/**', '/index.html', '/editor.html', '/.stryker-tmp-*/**']

function profile(name, mutate, tests, options = {}) {
  const slug = name.replaceAll(':', '-')
  return {
    $schema: schema,
    mutate,
    ignorePatterns: commonIgnores,
    testRunner: 'command',
    commandRunner: { command: `bun test ${tests}` },
    reporters: ['clear-text', 'progress', 'json'],
    jsonReporter: { fileName: `reports/mutation/${slug}-mutation.json` },
    timeoutMS: options.timeoutMS ?? 30_000,
    concurrency: options.concurrency ?? 2,
    tempDirName: `.stryker-tmp-${slug}`,
    disableTypeChecks: true,
    ...(options.thresholds ? { thresholds: options.thresholds } : {}),
  }
}

export const MUTATION_PROFILES = Object.freeze({
  core: profile('core', ['src/renderer.ts', 'src/theme.ts', 'src/parser.ts', 'src/styles.ts'],
    'src/__tests__/renderer.test.ts src/__tests__/styles.test.ts src/__tests__/parser.test.ts src/__tests__/property-svg-wellformedness.test.ts', { concurrency: 4 }),
  incremental: profile('incremental', ['src/agent/structural-count.ts'],
    'src/__tests__/structural-count.test.ts', { concurrency: 4, thresholds: { high: 97, low: 92, break: 90 } }),
  characterization: profile('characterization', [
    'src/ascii/pathfinder.ts:60-63', 'src/ascii/pathfinder.ts:110-129', 'src/ascii/grid.ts:539-539',
    'src/ascii/grid.ts:569-576', 'src/ascii/edge-routing.ts:285-296',
  ], 'src/__tests__/characterization-layout.test.ts src/__tests__/property-ascii-routing.test.ts src/__tests__/ascii-pathfinder-determinism.test.ts src/__tests__/ascii-pathfinder-units.test.ts src/__tests__/ascii-fanout-trunk-labeled.test.ts src/__tests__/ascii-subgraph-edge.test.ts src/__tests__/ascii-layout-gaps.test.ts', { timeoutMS: 60_000, concurrency: 4 }),
  ascii: profile('ascii', [
    'src/ascii/pathfinder.ts', 'src/ascii/edge-routing.ts', 'src/ascii/converter.ts', 'src/ascii/grid.ts', 'src/ascii/draw.ts',
  ], 'src/__tests__/ascii.test.ts src/__tests__/ascii-subgraph-edge.test.ts src/__tests__/ascii-layout-gaps.test.ts src/__tests__/ascii-fan-in-grouping.test.ts src/__tests__/ascii-fanout-trunk-labeled.test.ts src/__tests__/ascii-pathfinder-determinism.test.ts src/__tests__/ascii-pathfinder-units.test.ts src/__tests__/ascii-pathfinder-trunk.test.ts src/__tests__/ascii-determinism.test.ts src/__tests__/ascii-box-start.test.ts src/__tests__/ascii-edge-styles.test.ts src/__tests__/ascii-multiline.test.ts src/__tests__/ascii-robustness.test.ts src/__tests__/ascii-sequence-blocks.test.ts src/__tests__/subgraph-direction.test.ts src/__tests__/property-ascii-routing.test.ts', { timeoutMS: 60_000, concurrency: 4 }),
  families: profile('families', [
    'src/xychart/parser.ts', 'src/xychart/layout.ts', 'src/xychart/renderer.ts',
    'src/architecture/parser.ts', 'src/architecture/layout.ts', 'src/architecture/renderer.ts',
    'src/mindmap/parser.ts', 'src/mindmap/layout.ts', 'src/mindmap/renderer.ts',
    'src/gitgraph/parser.ts', 'src/gitgraph/layout.ts', 'src/gitgraph/renderer.ts',
    'src/radar/parser.ts', 'src/radar/layout.ts', 'src/radar/renderer.ts', 'src/agent/radar-body.ts',
  ], 'src/__tests__/xychart-parser.test.ts src/__tests__/xychart-layout.test.ts src/__tests__/xychart-renderer.test.ts src/__tests__/xychart-integration.test.ts src/__tests__/xychart-svg-snapshot.test.ts src/__tests__/xychart-ascii.test.ts src/__tests__/property-xychart.test.ts src/__tests__/architecture-parser.test.ts src/__tests__/architecture-layout.test.ts src/__tests__/architecture-renderer.test.ts src/__tests__/architecture-integration.test.ts src/__tests__/architecture-config.test.ts src/__tests__/architecture-theme.test.ts src/__tests__/architecture-svg-snapshot.test.ts src/__tests__/architecture-ascii.test.ts src/__tests__/mindmap-gitgraph-citizenship.test.ts src/__tests__/radar-parser.test.ts src/__tests__/radar-integration.test.ts src/__tests__/radar-renderer.test.ts src/__tests__/radar-ascii.test.ts src/__tests__/radar-config.test.ts src/__tests__/agent-radar.test.ts'),
  routes: profile('routes', ['src/route-contracts.ts'], 'src/__tests__/route-contracts.test.ts', { timeoutMS: 60_000, concurrency: 4 }),
  'routes:certs': profile('routes:certs', markedMutationScopes(root, [
    { file: 'src/route-contracts.ts', marker: 'route-certificate-finality' },
    { file: 'src/route-contracts.ts', marker: 'stale-route-audit' },
  ]), 'src/__tests__/route-contracts.test.ts --timeout 120000', { concurrency: 4 }),
  'routes:subgraph': profile('routes:subgraph', markedMutationScopes(root, [
    { file: 'src/layout-engine.ts', marker: 'subgraph-edge-classification' },
    { file: 'src/layout-engine.ts', marker: 'subgraph-lowest-common-ancestor' },
  ]), 'src/__tests__/subgraph-direction.test.ts src/__tests__/subgraph-hierarchy-exhaustive.test.ts --timeout 120000', { concurrency: 4 }),
  links: profile('links', markedMutationScopes(root, [
    { file: 'src/parser.ts', marker: 'text-embedded-link-length' },
    { file: 'src/layout/passes/index.ts', marker: 'feedback-link-rank-distance' },
    { file: 'src/layout/passes/index.ts', marker: 'link-rank-packing-closure' },
  ]), 'src/__tests__/link-grammar.test.ts src/__tests__/linkrank-packing.test.ts src/__tests__/mermaid-conformance.test.ts', { concurrency: 4 }),
  state: profile('state', ['src/agent/state-body.ts'], 'src/__tests__/agent-state.test.ts src/__tests__/agent-mermaid-corpus.test.ts src/__tests__/agent-ascii-meta.test.ts'),
  sequence: profile('sequence', ['src/agent/sequence-body.ts', 'src/sequence/parser.ts'], 'src/__tests__/agent.test.ts src/__tests__/sequence-parser.test.ts src/__tests__/sequence-integration.test.ts src/__tests__/ascii-sequence-blocks.test.ts src/__tests__/agent-mermaidseqbench.test.ts'),
  timeline: profile('timeline', ['src/agent/timeline-body.ts', 'src/timeline/parser.ts', 'src/timeline/layout.ts'], 'src/__tests__/agent-timeline.test.ts src/__tests__/timeline-parser.test.ts src/__tests__/timeline-layout.test.ts src/__tests__/timeline-ascii.test.ts'),
  class: profile('class', ['src/agent/class-body.ts', 'src/class/parser.ts', 'src/class/layout.ts'], 'src/__tests__/agent-class.test.ts src/__tests__/class-parser.test.ts src/__tests__/class-integration.test.ts src/__tests__/class-er-edge-quality.test.ts'),
  er: profile('er', ['src/agent/er-body.ts', 'src/er/parser.ts', 'src/er/layout.ts'], 'src/__tests__/agent-er.test.ts src/__tests__/er-parser.test.ts src/__tests__/er-integration.test.ts src/__tests__/class-er-edge-quality.test.ts'),
  journey: profile('journey', ['src/agent/journey-body.ts', 'src/journey/parse-core.ts', 'src/journey/parser.ts', 'src/journey/layout.ts', 'src/journey/renderer.ts'], 'src/__tests__/agent-journey.test.ts src/__tests__/journey-parse-core.test.ts src/__tests__/journey-parser.test.ts src/__tests__/journey-layout.test.ts src/__tests__/journey-layout-quality.test.ts src/__tests__/journey-ascii.test.ts src/__tests__/journey-svg-snapshot.test.ts src/__tests__/journey-theme.test.ts src/__tests__/journey-integration.test.ts src/__tests__/family-rubric.test.ts'),
  pie: profile('pie', ['src/agent/pie-body.ts', 'src/pie/parser.ts', 'src/pie/layout.ts'], 'src/__tests__/agent-pie.test.ts src/__tests__/pie.test.ts src/__tests__/agent-mermaid-corpus.test.ts'),
  quadrant: profile('quadrant', ['src/agent/quadrant-body.ts', 'src/quadrant/parser.ts', 'src/quadrant/layout.ts'], 'src/__tests__/agent-quadrant.test.ts src/__tests__/quadrant.test.ts src/__tests__/agent-mermaid-corpus.test.ts'),
  mindmap: profile('mindmap', ['src/agent/mindmap-body.ts'], 'src/__tests__/mindmap-agent-ops.test.ts src/__tests__/mindmap-gitgraph-citizenship.test.ts'),
  gitgraph: profile('gitgraph', ['src/agent/gitgraph-body.ts'], 'src/__tests__/gitgraph-agent-ops.test.ts src/__tests__/mindmap-gitgraph-citizenship.test.ts'),
  gantt: profile('gantt', ['src/gantt/parser.ts', 'src/gantt/schedule.ts', 'src/gantt/layout.ts', 'src/ascii/gantt.ts', 'src/agent/gantt-body.ts'], 'src/__tests__/gantt-parser.test.ts src/__tests__/gantt-schedule.test.ts src/__tests__/gantt-layout.test.ts src/__tests__/gantt-svg-snapshot.test.ts src/__tests__/property-gantt-schedule.test.ts src/__tests__/agent-gantt.test.ts src/__tests__/ascii.test.ts'),
})

const selected = process.env.AM_MUTATION_PROFILE ?? 'core'
if (!Object.hasOwn(MUTATION_PROFILES, selected)) {
  throw new Error(`Unknown mutation profile "${selected}". Choose one of: ${Object.keys(MUTATION_PROFILES).join(', ')}`)
}

export default MUTATION_PROFILES[selected]
