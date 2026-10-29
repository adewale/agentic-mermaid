// The single-file worker accepts source/options/output operations only. Install
// the same source hooks as the hosted loaders in the shared family registry.
import { installBuiltinFamily, knownBuiltinFamilies } from './agent/family-registry.ts'
import { BUILTIN_SOURCE_HOOKS } from './agent/families-source-hooks.ts'
import { BUILTIN_RENDER_HOOKS } from './render-family-hooks.ts'

for (const id of knownBuiltinFamilies()) installBuiltinFamily(id, { ...BUILTIN_SOURCE_HOOKS[id], ...BUILTIN_RENDER_HOOKS[id] })

const load = async (): Promise<void> => {}
export const VERIFIED_FAMILY_LOADERS: Readonly<Record<string, () => Promise<void>>> =
  Object.fromEntries(knownBuiltinFamilies().map(id => [id, load]))
