// Node twin of `elk-constructor.ts` (see there), shipped verbatim rather than
// bundled. A bundler that inlines it sees the literal require below and
// bundles elkjs; an unbundled ES module under Node has no `require`, so it
// loads elkjs through createRequire the first time a family lays out with it.
import { createRequire } from 'node:module'

export function elkConstructor() {
  return typeof require === 'function'
    ? require('elkjs/lib/elk.bundled.js')
    : createRequire(import.meta.url)('elkjs/lib/elk.bundled.js')
}
