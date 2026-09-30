// The public MermaidConfig dot-paths of the installed (pinned) Mermaid package,
// read from its shipped type declarations, for config-diagnostic tests.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

export interface MermaidConfigKey {
  id: string
  type: string
  optional: boolean
}

const CONFIG_TYPES_PATH = join(import.meta.dir, '..', '..', '..', 'node_modules', 'mermaid', 'dist', 'config.type.d.ts')

function propertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

/** Every dot-path reachable from MermaidConfig and the interfaces it references. */
export function mermaidConfigKeys(path = CONFIG_TYPES_PATH): MermaidConfigKey[] {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const interfaces = new Map<string, ts.InterfaceDeclaration>()
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) interfaces.set(statement.name.text, statement)
  }
  if (!interfaces.has('MermaidConfig')) throw new Error('Mermaid config types do not declare MermaidConfig')
  const entries = new Map<string, MermaidConfigKey>()
  const typeText = (node: ts.TypeNode | undefined): string => node ? node.getText(source).replace(/\s+/g, ' ').trim() : 'any'

  const collectType = (prefix: string, node: ts.TypeNode | undefined, stack: readonly string[]): void => {
    if (!node) return
    if (ts.isTypeLiteralNode(node)) return collectMembers(prefix, node.members, stack)
    if (ts.isParenthesizedTypeNode(node)) return collectType(prefix, node.type, stack)
    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      for (const child of node.types) collectType(prefix, child, stack)
      return
    }
    if (!ts.isTypeReferenceNode(node)) return
    const reference = node.typeName.getText(source).split('.').at(-1) ?? ''
    if (['Partial', 'Required', 'Readonly'].includes(reference)) return collectType(prefix, node.typeArguments?.[0], stack)
    collectInterface(prefix, reference, stack)
  }

  const collectMembers = (prefix: string, members: ts.NodeArray<ts.TypeElement>, stack: readonly string[]): void => {
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.name) continue
      const name = propertyName(member.name)
      if (!name) continue
      const id = prefix ? `${prefix}.${name}` : name
      entries.set(id, { id, type: typeText(member.type), optional: Boolean(member.questionToken) })
      collectType(id, member.type, stack)
    }
  }

  const collectInterface = (prefix: string, name: string, stack: readonly string[]): void => {
    const declaration = interfaces.get(name)
    if (!declaration || stack.includes(name)) return
    const nextStack = [...stack, name]
    for (const heritage of declaration.heritageClauses ?? []) {
      for (const inherited of heritage.types) collectType(prefix, inherited, nextStack)
    }
    collectMembers(prefix, declaration.members, nextStack)
  }

  collectInterface('', 'MermaidConfig', [])
  return [...entries.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
