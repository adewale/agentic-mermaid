import { BUILTIN_FAMILY_METADATA } from './agent/families.ts'

export const EDITOR_SUPPORTED_HEADER_TOKENS = BUILTIN_FAMILY_METADATA
  .flatMap(family => family.headers)
  .map(header => header.toLowerCase())

const familyLabels = BUILTIN_FAMILY_METADATA.map(family => family.headers.join(' / '))
export const EDITOR_SUPPORTED_FAMILY_LIST = familyLabels.length < 2
  ? familyLabels.join('')
  : `${familyLabels.slice(0, -1).join(', ')}, and ${familyLabels.at(-1)}`
