# Section B capability report

Generated from the Style, SceneRole, and FamilyDescriptor registries. Do not edit by hand. Machine-readable sibling: [section-b-capability-report.json](./section-b-capability-report.json).

- Public role-style leaves: **18**
- Registered Scene roles: **42**
- Built-in families: **15**
- Exportable built-in Looks: **16**
- BrandPack promoted: **no** — No external consumer has shown that ordinary version-controlled StyleSpec files are insufficient for repeated distribution, exact selection, or installed-resource integrity.
- Digest: `sha256:a30e01acb12cd6fd7b2adbcddf7702c2d532390f623eb54fd2ac0fea85e2f598`

## SceneRole styling

| Role | Fallback | Applicable public leaves |
|---|---|---|
| `node` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `edge` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `edge-label` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `group` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `group-header` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `label` | `label` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue` |
| `actor` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `lifeline` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `activation` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `message` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `block` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `note` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `class-box` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `member` | `label` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue` |
| `entity` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `attribute` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `relationship` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `cardinality` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `pie-slice` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `legend` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `bar` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `series` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `point` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `axis` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `grid` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `plate` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `section` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `task` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `milestone` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `marker-line` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `rail` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `period` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `event` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `score` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `actor-pill` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `service` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `junction` | `group` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue`, `headerFillColor` |
| `icon` | `node` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth`, `fillColor`, `borderColor`, `elevation`, `cue` |
| `title` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |
| `defs` | `label` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue` |
| `prelude` | `label` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue` |
| `chrome` | `edge` | `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform`, `textColor`, `cue`, `lineWidth`, `bendRadius`, `strokeColor`, `cue` |

## Family semantic-channel census

| Family | Declared channels |
|---|---|
| `flowchart` | none |
| `state` | `status` |
| `sequence` | `category` |
| `timeline` | `category` |
| `class` | none |
| `er` | `category` |
| `journey` | `value`, `category` |
| `architecture` | none |
| `xychart` | `value`, `category` |
| `pie` | `value`, `category`, `emphasis` |
| `quadrant` | `category` |
| `gantt` | `status`, `progress`, `emphasis`, `category` |
| `mindmap` | `importance`, `category` |
| `gitgraph` | `status`, `category` |
| `radar` | `category` |

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

Derived defaults may be guarded while they are chosen. Concrete authored theme/config/element paint is diagnose-only. Opaque concrete pairs are measurable; transparent host backdrops are explicitly unmeasurable. Evidence is recorded in the JSON report.

## Phase evidence

- **B0:** `src/__tests__/section-b-capability-report.test.ts`, `docs/project/section-b-capability-report.json`
- **B1:** `src/__tests__/section-b-role-styles.test.ts`, `src/__tests__/radar-label-discipline.test.ts`
- **B2:** `src/__tests__/section-b-role-styles.test.ts`, `src/__tests__/style-spec-authority.test.ts`
- **B3:** `src/__tests__/section-b-policy.test.ts`, `src/scene/brand-constraints.ts`
- **B4:** `docs/project/brand-primitives-plan.md`, `TODO.md#BUILD-31`
- **B5:** `docs/style-authoring.md`, `scripts/pr-assets/section-b-brand-evidence.ts`, `eval/section-b-brand-evidence/evidence-receipt.json`
