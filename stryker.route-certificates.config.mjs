import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { markedMutationScopes } from './scripts/quality/marked-mutation-scopes.mjs'

const root = dirname(fileURLToPath(import.meta.url))

export default {
  $schema: 'https://raw.githubusercontent.com/stryker-mutator/stryker/master/packages/core/schema/stryker-core.schema.json',
  _comment: 'Narrow mutation lane for route-certificate finality and stale-route audit tripwires. Source-adjacent markers make the ranges move with the behavior.',
  mutate: markedMutationScopes(root, [
    { file: 'src/route-contracts.ts', marker: 'route-certificate-finality' },
    { file: 'src/route-contracts.ts', marker: 'stale-route-audit' },
  ]),
  ignorePatterns: ['/site/**', '/dist/**', '/coverage/**', '/index.html', '/editor.html', '/.stryker-tmp-*/**'],
  testRunner: 'command',
  commandRunner: {
    command: 'bun test src/__tests__/route-contracts.test.ts --timeout 120000',
  },
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/route-certificates-mutation.json',
  },
  timeoutMS: 30000,
  concurrency: 4,
  tempDirName: '.stryker-tmp-route-certificates',
  disableTypeChecks: true,
}
