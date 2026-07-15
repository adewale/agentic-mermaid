# Section B capability report

Generated from the Style, SceneRole, and FamilyDescriptor registries. Do not edit by hand. Machine-readable sibling: [section-b-capability-report.json](./section-b-capability-report.json).

- Public role-style leaves: **16**
- Registered Scene roles: **42**
- Built-in families: **15**
- Exportable built-in Looks: **16**
- BrandPack promoted: **no** — No external consumer has shown that ordinary version-controlled StyleSpec files are insufficient for repeated distribution, exact selection, or installed-resource integrity.
- Digest: `sha256:a9c3d60bb5d4b3bb9cc9e5f5a564a5edb4879cce98b9206f8841693e6223dd8b`

## SceneRole styling

| Role | Fallback | Exact consumption | Applicable public leaves |
|---|---|---|---|
| `node` | `node` | exact | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor` |
| `edge` | `edge` | exact | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor`, `lineWidth`, `bendRadius`, `strokeColor` |
| `edge-label` | `label` | fallback-only | fallback-only |
| `group` | `group` | exact | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `headerFillColor`, `fontFamily` |
| `group-header` | `group` | exact | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor`, `fillColor`, `borderColor`, `strokeColor`, `lineWidth`, `cue` |
| `label` | `label` | exact | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor` |
| `actor` | `node` | exact | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor` |
| `lifeline` | `edge` | fallback-only | fallback-only |
| `activation` | `node` | fallback-only | fallback-only |
| `message` | `edge` | fallback-only | fallback-only |
| `block` | `group` | fallback-only | fallback-only |
| `note` | `group` | fallback-only | fallback-only |
| `class-box` | `node` | fallback-only | fallback-only |
| `member` | `label` | fallback-only | fallback-only |
| `entity` | `node` | fallback-only | fallback-only |
| `attribute` | `label` | fallback-only | fallback-only |
| `relationship` | `edge` | exact | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor`, `lineWidth`, `bendRadius`, `strokeColor` |
| `cardinality` | `label` | fallback-only | fallback-only |
| `pie-slice` | `node` | exact | `fillColor`, `borderColor`, `strokeColor`, `lineWidth`, `cue` |
| `legend` | `group` | exact | `fillColor`, `borderColor`, `strokeColor`, `lineWidth`, `textColor` |
| `bar` | `node` | exact | `fillColor`, `borderColor`, `strokeColor`, `lineWidth` |
| `series` | `edge` | exact | `borderColor`, `strokeColor`, `lineWidth` |
| `point` | `node` | exact | `fillColor`, `borderColor`, `strokeColor`, `lineWidth` |
| `axis` | `label` | fallback-only | fallback-only |
| `grid` | `edge` | fallback-only | fallback-only |
| `plate` | `node` | fallback-only | fallback-only |
| `section` | `group` | fallback-only | fallback-only |
| `task` | `node` | exact | `fillColor`, `borderColor`, `strokeColor`, `lineWidth`, `cue` |
| `milestone` | `node` | exact | `fillColor`, `borderColor`, `strokeColor`, `lineWidth`, `cue` |
| `marker-line` | `edge` | fallback-only | fallback-only |
| `rail` | `edge` | fallback-only | fallback-only |
| `period` | `group` | fallback-only | fallback-only |
| `event` | `group` | fallback-only | fallback-only |
| `score` | `node` | fallback-only | fallback-only |
| `actor-pill` | `node` | fallback-only | fallback-only |
| `service` | `node` | fallback-only | fallback-only |
| `junction` | `node` | fallback-only | fallback-only |
| `icon` | `node` | fallback-only | fallback-only |
| `title` | `label` | fallback-only | fallback-only |
| `defs` | `label` | fallback-only | fallback-only |
| `prelude` | `label` | fallback-only | fallback-only |
| `chrome` | `label` | fallback-only | fallback-only |

## Derived private-face projection

The remaining private face is compiled only from these public role records; it has no author-only leaf.

| Compiled face | Public source role | Public fields |
|---|---|---|
| `text` | `label` | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor` |
| `node` | `node` | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor` |
| `edge` | `edge` | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor`, `lineWidth`, `bendRadius`, `strokeColor` |
| `group` | `group` | `fontSize`, `fontWeight`, `letterSpacing`, `textTransform`, `textColor`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `fontFamily`, `headerFillColor` |

## Family semantic-channel census

| Family | Admitted Scene roles | Emitted channels | Binding consumer roles | Public binding channels |
|---|---|---|---|---|
| `flowchart` | `prelude`, `defs`, `chrome`, `group`, `group-header`, `edge`, `edge-label`, `node`, `label`, `icon` | none | none | none |
| `state` | `prelude`, `defs`, `chrome`, `group`, `group-header`, `edge`, `edge-label`, `node`, `note`, `label` | `status` | none | none |
| `sequence` | `prelude`, `defs`, `chrome`, `actor`, `lifeline`, `activation`, `message`, `block`, `group`, `note`, `label`, `icon` | `category` | `actor` | `category` |
| `timeline` | `prelude`, `chrome`, `rail`, `title`, `section`, `group-header`, `period`, `event`, `label` | `category` | none | none |
| `class` | `prelude`, `defs`, `chrome`, `group`, `group-header`, `class-box`, `member`, `relationship`, `cardinality`, `note`, `label` | none | none | none |
| `er` | `prelude`, `defs`, `chrome`, `group`, `group-header`, `entity`, `attribute`, `relationship`, `cardinality`, `label` | `category` | `relationship` | `category` |
| `journey` | `prelude`, `defs`, `chrome`, `title`, `series`, `grid`, `axis`, `rail`, `legend`, `actor`, `section`, `group-header`, `task`, `marker-line`, `label`, `score` | `value`, `category` | `group-header` | `category` |
| `architecture` | `prelude`, `defs`, `chrome`, `title`, `group`, `group-header`, `icon`, `label`, `service`, `junction`, `edge` | none | none | none |
| `xychart` | `prelude`, `defs`, `chrome`, `grid`, `bar`, `series`, `point`, `axis`, `legend`, `title`, `label` | `value`, `category` | `bar`, `series` | `category` |
| `pie` | `prelude`, `chrome`, `pie-slice`, `legend`, `title`, `label` | `value`, `category`, `emphasis` | `pie-slice` | `category` |
| `quadrant` | `prelude`, `chrome`, `plate`, `grid`, `point`, `axis`, `title`, `label` | `category` | none | none |
| `gantt` | `prelude`, `defs`, `chrome`, `section`, `grid`, `axis`, `label`, `task`, `milestone`, `edge`, `marker-line`, `title` | `status`, `progress`, `emphasis`, `category` | `task`, `milestone` | `category` |
| `mindmap` | `prelude`, `chrome`, `edge`, `node`, `icon`, `label` | `importance`, `category` | none | none |
| `gitgraph` | `prelude`, `chrome`, `title`, `group`, `rail`, `edge`, `node`, `label` | `status`, `category` | none | none |
| `radar` | `prelude`, `chrome`, `grid`, `pie-slice`, `point`, `axis`, `legend`, `title` | `category` | `pie-slice`, `legend`, `point` | `category` |

## Built-in public exportability

- `crisp` → `look:crisp`; public export valid; role keys: none
- `hand-drawn` → `look:hand-drawn`; public export valid; role keys: none
- `excalidraw` → `look:excalidraw`; public export valid; role keys: none
- `pen-and-ink` → `look:pen-and-ink`; public export valid; role keys: none
- `freehand` → `look:freehand`; public export valid; role keys: none
- `watercolor` → `look:watercolor`; public export valid; role keys: none
- `blueprint` → `look:blueprint`; public export valid; role keys: none
- `look:tufte` → `look:tufte`; public export valid; role keys: `edge`, `group`, `node`
- `accessible-high-contrast` → `look:accessible-high-contrast`; public export valid; role keys: `edge`, `group`, `node`
- `patent-drawing` → `look:patent-drawing`; public export valid; role keys: `edge`, `group`, `node`
- `status-dashboard` → `look:status-dashboard`; public export valid; role keys: `edge`, `group`, `node`
- `ops-schematic` → `look:ops-schematic`; public export valid; role keys: `edge`, `group`, `node`
- `chalkboard` → `look:chalkboard`; public export valid; role keys: `edge`, `group`, `node`
- `risograph` → `look:risograph`; public export valid; role keys: `edge`, `group`, `node`
- `architectural-plan` → `look:architectural-plan`; public export valid; role keys: `edge`, `group`, `node`
- `publication-figure` → `look:publication-figure`; public export valid; role keys: `edge`, `group`, `node`

## Paint authority and constraints

Derived defaults may be guarded while they are chosen. Concrete authored theme/config/element paint is diagnose-only. Opaque concrete pairs are measurable; transparent host backdrops are explicitly unmeasurable.

| Case | Provenance | Foreground | Background | Output context | Measurement / behavior |
|---|---|---|---|---|---|
| `core-derived-semantic-paint-tokens` | core-derived | derived semantic foreground token | resolved opaque page/surface token | shared SVG/PNG appearance | opaque-measurable / guard-may-substitute |
| `journey-derived-label-ink` | core-derived | derived journey label ink | resolved journey surface | Journey SVG/PNG Scene | opaque-measurable / guard-may-substitute |
| `mindmap-derived-label-ink` | core-derived | derived mindmap label ink | resolved node fill | Mindmap SVG/PNG Scene | opaque-measurable / guard-may-substitute |
| `gitgraph-derived-label-ink` | core-derived | derived branch/commit label ink | derived label surface | GitGraph SVG/PNG Scene | opaque-measurable / guard-may-substitute |
| `pie-derived-series-palette` | core-derived | derived slice/label palette | resolved opaque page | Pie SVG/PNG and terminal palette | opaque-measurable / guard-may-substitute |
| `radar-derived-label-ink` | core-derived | derived radar label ink | resolved opaque page | Radar SVG/PNG Scene | opaque-measurable / guard-may-substitute |
| `radar-authored-axis-color` | theme-authored | themeVariables.radar.axisColor | resolved opaque page | Radar SVG/PNG verification artifact | opaque-measurable / diagnose-only |
| `brand-constraint-final-scene-paint` | style-or-source-authored | final admitted text MarkPaint | nearest admitted semantic surface or page | final admitted Scene before graphical backend | opaque-measurable / diagnose-only |
| `transparent-host-backdrop` | host-owned | final admitted text MarkPaint | unknown embedding-host backdrop | transparent SVG/PNG host composition | host-dependent-unmeasurable / diagnose-only |

## Phase evidence

- **B0:** `src/__tests__/section-b-capability-report.test.ts`, `docs/project/section-b-capability-report.json`
- **B1:** `src/__tests__/section-b-role-styles.test.ts`, `src/__tests__/radar-label-discipline.test.ts`
- **B2:** `src/__tests__/section-b-role-styles.test.ts`, `src/__tests__/style-spec-authority.test.ts`
- **B3:** `src/__tests__/section-b-policy.test.ts`, `src/scene/brand-constraints.ts`
- **B4:** `docs/project/brand-primitives-plan.md`, `eval/section-b-brand-evidence/usability-agent-session.json`
- **B5:** `docs/style-authoring.md`, `scripts/pr-assets/section-b-brand-evidence.ts`, `eval/section-b-brand-evidence/evidence-receipt.json`, `eval/section-b-brand-evidence/usability-agent-session.json`
