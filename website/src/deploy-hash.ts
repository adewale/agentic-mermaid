// Build-time deploy identity. NOT a runtime worker module — build.ts and the
// deploy-hash tests import it; the worker imports only the generated constant
// it produces (generated/deploy-version.ts). Keep it out of the worker's
// import closure so it never pulls node:crypto into workerd, and so the
// worker bundle it hashes does not depend on the hasher itself.

import { createHash } from 'node:crypto'

/**
 * A single content hash over every part of the deployed compute that can
 * change a cached tools/call response: the bundled worker JS closure
 * (transport, hosted-server, PNG path, raster budget, SDK), the Code Mode
 * harness, the resvg wasm module, the fonts, and the main worker's
 * compatibility_date (a deploy-controlled runtime input outside every
 * artifact). Any of them changing — with or without a package-version bump —
 * moves the version and invalidates the /mcp response cache. Deterministic:
 * same inputs → same output. `parts` is caller-defined and order-fixed; the
 * hasher itself is agnostic to what each part is.
 */
export function computeDeployVersion(version: string, parts: Uint8Array[]): string {
  const h = createHash('sha256')
  // Length-prefix each part so boundaries are unambiguous: without it,
  // hash(['ab','']) would equal hash(['a','b']) (update() just streams bytes),
  // letting a byte migrate across the worker/harness/asset boundary unnoticed.
  const len = new Uint8Array(8)
  const view = new DataView(len.buffer)
  for (const part of parts) {
    view.setBigUint64(0, BigInt(part.byteLength), false)
    h.update(len)
    h.update(part)
  }
  return `v${version}-${h.digest('hex').slice(0, 24)}`
}
