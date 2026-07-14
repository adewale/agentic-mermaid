# Cupertino style — probe and evidence record

> **Status: non-authoritative probe; not a backlog or implementation plan.**
> The umbrella [brand-primitives plan](./brand-primitives-plan.md) owns product
> and architecture decisions, dependencies, vocabulary, and acceptance criteria.
> The root [TODO.md](../../TODO.md) is the only owner of scheduled work. Nothing
> in this document independently authorizes or schedules a change; remaining
> customization work runs only through `BUILD-31` or a separately promoted item.

This record retains the Cupertino prototype, review findings, and historical
C0–C5 package labels so their evidence remains traceable. Those labels are
evidence groups, not PRs, milestones, or an execution order. Protocol truth and
skip-undefined composition precede nested brand fields under the umbrella plan;
the existing private `InternalStyleFace` is not promoted verbatim. References
below point to the implemented Section A landing candidate and Section B (public
customization). Section A disposition is recorded in
[`archive/section-a-rendering-contract-2026-07.md`](./archive/section-a-rendering-contract-2026-07.md);
admitted Section B work maps to root `BUILD-31`, and only genuinely
out-of-scope findings need separate promotion.

## Probe conclusion

The evidence supports `cupertino` as a candidate built-in full Look: an
Apple-HIG product surface—borderless white cards on a grouped gray page,
hierarchy from surface and weight instead of outlines, systemBlue held in
reserve. It is the first built-in that encodes a
*design system* (semantic tokens, a typography ramp, elevation) rather than a
texture, and it becomes the worked example for users registering their own brand
styles. Shipment and public-API decisions remain owned by the umbrella plan's
B5 evidence gate and root `BUILD-31`.

The style is derived from emilkowalski's `apple-design` skill
(<https://www.skills.sh/emilkowalski/skill/apple-design>), which distills Apple's
WWDC design talks. Only its static chapters transpose to a diagram renderer:
materials & depth ("Designing Fluid Interfaces", WWDC 2018), size-specific
typography ("The Details of UI Typography", WWDC 2020), and the eight design
principles ("Principles of Great Design"). The motion chapters — springs,
velocity handoff, interruptibility — do not transpose into the static Cupertino
Look, and every public artifact says so rather than implying otherwise. The
motion ethos survives only as geometry: the largest edge bend radius of any
built-in, concentric corner radii.

A working prototype is registered in `src/scene/style-registry.ts` on this
branch, rendered across every family registered in the prototype snapshot
based on `0a81c3b`, and reviewed
by a five-lens elevation pass (HIG fidelity, differentiation, engine feasibility,
teaching, cold-eyes visual). The registered palette/font path reached that snapshot;
Mindmap and GitGraph do not yet consume the internal role-face overrides, so
their renders expose a residual fidelity gap rather than proving complete
fourteen-family face coverage. The findings below are verified against code
and renders.

## Evidence for built-in candidacy

- **It fills the largest empty region of the style space.** Every existing look
  is sketch/nostalgic, print/technical, or ops. There is no modern
  product-surface look; `crisp` is neutral, not designed. This is the
  highest-demand register for an agent-native tool documenting software.
- **It opens a new axis, not a new texture.** Every default-backend look that
  sets a node border uses `var(--fg)`; cupertino alone separates nodes with
  surface fill + elevation (`borderColor: 'transparent'`). The engine gaps this
  exposed (findings below) are platform primitives any future borderless look
  (material/fluent) will reuse.
- **It is the flagship of the crisp backend.** Every other full look leans on
  the rough/hybrid machinery; cupertino proves the fast, byte-stable default
  path can carry a premium look from the palette + face system alone.
- **It teaches.** Existing looks teach "styles can imitate media"; cupertino
  teaches "styles can encode a design system": token mapping, alpha fills that
  survive palette stacking, a weight-based type ramp, restraint rules (no
  uppercase, no 1px dividers), and every value carrying a checkable source.

Probe recommendation: retain `cupertino` — the ecosystem metonym for Apple-style UI (Flutter's
iOS widget library is literally named Cupertino), trademark-safe, and it
composes with the `-dark` sibling convention (`zinc-dark`, `tufte-dark`).

## The spec (v0.2, as prototyped)

```ts
colors: { bg: '#f2f2f7', fg: '#000000', line: '#7a7a80', accent: '#007aff',
          muted: '#66666b', surface: '#ffffff', border: 'rgba(60,60,67,0.29)' }
font: 'Inter'   // SF Pro's license restricts it to Apple platforms; Inter is
                // the prototype's bundled, PNG-safe stand-in.
face:
  node:  13/600, tracking 0, padding 24/12, radius 10, fill var(--surface,
         var(--_node-fill)), border transparent
  edge:  11/500, tracking 0.07 (SF small-size bump ≈ +6/1000em), width 1.5,
         bend radius 16, stroke var(--line, var(--_line))
  group: 12/600 in var(--muted), padding 16/16, radius 26 (= 10 + 16, corner
         concentricity), fill rgba(120,120,128,0.08), header band
         rgba(120,120,128,0.12), border transparent
```

Value provenance, and the two deliberate deviations from Apple's literal tokens:

| Value | Source | Note |
|---|---|---|
| `#f2f2f7` / `#ffffff` | systemGroupedBackground / systemBackground | pure-white surface is the *sourced* token; it reads as elevation only because the page is tinted (rubric amendment below) |
| `#000000` fg | label (light) | |
| `rgba(60,60,67,0.29)` | separator | alpha fills survive palette stacking |
| `rgba(120,120,128,0.08/0.12)` | quaternary/tertiary systemFill tier | |
| `#7a7a80` line | systemGray `#8e8e93`, darkened | HIG's gray measures **2.92:1** on the page — under this repo's 3:1 stroke gate. 3.82:1 after adjustment |
| `#66666b` muted | secondaryLabel, darkened | HIG's `rgba(60,60,67,0.6)` composites to **~2.8:1** over the group panel — under the 4.5:1 text gate. 4.68:1 after adjustment |

The repo's legibility gates win over literal HIG fidelity; the deviation is
documented in the spec comments. White cards measure **1.12:1** against the
page — separation is carried by the drop shadow. That makes the elevation and
cross-output acceptance exposed by the completed A2/A5 contract and the B0/B1
customization work as prerequisites for
claiming that the prototype reproduces the intended mock; historical evidence
group C1 records why.

## What the mock + elevation review exposed

Verified findings, grouped by the dependency they revealed. E* came from
building the mock, R* from the five-lens review; ✅ = already resolved in the
v0.2 prototype. The final column names the authoritative umbrella acceptance
area and root umbrella owner. This record supplies evidence but does not carry
independent implementation status.

| id | Finding | Authoritative ownership |
|---|---|---|
| E2 ✅ / B remains | Section A closed the transport defect: `shadow` and the other shared fields now travel through one graphical request into SVG and PNG. A Cupertino Look still needs B1's public semantic elevation primitive before `style: 'cupertino'` alone reproduces the mock. | Section A landing record; B1/B5 under `BUILD-31`. |
| E6a ✅ | Section A's skip-undefined stack semantics prevent an omitted palette channel from erasing a prior Look value. | Section A landing record. |
| E6b | Dark needs design, not derivation: Apple dark *inverts* elevation (cards `#1c1c1e` lighter than a `#000` page, hairlines instead of shadows) while `buildShadowDefs` floods white glow on dark bg (`theme.ts:307-309`). | Umbrella B2 mode semantics and B5 evidence; the dark-mode evidence below records the probe; root `BUILD-31`. |
| E1 | Section A typed connector/label semantics and backend support. Brand-selectable chip shape, surface and border remain B1 work; B4 is available only if the primitive evidence gate fails. | B1 or conditional B4 under `BUILD-31`. |
| E3 ✅ | Section A established one color/output-profile contract and SVG/PNG parity evidence; helper-only dedup remains independently owned by `CONS-30`. | Section A landing record; `CONS-30` only for residual mechanics. |
| E4 | Core data-mark roles are explicit; the public brand binding for Quadrant point fill remains. | B1/B3 under `BUILD-31`. |
| E5/E9 | Core shape/border semantics are explicit; a public borderless brand primitive and Gantt-specific fallback evidence remain. | B0/B1 under `BUILD-31`. |
| E7 | Core semantic-role identity is explicit; selecting accent for start/end status is a public binding decision. | B1/B3 under `BUILD-31`. |
| E8 ✅ | The section-band finding is closed across Timeline, Journey, and Architecture. Architecture now projects `style.groupHeaderFillColor` to `groupHeaderSurface` (`src/architecture/config.ts:179,212`) and emits it through `--arch-group-band` (`src/architecture/renderer.ts:56,172`). | done on main |
| R1 ✅ | HIG grays failed the repo's own gates (`docs/style-authoring.md` rubric item 4). Resolved in v0.2 (values above). | done |
| R2 | The remaining brand gap is a public categorical series palette shared across chart families and modes. | B1/B2 under `BUILD-31`. |
| R3 | The remaining request is a public title typography role with family applicability evidence. | B1 under `BUILD-31`. |
| R4 ✅ | Every discovery consumer now projects canonical IDs, preferred inputs, labels and categories from `knownStyleDescriptors()`. | Section A landing record. |
| R5 | The "teach brand styles" claim still collides with built-in `face` data being internal-only: the generated public StyleSpec manifest exposes palette/font/sketch fields but not semantic face records, so an "anatomy of cupertino" cookbook can reproduce only the public subset. | Umbrella B1/B5 public-record equivalence and teaching evidence; root `BUILD-31`. |
| R6 | ER still splits attribute type/name to opposite card edges (`src/er/renderer.ts:340-370`, name `text-anchor="end"`), reading as label/value pairs on wide padded cards. | Family-specific ER evidence outside this brand probe. It is unscheduled unless promoted to root TODO; this document does not own it. |

## Historical evidence packages and ownership crosswalk

The evidence labels preserve how the probe grouped its discoveries. They are
**not an execution order, PR plan, or backlog**. The umbrella plan owns acceptance and
dependency decisions; the root TODO owns any implementation that is actually
scheduled.

| Evidence package | What the probe established | Authoritative owner/status |
|---|---|---|
| C0 | registry-derived Look discovery avoids copied menus | complete evidence; current registry/tests own the behavior |
| C1 | elevation must be a resolved brand capability shared by SVG and PNG | Section A transport closed; B0/B1 semantics under `BUILD-31` |
| C2 | a built-in claim needs public-record equivalence and cross-output evidence | Section A parity closed; B1/B5 under `BUILD-31` |
| C3 | borderless design exposed reusable composition, role, color and primitive gaps | Section A mechanics closed; B0/B1/conditional B4 under `BUILD-31` |
| Dark mode | Cupertino dark mode requires a designed mode, not palette inversion | umbrella B2/B5; root `BUILD-31` |
| C5 | publication must teach the public API rather than private face fields | umbrella B1/B5; root `BUILD-31` |

### Evidence package C0 — registry-drift cleanup (complete)

- Hosted MCP, CLI, llms-txt, editor and website derive their style discovery
  metadata from `knownStyleDescriptors()`.
- Drift tests cover every registered Look in both generated descriptions.
- The prototype snapshot based on `0a81c3b` observed Cupertino as discoverable
  by construction. This is retained evidence, not a live catalog count.

### Evidence package C1 — elevation as a brand capability

With A2/A5 transport parity complete, this probe shows that B0/B1 evidence must
demonstrate:

- layered/tinted elevation tokens and resolved role assignment, with any legacy
  render-level `shadow` boolean treated only as a compatibility projection;
- one normalized graphical request through SVG and PNG, reusing the existing
  `buildShadowDefs`/`buildStyleBlock` seam rather than adding a PNG-only subset;
- a dark realization based on hairline-over-lightening or deliberate shadow
  suppression, as recorded separately by the dark-mode evidence;
- default-byte identity plus positive/negative SVG and PNG evidence showing the
  effect appears only when resolved.

This record does not select an implementation or schedule those tests.

### Evidence package C2 — built-in and publication acceptance

The current built-in registration and goldens are prototype evidence, not proof
of the B5 release contract. Publication evidence would need to show
that the public record reproduces the v0.2 appearance, including Cupertino C1
elevation and the dark-mode behavior, without private
expressive privilege. Until then,
`shadow: true` is only a compatibility/reproduction input, not the proposed
brand API.

Evidence captured in the prototype snapshot based on `0a81c3b` includes its
golden-matrix entry and a regenerated `styled-output-baseline.json` with no
unrelated drift. Candidate B5 evidence also includes accurate
use-case-first copy, registry-derived labels, the pure-token rubric rationale,
non-affiliation wording, a design-system example, and a caption command that
reproduces published screenshots. None of those candidate artifacts is owned or
scheduled here.

### Evidence package C3 — the borderless axis

These findings retain their implemented Section A candidate disposition and remain
acceptance cases for B0/B1/conditional B4 under root `BUILD-31`. Implementation
must preserve today's default
crisp bytes and gain discriminating evidence, but this record does not prescribe
a PR:

1. **Colors merge drops undefined channels** (E6a): the invariant is that an
   omitted palette channel cannot erase a prior value; the probe case is
   `['cupertino','zinc-dark']` retaining `--surface`.
2. **Edge-label chips** (E1): the cross-family decision belongs to the umbrella
   primitive-versus-Treatment contract. The probe target is a pill radius,
   `var(--surface)` fill and no stroke without a private edge-face dialect.
3. **Gantt bar stroke fallback** (E5/E9): transparent/absent node border needs a
   visible semantic fallback; Cupertino exposed `var(--border)` plus distinct
   active/critical treatment as the candidate behavior.
4. **State initial/final dot hook** (E7): a normalized start/end status and
   semantic role/binding would let Cupertino select `var(--accent)` while the
   compatibility default remains `var(--_text)`.
5. **Color-mix numeric inlining** (E3): deterministic rgba-over-hex evaluation
   is the candidate parity case for translucent Quadrant output; shared helper
   extraction is related to root TODO `CONS-30`, not owned by C3.
6. **Quadrant point fill** (E4): the probe shows why the applicable data-point
   role needs an accent-aware fill rather than an unconditional node fill.
7. **Architecture header band** (E8) is resolved on main: Architecture projects
   `style.groupHeaderFillColor` into its visual config and
   `--arch-group-band`, matching Timeline and Journey. It remains here only to
   close the discovery trail.

### Dark-mode evidence

The evidence supports a canonical Cupertino `colorScheme: dark` BrandPack mode
under umbrella B2, not a palette inversion: group-fill alpha roughly doubles
(quaternary fill dark is `rgba(118,118,128,0.18)`) and hairlines replace shadows.
If compatibility retains `cupertino-dark`, B2 acceptance would treat it as an
alias/projection of that mode rather than a competing palette or full Look.

Probe palette (Apple dark grouped tokens): bg `#000000`, surface `#1c1c1e`, fg
`#ffffff`, muted `rgba(235,235,245,0.6)` (contrast evidence still required),
line `#98989d` (contrast evidence still required), accent `#0a84ff`, border
`rgba(84,84,88,0.6)`.

### Evidence package C5 — teaching and reproducibility

Umbrella B1/B5 publication evidence should demonstrate that:

- public guidance maps design-system meaning to public tokens/roles, explains
  alpha fills, the type ramp, and constraints, and uses Cupertino only as a
  worked example;
- the redesigned minimal semantic brand layer—not private
  `InternalStyleFace` or arbitrary per-element `style.node` / `style.edge` /
  `style.group` objects—reproduces the example. Historical removal rationale
  remains in
  [`archive/remove-role-styling-plan.md`](./archive/remove-role-styling-plan.md);
- categorical palettes (R2) and the title role (R3) are proven through the
  umbrella role/consumption matrix, not a Cupertino-only renderer branch;
- every published screenshot has a checked reproduction command and does not
  claim Cupertino C1 elevation or the dark-mode behavior before
  the public path supplies it.

Specific documentation and site work admitted by B5 belongs to root `BUILD-31`;
this evidence package carries no separate schedule.

## Acceptance evidence retained by the probe

- The prototype snapshot based on `0a81c3b` passed `bun test src/__tests__/`
  after its golden-matrix addition with no unrelated baseline drift. This is
  historical evidence, not a standing gate owned by this record.
- Section A now owns default crisp byte identity, the SVG-equivalence corpus,
  and cross-output contract evidence. `BUILD-31` owns the additional Cupertino
  cases needed to distinguish each public brand primitive.
- The measured contrast changes (2.92 → 3.82, 2.67 → 4.68) are retained
  facts. A tracker assertion is unscheduled unless it is promoted to the root
  TODO under the umbrella acceptance contract.
- The prototype did not change ASCII/unicode renderers. That observation limits
  the prototype evidence to SVG/PNG; the completed A5 contract owns broader
  terminal semantic-projection claims, not this probe.

## Honest limits

- The source skill is ~70% motion; a static style captures its materials,
  typography, and principles chapters only. The prototype evidence does not
  support a "fluid interfaces" claim. This is specifically a gap in cross-family
  diagram motion tokens; the editor/site shell already animates its own
  interactions, and authored Flowchart edge animation is a narrower Mermaid
  feature.
- Mindmap and GitGraph consume Cupertino's public palette/font path but not its
  internal role-face typography, spacing, radii, or role colors. They remain in
  the all-family evidence to make that limitation visible, not to imply parity.
- `shadow: true` now travels through the shared Section A graphical contract,
  but `style: 'cupertino'` alone still renders flat borderless cards at 1.12:1.
  Shadowed renders cannot serve as publication evidence for the Look alone until
  B1 supplies a semantic elevation primitive in the public style record.
- HIG's own grays fail WCAG here; the prototype uses gate-compliant
  approximations and records the deviation. Its dark-stack evidence covers only
  the specified stack (edges route through `--line`, not `--fg` — a deliberate
  softness trade).
- Skill-section citations were removed from code comments. The numbered
  prototype specification has since been retired, so comments cite Apple token
  names and WWDC session titles directly.

## Mock

Rendered evidence (every family in the prototype snapshot, before/after, dark
stack, findings):
artifact "Cupertino — a built-in Style mock". Regeneration: render each family
with `{ style: 'cupertino', shadow: true, idPrefix: '<family>-' }` via
`renderMermaidSVG`; the flowchart example used throughout is the
Client/Cloud sign-in flow in the artifact.
