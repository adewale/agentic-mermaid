/** One enrollment authority for the first-party graphical backends.
 *
 * Backend implementations stay importable as inert values. Runtime entry
 * points that offer built-in rendering import this module once, so discovery
 * no longer depends on whichever implementation happened to be imported.
 */

import { DefaultBackend, registerBuiltInBackend } from './backend.ts'
import { RoughBackend } from './rough-backend.ts'
import { HybridBackend } from './hybrid-backend.ts'

export const BUILTIN_BACKENDS = Object.freeze([
  DefaultBackend,
  RoughBackend,
  HybridBackend,
] as const)

for (const backend of BUILTIN_BACKENDS) registerBuiltInBackend(backend)
