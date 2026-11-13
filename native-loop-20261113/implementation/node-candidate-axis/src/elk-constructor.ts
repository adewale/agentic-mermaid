// The ELK constructor, bundled with the importing module. Browser and workerd
// bundles, the single binary and source runs use this file. The published
// Node entries reach it as `#elk-constructor`, which resolves to the
// `elk-constructor.node.js` twin under the `node` condition so that Node and
// Bun load elkjs (~110 ms and ~7 MiB) only when a family first lays out with it.

// @ts-ignore — static import of bundled ELK
import ELKBundled from 'elkjs/lib/elk.bundled.js'

export function elkConstructor(): new () => unknown {
  return ELKBundled as new () => unknown
}
