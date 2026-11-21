import fs from 'node:fs'
import assert from 'node:assert/strict'
Bun.plugin({ name: 'restore-blanket-duplicate-veto', setup(build) {
  build.onLoad({ filter: /\/src\/layout-engine\.ts$/ }, ({ path }) => {
    const source = fs.readFileSync(path, 'utf8')
    const from = '&& !options.preserveSubgraphChildOrder && !options.layoutHints?.adjacent?.length) {'
    assert.equal(source.split(from).length, 2)
    return { loader: 'ts', contents: source.replace(from, '&& !options.preserveSubgraphChildOrder && !options.layoutHints?.adjacent?.length && !hasParallelPair(graph.edges)) {') }
  })
} })
