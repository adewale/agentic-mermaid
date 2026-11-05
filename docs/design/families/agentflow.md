# AgentFlow

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/agentflow.md)
and [domain reference](https://en.wikipedia.org/wiki/Intelligent_agent) establish the
family hallmark: Agent tasks, tools and actions have distinct roles; directed flows connect them to inputs, reference documents and declared connectors, with visible scopes.

## Semantics and editing

The native body combines the shared graph topology with family-owned role,
metadata, connector, global and attachment records. Nested and anonymous flows,
collapsed scopes and connector references retain their authored meaning.
Metadata on an edge destination belongs to that destination, not its source.

Use `asAgentflow` after parsing and `describeOps('agentflow')` for the current
operation schema. Unsupported or unsafe constructs retain their source as an
opaque body; they do not become partially editable graphs. Literal `%%` inside
labels is retained even where the pinned Mermaid parser truncates it; see the
[recorded divergence](../../project/divergences.md).

## Placement and limitations

The renderer reuses the graph pipeline while preserving AgentFlow role shapes
and scope ownership. Collapsed display can retarget visible links without
removing children from the editable body. Explicit layout choices and compound
graphs retain their producer; native forest placement is a bounded optimization,
not a replacement for every graph layout.

Rendering uses the shared style and palette system; Mermaid's pixels are not a
layout target. Accepted Mermaid configuration keys and ineffective controls come
from the [family registry](../../../src/agent/family-registry.ts), rather than an
independent configuration list here.

## Executable evidence

The [publishing workflow](../../../eval/layout-compare/fixtures/agentflow-native.mmd)
combines a task, tool, action, connector and global reference document. The
[independent citizenship expectations](../../../src/__tests__/helpers/family-conformance-profiles.ts)
assert the tool's connector reference, exact scope membership and all three
edge endpoint pairs before and after a role edit.

[AgentFlow tests](../../../src/__tests__/agentflow.test.ts) protect nested
metadata, global escape, attachment ownership, destination metadata and
literal label text. The [risograph golden](../../../src/__tests__/testdata/styled/agentflow-basic.risograph.svg)
provides a reviewed styled rendering of this fixture.

The [citizenship test](../../../src/__tests__/diagram-family-citizenship.test.ts)
checks the representative source through typed editing, canonical reload,
verification, SVG, ASCII/Unicode, real regions and uncached determinism. The
[render conformance portfolio](../../../src/__tests__/render-conformance-plan.test.ts)
and [styled-output tests](../../../src/__tests__/styled-output.test.ts) exercise
shared looks and palettes. These finite examples do not establish exhaustive
syntax coverage or readability at arbitrary complexity.
