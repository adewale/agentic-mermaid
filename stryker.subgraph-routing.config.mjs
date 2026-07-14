import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { markedMutationScopes } from './scripts/quality/marked-mutation-scopes.mjs'

const root = dirname(fileURLToPath(import.meta.url))

export default {
  $schema: 'https://raw.githubusercontent.com/stryker-mutator/stryker/master/packages/core/schema/stryker-core.schema.json',
  _comment: 'Narrow mutation lane for nested subgraph endpoint classification, LCA hosting, and cross-hierarchy edge extraction. Source-adjacent markers make the ranges move with the behavior.',
  mutate: markedMutationScopes(root, [
    { file: 'src/layout-engine.ts', marker: 'subgraph-edge-classification' },
    { file: 'src/layout-engine.ts', marker: 'subgraph-lowest-common-ancestor' },
  ]),
  ignorePatterns: ['/site/**', '/dist/**', '/coverage/**', '/index.html', '/editor.html', '/.stryker-tmp-*/**'],
  testRunner: 'command',
  commandRunner: {
    command: 'bun test src/__tests__/subgraph-direction.test.ts src/__tests__/subgraph-hierarchy-exhaustive.test.ts --timeout 120000',
  },
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/subgraph-routing-mutation.json',
  },
  timeoutMS: 30000,
  concurrency: 4,
  tempDirName: '.stryker-tmp-subgraph-routing',
  disableTypeChecks: true,
}
