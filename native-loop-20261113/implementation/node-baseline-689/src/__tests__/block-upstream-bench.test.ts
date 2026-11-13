import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BlockDb } from '../block/db.ts'
import { parseBlock } from '../block/parser.ts'
import { calculateBlockPosition } from '../block/grid.ts'

const bench = join(import.meta.dir, '../../eval/mermaid-block-bench')
const exclusions: { test: string }[] = JSON.parse(readFileSync(join(bench, 'exclusions.json'), 'utf8'))
const log = { warn: (_message: string) => {} }
class Database extends BlockDb {
  clear() {
    Object.assign(this, new BlockDb({ warn: message => log.warn(message) }))
  }
  getBlocks() {
    return this.blocks
  }
  getEdges() {
    return this.edges
  }
  getClasses() {
    return this.classes
  }
  getBlock(id: string) {
    return id === 'root' ? this.root : this.byId.get(id)
  }
  getColumns(id: string) {
    return this.getBlock(id)?.columns ?? -1
  }
}
const db = new Database(),
  parser = {
    yy: db,
    parse(source: string) {
      parseBlock(source, this.yy)
    },
  },
  block = {
    parser,
    parse(source: string) {
      parser.parse(source)
    },
  }
const configApi = { setSiteConfig: (_config: unknown) => {}, reset: () => {} },
  diagramAPI = { getConfig: () => ({}) }
for (const file of ['block.spec.ts.txt', 'blockDB.spec.ts.txt', 'blockColorIndex.spec.ts.txt', 'layout.spec.ts.txt']) {
  const source = readFileSync(join(bench, 'upstream', file), 'utf8').replace(/^import[^;]*;\s*/gm, '')
  const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  // biome-ignore lint/suspicious/noSkippedTests: Exact-pin exclusions are enumerated with reasons in the retained upstream bench ledger.
  const checkedIt = (name: string, fn: () => void) => (exclusions.some(e => e.test === name) ? it.skip(name, fn) : it(name, fn))
  new Function('describe', 'it', 'expect', 'beforeEach', 'afterEach', 'vi', 'db', 'block', 'configApi', 'log', 'diagramAPI', 'calculateBlockPosition', 'layout', 'getStyles', compiled)(
    describe,
    checkedIt,
    expect,
    beforeEach,
    afterEach,
    { spyOn, restoreAllMocks: () => mock.restore() },
    db,
    block,
    configApi,
    log,
    diagramAPI,
    calculateBlockPosition,
    () => {
      throw new Error('Mermaid singleton layout is not native')
    },
    () => {
      throw new Error('Mermaid generated stylesheet is not native')
    },
  )
}
