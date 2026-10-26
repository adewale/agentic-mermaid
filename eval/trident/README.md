# Trident benchmarks

Shared benchmark runners, community comparisons and retained-evidence tooling
belong to [Trident](https://github.com/adewale/trident). Agentic keeps its product
contracts and Mermaid compatibility policy.

The local launcher uses the Trident revision in `config.json`. Benchmark runs
remain excluded from CI and the published library. The launcher supplies this
checkout as the source target; Trident prepares its own source-adapter workspace
from public tracked inputs. Benchmark records belong outside that disposable
workspace so updating the harness cannot remove measurement evidence.
