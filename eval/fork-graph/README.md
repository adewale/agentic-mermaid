# Mermaid fork graph

The projects that keep 0.5 honest: browserless renderers to compare on speed and payload, terminal renderers to compare on output, and parsers to compare on meaning. [`population.json`](./population.json) records who they are, how they relate (fork, port, binding, or independent reimplementation that may vendor Mermaid's grammar and specs, as Pele does), and what each had published on 18 October 2026. Most of the 80 nodes are `observed` (in the graph, with no comparison value); the table below lists the rest.

## How the population was chosen

- **Seeds:** everything named in [`docs/comparison.md`](../../docs/comparison.md), every fork in the July star-ranked [`fork-snapshot.json`](../mindmap-gitgraph-content-corpus/fork-snapshot.json), Agentic itself and `mermaid-ast`.
- **Discovery:** npm registry search (the queries are in `method.npmQueries`, including the parents' verbatim descriptions to catch republished forks), PyPI names, and one hop along provenance files (`UPSTREAM.md`, `THIRD_PARTY.md`, README credits).
- **Kept:** projects that parse or render Mermaid themselves. Integrations whose dependencies name `mermaid`, `beautiful-mermaid`, `zombie-mermaid`, `pele` or Merman are in `excluded`, with the reason. Of mermaid-js/mermaid's GitHub forks, only snapshot forks and forks that publish their own npm package are listed.
- **Lineage without the GitHub API:** a fork shares its parent's root commit. Port, binding and vendors claims cite the file that makes them. Repos that could not be reached are in `unresolved`.

## Peers

| id | relation | published | outputs | role |
| --- | --- | --- | --- | --- |
| `mermaid-js/mermaid` | root | mermaid@12.2.0 | svg | language-reference |
| `AlexanderGrooff/mermaid-ascii` | independent | tag 1.6.1 | ascii-unicode | ancestor, terminal-peer |
| `lukilabs/beautiful-mermaid` | independent | beautiful-mermaid@1.1.3 | svg, ascii-unicode | ancestor, peer |
| `adewale/agentic-mermaid` | fork | agentic-mermaid@0.4.1 | svg, png, ascii-unicode | self |
| `1jehuang/mermaid-rs-renderer` | independent | tag v0.3.1 | svg, png | peer |
| `akashacms/mermaid-wasm-renderer` | binding | mermaid-wasm-renderer@0.3.1 | svg | peer (how `bench:peers` runs mermaid-rs) |
| `Latias94/merman` | independent | @mermanjs/node@0.9.1 | svg, png, jpeg, pdf, ascii-unicode | peer, terminal-peer |
| `dfadler/zombie-mermaid` | fork | zombie-mermaid@5.7.1 | svg, ascii-unicode | peer, terminal-peer |
| `obsidianmd/pele` | independent | pele@1.6.0 | svg | peer |
| `Mootikins/figurehead-rs` | independent | tag v0.4.3 | ascii-unicode | terminal-peer |
| `fasouto/termaid` | independent | pypi:termaid@0.9.1 | ascii-unicode | terminal-peer |
| `kingsword09/mermansi` | independent | tag v0.1.6 | ascii-unicode | terminal-peer |
| `pgavlin/mermaid-ascii` | fork | untagged | ascii-unicode | terminal-peer |
| `inkeep/visimer` | independent | @visimer/core@1.1.3 | ast | parser-peer |
| `neongreen/mermaid-ast` | independent | mermaid-ast@0.8.2 | ast | parser-peer |
| `probelabs/maid` | independent | @probelabs/maid@0.0.29 | diagnostics | parser-peer |

`bun run bench:peers` (`eval/benchmark/peer-bench.ts`) times the SVG and terminal peers above that run in Node or Python against the built package. To find where this repository uses or cites a node, search for its repository or package name.

## Re-checking

`bun run eval/fork-graph/check.ts` re-resolves every node's branch head with anonymous `git ls-remote` and every package's latest version from the npm registry or PyPI. It prints drift and exits 1 when anything moved; the `adewale/agentic-mermaid` node drifts on every merge to `main`. It uses the network and moving targets, so it is not part of any test or CI job. To re-derive a lineage edge by hand (commits only, no file contents):

```bash
git clone -q --bare --filter=tree:0 --single-branch https://github.com/lukilabs/beautiful-mermaid bm.git
git -C bm.git remote add zombie https://github.com/dfadler/zombie-mermaid
git -C bm.git config remote.zombie.promisor true && git -C bm.git config remote.zombie.partialclonefilter tree:0
git -C bm.git fetch -q --filter=tree:0 zombie main:refs/forks/zombie
git -C bm.git rev-list --max-parents=0 HEAD refs/forks/zombie | sort -u        # one shared root: a fork
git -C bm.git rev-list --left-right --count HEAD...refs/forks/zombie           # behind, ahead
npm view pele version gitHead license --json                                    # published version
curl -s https://registry.npmjs.org/-/npm/v1/attestations/pele@1.6.0             # provenance commit
```

## Limits

- Star counts were not refreshed: the GitHub API was not used. July ranks stay in `fork-snapshot.json`; this file does not replace it.
- The archived flag and GitHub's fork-of metadata were not observable. Lineage here is commit evidence only, so a repo copied without fork history counts as `independent` unless it says otherwise.
- crates.io and the Go proxy were not queried. Rust and Go versions are git tags; Mermaider 0.15.1, Sebastian 0.8.0 and the C4 `rusty-mermaid` cited in `docs/comparison.md` remain unresolved.
- Outputs and runtimes are as each README states them. Nothing was installed or executed, and roles say what is worth comparing, not who wins.
- This is a dated observation. Rerun `check.ts` before citing a head or version.
