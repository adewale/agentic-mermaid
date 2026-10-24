// This import installs every complete descriptor before the single-file worker
// exports its ready loaders; hosted descriptors need not be bundled as well.
import { knownBuiltinFamilies } from './agent/families.ts'

const load = async (): Promise<void> => {}
export const VERIFIED_FAMILY_LOADERS: Readonly<Record<string, () => Promise<void>>> =
  Object.fromEntries(knownBuiltinFamilies().map(id => [id, load]))
