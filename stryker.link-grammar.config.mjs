import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { markedMutationScopes } from './scripts/quality/marked-mutation-scopes.mjs'

const root = dirname(fileURLToPath(import.meta.url))

export default {
  $schema: 'https://raw.githubusercontent.com/stryker-mutator/stryker/master/packages/core/schema/stryker-core.schema.json',
  _comment: 'Narrow mutation lane for Mermaid link-length parsing and layout. Source-adjacent markers make the ranges move with the behavior.',
  mutate: markedMutationScopes(root, [
    { file: 'src/parser.ts', marker: 'text-embedded-link-length' },
    { file: 'src/layout/passes/index.ts', marker: 'feedback-link-rank-distance' },
    { file: 'src/layout/passes/index.ts', marker: 'link-rank-packing-closure' },
  ]),
  ignorePatterns: ['/site/**', '/dist/**', '/coverage/**', '/index.html', '/editor.html', '/.stryker-tmp-*/**'],
  testRunner: 'command',
  commandRunner: {
    command: 'bun test src/__tests__/link-grammar.test.ts src/__tests__/linkrank-packing.test.ts src/__tests__/mermaid-conformance.test.ts',
  },
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/link-grammar-mutation.json',
  },
  timeoutMS: 30000,
  concurrency: 4,
  tempDirName: '.stryker-tmp-link-grammar',
  disableTypeChecks: true,
}
