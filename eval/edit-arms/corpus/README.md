# Held-out edit corpus — do not use for development or tuning

These 41 Mermaid diagrams and 63 edit tasks are a **held-out evaluation set**
for `eval/edit-arms`. Do not use them to develop, debug, tune or prompt-engineer
Agentic Mermaid (parser, serializer, mutation operations, agent docs or
prompts), and do not copy them into other corpora, fixtures or tests. A change
motivated by one of these diagrams invalidates the set: replace the affected
diagrams with newly collected ones and record the replacement in
`../PREREGISTRATION.md` before the next run.

`tasks.json` holds the requests **and their reference answers**. Agents under
evaluation are told not to read `eval/edit-arms/`; dispatch from a checkout
without this directory when the runner cannot enforce that.

## Provenance

Every diagram is real project documentation retrieved on 2026-11-13 from a
public repository whose license permits redistribution (MIT, Apache-2.0 or
CC-BY-4.0). `manifest.json` records, for each diagram, the repository, file,
commit and line of the source block (a permalink), the license file at that
commit, the retrieval date, the family and the messy features it carries.
Each `diagrams/*.mermaid` file is the block body copied verbatim from its
Markdown container (a fenced block or Hugo shortcode); only container
indentation and trailing whitespace at the very end of the block were removed.
Downloaded content is stored as text and is never executed. The `.mermaid`
extension (not `.mmd`) keeps these files out of the repository corpora that
enroll every `eval/**/*.mmd` automatically, such as the rendered-corpora audit.

None of the diagrams appears in this repository's other corpora, fixtures,
tests or website samples (checked line-by-line against the repository at
`825befd5` when the set was collected).

| Family | Diagrams | Tasks |
|---|---:|---:|
| flowchart | 15 | 22 |
| sequence | 10 | 17 |
| class | 5 | 8 |
| state | 4 | 7 |
| er | 3 | 5 |
| gantt | 2 | 2 |
| pie | 1 | 1 |
| gitGraph | 1 | 1 |
| **total** | **41** | **63** |

Licenses: Apache-2.0 18, MIT 14, CC-BY-4.0 9. Messy features (diagram counts):
classDef 11, subgraphs/composites/namespaces 11, `%%` comments 7, style or
linkStyle lines 6, lines over 120 characters 6, init directives 3, frontmatter
3, tab indentation 2.

## Tasks

Each task in `tasks.json` is a request phrased as a user would type it plus one
or more reference edits, written by hand as exact find/replace patches against
the raw source. The expected change is whatever upstream Mermaid 12.2.0
reports between the original and the patched source; no Agentic Mermaid API was
used to write or check the references. Optional fields: `strictNew` (attributes
the request pins down for new elements, such as the group a node must join)
and `free` (fact kinds the request leaves open). Categories: add message 7,
change label 6, restyle 5, rename participant 5, rename node 4, delete and
reconnect 4, add step between 4, add node in group 4, add class and relation 3,
add attribute 3, and 1–2 each of change message text, add task, add state, add
relation, move to group, insert decision, delete element, change value, add
participant and message, add note, add node, add edge, add commit, add class in
group.

## Attribution

Each diagram remains under its original license; the CC-BY-4.0 works are
attributed here and in `manifest.json`. Modification: extracted from the
surrounding document as described above.

| Diagram | Family | Source (permalink) | License |
|---|---|---|---|
| `otel-service-legend` | flowchart | [open-telemetry/opentelemetry.io/content/en/docs/demo/architecture.md](https://github.com/open-telemetry/opentelemetry.io/blob/eaa8ceeca00060f750f9963a193951a2fcdbe9b0/content/en/docs/demo/architecture.md#L114) | CC-BY-4.0 |
| `k8s-contribution-methods` | flowchart | [kubernetes/website/content/en/docs/contribute/style/diagram-guide.md](https://github.com/kubernetes/website/blob/14783102c018b7a79d99462fb6cdbd5473f157d6/content/en/docs/contribute/style/diagram-guide.md#L150) | CC-BY-4.0 |
| `dotnet-auth-environments` | flowchart | [dotnet/docs/docs/azure/sdk/media/mermaidjs/authentication-environments.md](https://github.com/dotnet/docs/blob/1174942d1f23b5f7642941b071fc3c73c520b374/docs/azure/sdk/media/mermaidjs/authentication-environments.md#L6) | CC-BY-4.0 |
| `dotnet-local-service-principal` | flowchart | [dotnet/docs/docs/azure/sdk/media/mermaidjs/local-service-principal-authentication.md](https://github.com/dotnet/docs/blob/1174942d1f23b5f7642941b071fc3c73c520b374/docs/azure/sdk/media/mermaidjs/local-service-principal-authentication.md#L6) | CC-BY-4.0 |
| `sk-process-dapr` | flowchart | [microsoft/semantic-kernel/dotnet/samples/Demos/ProcessWithDapr/README.md](https://github.com/microsoft/semantic-kernel/blob/b714e97e347617fb884be9bc961ea0dcc829b303/dotnet/samples/Demos/ProcessWithDapr/README.md#L22) | MIT |
| `hugegraph-architecture` | flowchart | [apache/hugegraph/README.md](https://github.com/apache/hugegraph/blob/0abd9312562cd42e33ddf986421578db5cc852ba/README.md#L128) | Apache-2.0 |
| `seatunnel-engine-choice` | flowchart | [apache/seatunnel/docs/en/engines/overview.md](https://github.com/apache/seatunnel/blob/71e5df0ab7479d410c1e19517f3ea6429182b100/docs/en/engines/overview.md#L134) | Apache-2.0 |
| `superset-mcp-deployment` | flowchart | [apache/superset/superset/mcp_service/README.md](https://github.com/apache/superset/blob/a0f120285ad416a8bbb7d9367c354986ffea40f7/superset/mcp_service/README.md#L246) | Apache-2.0 |
| `cloudberry-segments` | flowchart | [apache/cloudberry/doc/core-internals/index.md](https://github.com/apache/cloudberry/blob/54cf3f4ec50752a0ea47a12701c9ca246fd7b35c/doc/core-internals/index.md#L95) | Apache-2.0 |
| `dapr-mcp-access-control` | flowchart | [dapr/docs/daprdocs/content/en/developing-ai/mcp/mcp-access-control.md](https://github.com/dapr/docs/blob/9255d6800899d0e228b0db76e0921781dfa06245/daprdocs/content/en/developing-ai/mcp/mcp-access-control.md#L116) | Apache-2.0 |
| `ray-data-repartition-diff` | flowchart | [ray-project/ray/python/ray/data/AGENTS.md](https://github.com/ray-project/ray/blob/b95b872ac539554d2f3abe28d0a26077ce69c418/python/ray/data/AGENTS.md#L55) | Apache-2.0 |
| `agent-os-layers` | flowchart | [microsoft/agent-governance-toolkit/agent-governance-python/agent-os/ARCHITECTURE.md](https://github.com/microsoft/agent-governance-toolkit/blob/fa310ff19ba6c6d017520fbf132e85059b181931/agent-governance-python/agent-os/ARCHITECTURE.md#L44) | MIT |
| `directx-mlir-flow` | flowchart | [microsoft/DirectX-Specs/d3d/MlirPrograms.md](https://github.com/microsoft/DirectX-Specs/blob/5122ac08b27588a5bbbe0a7390474bcab44aaf2e/d3d/MlirPrograms.md#L134) | CC-BY-4.0 |
| `edgequake-data-flow` | flowchart | [raphaelmansuy/edgequake/docs/architecture/data-flow.md](https://github.com/raphaelmansuy/edgequake/blob/7057883b25017eadb71f43ceea5f32ae2b599f52/docs/architecture/data-flow.md#L18) | Apache-2.0 |
| `iceberg-wap-branches` | flowchart | [apache/iceberg-python/mkdocs/docs/api.md](https://github.com/apache/iceberg-python/blob/e9f7f6b43dcefa9ccbd02be47d71e630921e54dd/mkdocs/docs/api.md#L1521) | Apache-2.0 |
| `otel-pr-review-labels` | sequence | [open-telemetry/opentelemetry.io/content/en/site/build/ci-workflows.md](https://github.com/open-telemetry/opentelemetry.io/blob/eaa8ceeca00060f750f9963a193951a2fcdbe9b0/content/en/site/build/ci-workflows.md#L109) | CC-BY-4.0 |
| `cilium-bgp-reconcile` | sequence | [cilium/cilium/pkg/bgp/README.md](https://github.com/cilium/cilium/blob/ec728c985fed33297ee45efbf4cc8f17c8647dfb/pkg/bgp/README.md#L41) | Apache-2.0 |
| `dotnet-credential-chain` | sequence | [dotnet/docs/docs/azure/sdk/media/mermaidjs/chain-sequence.md](https://github.com/dotnet/docs/blob/1174942d1f23b5f7642941b071fc3c73c520b374/docs/azure/sdk/media/mermaidjs/chain-sequence.md#L6) | CC-BY-4.0 |
| `sk-mcp-oauth` | sequence | [microsoft/semantic-kernel/dotnet/samples/Demos/ModelContextProtocolPluginAuth/README.md](https://github.com/microsoft/semantic-kernel/blob/b714e97e347617fb884be9bc961ea0dcc829b303/dotnet/samples/Demos/ModelContextProtocolPluginAuth/README.md#L97) | MIT |
| `knox-sso-logout` | sequence | [apache/knox/knox-site/docs/knox_sso_logout.md](https://github.com/apache/knox/blob/1fdaf2c0d3d520fe7b6e19c24fbab4ee18343085/knox-site/docs/knox_sso_logout.md#L102) | Apache-2.0 |
| `superset-token-refresh` | sequence | [apache/superset/superset/mcp_service/SECURITY.md](https://github.com/apache/superset/blob/a0f120285ad416a8bbb7d9367c354986ffea40f7/superset/mcp_service/SECURITY.md#L150) | Apache-2.0 |
| `dapr-workflow-fast-path` | sequence | [dapr/docs/daprdocs/content/en/developing-applications/building-blocks/workflow/workflow-fast-path.md](https://github.com/dapr/docs/blob/9255d6800899d0e228b0db76e0921781dfa06245/daprdocs/content/en/developing-applications/building-blocks/workflow/workflow-fast-path.md#L85) | Apache-2.0 |
| `temporal-nexus-dispatch` | sequence | [temporalio/temporal/docs/architecture/nexus.md](https://github.com/temporalio/temporal/blob/74c71f963b99f366f2adf8c503ecd785b0d8b4dc/docs/architecture/nexus.md#L390) | MIT |
| `surefire-fork-lifecycle` | sequence | [apache/maven-surefire/maven-surefire-plugin/src/site/markdown/architecture.md](https://github.com/apache/maven-surefire/blob/07ca88b6728bc77075946a666f330f0b291c2082/maven-surefire-plugin/src/site/markdown/architecture.md#L114) | Apache-2.0 |
| `pulsar-txn-send` | sequence | [apache/pulsar/pip/pip-473.md](https://github.com/apache/pulsar/blob/6536f615ccf776e3fc7b9647a5010bddce757535/pip/pip-473.md#L258) | Apache-2.0 |
| `temporal-scheduler-components` | class | [temporalio/temporal/docs/architecture/schedules.md](https://github.com/temporalio/temporal/blob/74c71f963b99f366f2adf8c503ecd785b0d8b4dc/docs/architecture/schedules.md#L16) | MIT |
| `ray-file-indexers` | class | [ray-project/ray/python/ray/data/_internal/datasource_v2/README.md](https://github.com/ray-project/ray/blob/b95b872ac539554d2f3abe28d0a26077ce69c418/python/ray/data/_internal/datasource_v2/README.md#L96) | Apache-2.0 |
| `vscode-jupyter-controllers` | class | [microsoft/vscode-jupyter/.github/instructions/notebooks.instructions.md](https://github.com/microsoft/vscode-jupyter/blob/0a68e24f4305c3248a47f7c7abb87c13f1e5c3c7/.github/instructions/notebooks.instructions.md#L24) | MIT |
| `scarb-sources` | class | [software-mansion/scarb/guidelines/ARCHITECTURE.md](https://github.com/software-mansion/scarb/blob/fbfd25e48e1e748f11ac778ac02e7b4d3a0852e6/guidelines/ARCHITECTURE.md#L162) | MIT |
| `sk-vector-store-abstractions` | class | [microsoft/semantic-kernel/docs/decisions/0050-updated-vector-store-design.md](https://github.com/microsoft/semantic-kernel/blob/b714e97e347617fb884be9bc961ea0dcc829b303/docs/decisions/0050-updated-vector-store-design.md#L91) | MIT |
| `otel-stability-levels` | state | [open-telemetry/opentelemetry.io/content/en/docs/collector/internal-telemetry.md](https://github.com/open-telemetry/opentelemetry.io/blob/eaa8ceeca00060f750f9963a193951a2fcdbe9b0/content/en/docs/collector/internal-telemetry.md#L598) | CC-BY-4.0 |
| `spark-app-lifecycle` | state | [apache/spark-kubernetes-operator/docs/architecture.md](https://github.com/apache/spark-kubernetes-operator/blob/2368a6af81d36ef71ce383f887f31853c0be3889/docs/architecture.md#L318) | Apache-2.0 |
| `fluid-remote-message-processor` | state | [microsoft/FluidFramework/packages/runtime/container-runtime/src/opLifecycle/README.md](https://github.com/microsoft/FluidFramework/blob/8c51cdeac2dc2c238a8e97fd61e0a1206a7eb336/packages/runtime/container-runtime/src/opLifecycle/README.md#L337) | MIT |
| `directline-connection-status` | state | [microsoft/BotFramework-DirectLineJS/docs/API.md](https://github.com/microsoft/BotFramework-DirectLineJS/blob/5739bd10396530b0b093ffbf22d97068900cbc91/docs/API.md#L9) | MIT |
| `retrospectives-frontend-erd` | er | [microsoft/vsts-extension-retrospectives/documentation/frontend_ERD.md](https://github.com/microsoft/vsts-extension-retrospectives/blob/2ba8086754fe2438ac5db848efcefb7c3fd113ea/documentation/frontend_ERD.md#L10) | MIT |
| `directx-state-object-db` | er | [microsoft/DirectX-Specs/d3d/MlirPrograms.md](https://github.com/microsoft/DirectX-Specs/blob/5122ac08b27588a5bbbe0a7390474bcab44aaf2e/d3d/MlirPrograms.md#L722) | CC-BY-4.0 |
| `bcpt-test-suites` | er | [microsoft/BCTech/samples/BCPT/README.md](https://github.com/microsoft/BCTech/blob/ccb6c3d36f72b784fb9757316f6f296f0a58ea71/samples/BCPT/README.md#L89) | MIT |
| `airflow-dagrun-metrics` | gantt | [apache/airflow/airflow-core/src/airflow/METRICS.md](https://github.com/apache/airflow/blob/4b78d37e164486338dc1a7d428676c500ea07676/airflow-core/src/airflow/METRICS.md#L24) | Apache-2.0 |
| `dapr-signature-certs` | gantt | [dapr/docs/daprdocs/content/en/developing-applications/building-blocks/workflow/workflow-history-signing.md](https://github.com/dapr/docs/blob/9255d6800899d0e228b0db76e0921781dfa06245/daprdocs/content/en/developing-applications/building-blocks/workflow/workflow-history-signing.md#L228) | Apache-2.0 |
| `ergo-canary-traffic` | pie | [ergo-services/ergo/docs/advanced/building-a-cluster.md](https://github.com/ergo-services/ergo/blob/2e121073d187e9dcefd5d28d3f151912f0c123d9/docs/advanced/building-a-cluster.md#L227) | MIT |
| `sk-azureopenai-versions` | gitGraph | [microsoft/semantic-kernel/docs/decisions/0055-dotnet-azureopenai-stable-version-strategy.md](https://github.com/microsoft/semantic-kernel/blob/b714e97e347617fb884be9bc961ea0dcc829b303/docs/decisions/0055-dotnet-azureopenai-stable-version-strategy.md#L48) | MIT |
