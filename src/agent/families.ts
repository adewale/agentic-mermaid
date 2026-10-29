// Full-library entry. Hosted workers resolve the same registry without eager
// implementations and install each complete family on demand.
import { installBuiltinFamily, knownBuiltinFamilies } from './family-registry.ts'
import { BUILTIN_AGENT_HOOKS } from './families-builtin.ts'
import { BUILTIN_RENDER_HOOKS } from '../render-family-hooks.ts'
export * from './family-registry.ts'

for (const id of knownBuiltinFamilies()) installBuiltinFamily(id, { ...BUILTIN_AGENT_HOOKS[id], ...BUILTIN_RENDER_HOOKS[id] })
