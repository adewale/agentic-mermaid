import { generatedIds } from '../shared/generated-identity.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { parseClassShorthandStatement } from '../shared/mermaid-identifiers.ts'
import {
  isConcurrencySeparator, isHistoryEndpoint, matchNoteLine, matchNoteOpen,
  matchStateDeclarationLine, matchStereotypeDecl, matchTransitionLine,
  STATE_ALIAS_RE, STATE_COMPOSITE_OPEN_RE, STATE_DESCRIPTION_RE, type StateStatement,
} from './parse-core.ts'
import type { StateScope } from './types.ts'
export type { StateScope } from './types.ts'

/** Authored identities and contextual endpoints are resolved before either
 * projection creates nodes. A later composite definition extends the same
 * identity, retaining the first composite/region that referenced it. */
export function resolveStateIdentities(statements: readonly StateStatement[]) {
  const compositeIds = new Set<string>()
  for (const statement of statements) {
    const open = statement.noteBody ? null : statement.text.match(STATE_COMPOSITE_OPEN_RE)
    if (open) compositeIds.add(open[2]!)
  }
  const reserved = new Set(compositeIds)
  const owners = new Map<string, StateScope | undefined>()
  const contexts = new Map<StateStatement, StateScope | undefined>()
  const lastRegions = new Map<string, number>()
  const stack: Array<{ parent: string; region: number }> = []
  let issue: string | undefined
  const mention = (id: string, scope: StateScope | undefined): void => {
    reserved.add(id)
    if (scope && !owners.has(id) && !stack.some(frame => frame.parent === id)) owners.set(id, scope)
  }
  for (const statement of statements) {
    const frame = stack.at(-1)
    const scope = frame ? { parent: frame.parent, region: frame.region } : undefined
    contexts.set(statement, scope)
    if (statement.noteBody) continue
    const line = statement.text
    const open = line.match(STATE_COMPOSITE_OPEN_RE)
    if (open) {
      const id = open[2]!
      if (stack.some(frame => frame.parent === id)) {
        issue = `Duplicate State composite identity "${id}" cannot contain itself`
        break
      }
      mention(id, scope)
      // An explicit root block is a placement, unlike a root reference.
      // Reopening that block elsewhere extends it without moving it.
      if (!owners.has(id)) owners.set(id, scope)
      assertDiagramWorkLimit('nesting', stack.length + 1)
      stack.push({ parent: id, region: lastRegions.get(id) ?? 0 })
      continue
    }
    if (line === '}') { stack.pop(); continue }
    if (isConcurrencySeparator(line) && frame) {
      lastRegions.set(frame.parent, ++frame.region)
      continue
    }
    const transition = matchTransitionLine(line)
    if (transition) {
      for (const id of [transition.from, transition.to]) if (id !== '[*]' && !isHistoryEndpoint(id)) mention(id, scope)
      continue
    }
    const id = matchNoteLine(line)?.target ?? matchNoteOpen(line)?.target
      ?? matchStereotypeDecl(line)?.id ?? parseClassShorthandStatement(line)?.id
      ?? line.match(STATE_ALIAS_RE)?.[2] ?? line.match(STATE_DESCRIPTION_RE)?.[1]
      ?? matchStateDeclarationLine(line)
    if (id) mention(id, scope)
  }
  const normalized = (scope: StateScope | undefined): StateScope | undefined => scope
    ? { parent: scope.parent, ...((lastRegions.get(scope.parent) ?? 0) > 0 ? { region: scope.region ?? 0 } : {}) }
    : undefined
  const allocate = generatedIds(reserved)
  const regionId = (parent: string, region: number): string => allocate(`${parent}__r${region + 1}`, ['state-region', parent, region])
  const scopeId = (scope: StateScope): string => scope.region === undefined ? scope.parent : regionId(scope.parent, scope.region)
  // References between separately declared composites must not create a
  // containment cycle, even though their textual blocks are balanced.
  const depths = new Map<string, number>()
  for (const id of compositeIds) {
    if (issue || depths.has(id)) continue
    const path: string[] = [], seen = new Set<string>()
    let current: string | undefined = id
    while (current !== undefined && !depths.has(current)) {
      if (seen.has(current)) { issue = `State containment cycle: ${[...path, current].join(' -> ')}`; break }
      seen.add(current); path.push(current)
      current = owners.get(current)?.parent
    }
    if (issue) break
    let depth = current === undefined ? 0 : depths.get(current)!
    for (const member of path.reverse()) {
      depth += normalized(owners.get(member))?.region !== undefined ? 2 : 1
      assertDiagramWorkLimit('nesting', depth)
      depths.set(member, depth)
    }
  }
  for (const [id, depth] of depths) if ((lastRegions.get(id) ?? 0) > 0) assertDiagramWorkLimit('nesting', depth + 1)
  return {
    compositeIds, issue,
    ownerOf: (id: string): StateScope | undefined => normalized(owners.get(id)),
    scopeOf: (statement: StateStatement): StateScope | undefined => normalized(contexts.get(statement)),
    authored: reserved as ReadonlySet<string>,
    ownedIds: (): IterableIterator<string> => owners.keys(),
    regionId, scopeId,
    floatingNoteId: (id: string): string => allocate(`note:${id}`, ['state-floating-note', id]),
    pseudostateId: (kind: 'start' | 'end', statement: StateStatement): string => {
      const scope = normalized(contexts.get(statement))
      const parent = scope ? scopeId(scope) : ''
      return allocate(`${parent}_${kind}`, ['state-pseudo', scope?.parent ?? '', scope?.region ?? -1, kind])
    },
  }
}

export type StateIdentities = ReturnType<typeof resolveStateIdentities>
