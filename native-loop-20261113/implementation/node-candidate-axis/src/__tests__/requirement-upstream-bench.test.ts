import { describe, it, test, expect, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RequirementDb, RequirementType, RiskLevel, VerifyType, Relationships } from '../requirement/db.ts'
import { parseRequirement } from '../requirement/parser.ts'

const bench = join(import.meta.dir, '../../eval/mermaid-requirement-bench')
const exclusions: { test: string }[] = JSON.parse(readFileSync(join(bench, 'exclusions.json'), 'utf8'))
class RequirementDB extends RequirementDb {
  readonly RequirementType = RequirementType
  readonly RiskLevel = RiskLevel
  readonly VerifyType = VerifyType
  readonly Relationships = Relationships
  clear() {
    Object.assign(this, new RequirementDb())
  }
  getRequirements() {
    return this.requirements
  }
  getElements() {
    return this.elements
  }
  getRelationships() {
    return this.relations
  }
  getClasses() {
    return this.classes
  }
  getDirection() {
    return this.direction
  }
  getAccTitle() {
    return this.accTitle ?? ''
  }
  getAccDescription() {
    return this.accDescr ?? ''
  }
}
const parser = {
  yy: new RequirementDB(),
  parse(source: string) {
    parseRequirement(source, this.yy)
  },
}
for (const file of ['requirementDiagram.spec.js.txt', 'requirementDb.spec.ts.txt']) {
  const source = readFileSync(join(bench, 'upstream', file), 'utf8').replace(/^import[^;]*;\s*/gm, '')
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  // biome-ignore lint/suspicious/noSkippedTests: Exact-pin exclusions are enumerated with reasons in the retained upstream bench ledger.
  const checkedIt = (name: string, fn: () => void) => (exclusions.some(e => e.test === name) ? it.skip(name, fn) : it(name, fn))
  new Function('describe', 'it', 'expect', 'beforeEach', 'afterEach', 'RequirementDB', 'reqDiagram', 'setConfig', 'test', compiled)(describe, checkedIt, expect, beforeEach, afterEach, RequirementDB, { parser }, () => {}, test)
}
