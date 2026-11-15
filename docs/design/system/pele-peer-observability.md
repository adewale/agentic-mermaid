# Pele rendered endpoint adapter

`pele-1.9.0-rendered-ids-v1` observes the published `pele@1.9.0` SVG after
the render/consumption clock. The benchmark selects it only for the exact
version and npm integrity recorded in `PELE_SEMANTIC_ADAPTER`. Its metadata
belongs in the control fingerprint. New controls are required; the frozen
`semantic-peer-v1` campaign and its 168 unqualified Pele cells stay unchanged.

The producer is Pele's renderer; the consumer is `inspectPeerSemantics`.
Independent expectations come from the harness's bounded authored relations.
Pele's public `parse()` result is never used as evidence of rendered endpoints.

The source evidence is tag commit
[`e7f092a4de147cc32210913c20e36eaa5fcd0ef1`](https://github.com/obsidianmd/pele/tree/e7f092a4de147cc32210913c20e36eaa5fcd0ef1),
corroborated by rendering the integrity-checked published archive. npm reports
no `gitHead`; the tag is source inspection evidence, not a claimed archive build
receipt.

| Family | Owned observable | Directed identity decoding |
| --- | --- | --- |
| Flowchart | `g.pele-edge[data-id]` with a nonempty owned path; `g.pele-node[data-id]` | DB assigns `L_<start>_<end>_<pair ordinal>`: 0, then 2, 3, …; not the graph builder's normally unused global-index fallback |
| Class | Same wrappers | `id_<id1>_<id2>_<relation ordinal>`, starting at 1 |
| ER | Same wrappers; node ID is the authored entity name | `id_entity-<nameA>-<creation ordinal>_entity-<nameB>-<creation ordinal>_<relation ordinal>`, starting at 0 |
| Sequence / State | Message/transition wrapper IDs encode only ordinals | Endpoints remain unobservable; these workloads stay enrolled and unsupported |

Owners are Flowchart `db.ts:addSingleLink`, `graph.ts` and `render.ts`, Class
`graph.ts` and `render.ts`, and ER `db.ts:addEntity/addRelationship`, `graph.ts`
and `render.ts` at that commit. ER creation ordinals are decoded as numeric
identity suffixes; the adapter does not replay entity creation from input.

Only the enrolled plain Flowchart, Class and ER fixture grammar is admitted,
including their real label edits, renamed IDs and declared scaling workloads.
Custom edge IDs, aliases, collapsed groups and other syntax remain unsupported.
This bounds the source-to-ID encoding contract rather than choosing successful
results. Every fixed seven-workload cohort cell remains in the report.

Decoding considers all rendered node identities, independently of the expected
endpoint pairs. Ambiguous underscore partitions stay unsupported. The adapter
requires unique node and edge wrapper IDs, complete node correspondence, owned
edge paths, exact directed endpoint multiplicity and pinned occurrence
ordinals. Edge-label wrappers repeat IDs legitimately and are excluded by their
distinct class token. Swapped endpoints with unchanged labels, missing owned
wrappers/paths, duplicate IDs and changed multiplicity disprove admission.
Declared Class/ER identities also belong to the node expectation, including
isolated declarations; retained label text cannot substitute for their wrappers.

The shaft must be the wrapper's first direct element child, in an SVG/group
ancestry, with at least one admitted nondegenerate path segment and a declared
positive-alpha stroke. Comments, CDATA, definitions, markers and disconnected
zero-length segments cannot supply that evidence. The standalone default Node
output's line-color variable is recognized explicitly. Other variable programs,
stylesheets, hiding, clipping, masking, transforms and dash overrides fail
closed rather than being interpreted as a general SVG paint program.

This observes the renderer's endpoint identity contract, like explicit
`data-from`/`data-to` metadata. It does not prove endpoint attachment geometry,
arrowhead appearance, label association, full visual equivalence or peer
competitiveness. Neither a partial adapter nor label-only numerical summaries
qualify the complete Pele cohort. No upstream source is modified.

The Node peer pin comes from the shared active policy at
Trident's [`tool-versions.json`](https://github.com/adewale/trident/blob/main/tool-versions.json), read through `tool-versions.ts`. This
adapter observes that policy's audited 1.9.0 release. The peer registry retains
the shared policy expression; the adapter's explicit audited metadata stays
separate. A future shared-policy upgrade must
not automatically enable an unaudited endpoint schema. No historical 1.6 lane
is added; old source and evidence retain their original identities.
