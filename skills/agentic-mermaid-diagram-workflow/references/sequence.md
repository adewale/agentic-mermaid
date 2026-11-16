# Sequence diagram syntax

```
sequenceDiagram
  participant Alice
  actor Bob
  Alice->>Bob: Hi
  Bob-->>Alice: Hello
```

Participants: `participant A`, `participant A as Label`, `actor A`. Also declared
implicitly by first message reference.

Arrows → style: `->>` sync, `-->>` reply, `->` line, `-->` line-dashed (no
head), `-)` async, `--)` async-dashed (open head), `-x` lost, `--x`
lost-dashed, `<<->>` bidirectional, `<<-->>` bidirectional-dashed. Half-arrows
(`-|\` …) keep their operator in `arrow`; facts state it.

MutationOps include participant/top-level message edits plus `add_fragment`,
`remove_fragment`, fragment/branch label edits, fragment-message add/remove/
text edits, and note edits: `add_note` (`position` left/right/over,
`actorIds`, `text`, placed with `afterMessage` or `beforeMessage`, a top-level
message index, else appended), `remove_note`, `set_note_text` and `move_note`
for top-level notes, and `add_fragment_note`, `remove_fragment_note`,
`set_fragment_note_text` and `move_fragment_note` (with `fragmentIndex`,
`branchIndex`; anchors are branch message indexes) for notes in a branch.
Facts number notes in drawing order (`note#N`) and state each one's address:
`note#N op index K` or `note#N op fragmentIndex F branchIndex B index K`.

Indexes: facts number messages in drawing order, fragment messages included
(`message#N`), so N is not what the ops take. Each message's address is its
own fact: `message#N op index K` for a top-level message (pass K as `index`,
`afterMessage`, `beforeMessage`, `from`/`to` of `move_message`) and
`message#N op fragmentIndex F branchIndex B index K` for a fragment message
(pass all three to the fragment-message ops).

Nested fragments: a fragment inside another fragment's branch is typed too,
to any depth up to the host nesting limit (64). Every fragment op takes an
optional `fragmentPath`, a list of `{ fragmentIndex, branchIndex }` steps from
the top level down to the branch that holds the fragment; its own
`fragmentIndex` (or `index` for `add_fragment`, `remove_fragment` and
`set_fragment_label`) then counts the fragments of that branch. Omitted, the
op addresses the top level as before. Facts name a nested fragment by its
path (`fragment#0.1.0` is fragment 0 of branch 1 of top-level fragment 0) and
state the fields to pass, the path as JSON:
`message#N op fragmentPath [{"fragmentIndex":0,"branchIndex":1}] fragmentIndex 0 branchIndex 0 index 0`,
and likewise for `note#N op …` and `fragment#… op …`. `add_fragment` with a
path appends the new fragment to that branch (or puts it before fragment
`index` there). `add_fragment` also takes `afterMessage` or `beforeMessage`,
placed as a note's anchors place it: a top-level message index, or with
`fragmentPath` an index among that branch's messages. `move_fragment`
(`fragmentPath`, `index`, an anchor) moves a fragment and its contents within
its own scope, or with `toFragmentPath` into another branch (the branch's
`fragmentPath` plus `{ fragmentIndex, branchIndex }`, read before the move;
`[]` is the top level), its anchors then counting that branch's messages. A
move into the fragment itself or one nested in it, or past the nesting limit,
is refused. An edit inside a nested fragment rewrites it and the
fragments around it; nested fragments are written one level deeper than the
statements beside them, and untouched ones keep their authored lines.

IMPORTANT — segment-preserving fidelity: `alt`, `opt`, `loop`, `par`,
`par_over`, `critical` (branches continue with `option`), `break` and `rect`
(its label is the fill color, a CSS color) are typed fragments. Their
messages appear in describe/facts/verify and fragment ops can author or edit
them. `create participant|actor` and `destroy` lines and `Note left of|right
of|over …` lines are typed statements too, at top level and inside those
fragments (facts: `create …`, `destroy …`, with `fragment#f branch#b` inside a
fragment); an edit that would separate a directive from the message Mermaid
requires right after it is refused. An edit that would leave a
deactivation (a `deactivate` line or a message's `-` mark) of a participant
that is not active, which Mermaid rejects, is refused naming that line:
remove or move it too, or keep its activation. A fragment may hold further fragments
(see Nested fragments above). Other constructs (box/activate/autonumber/title,
a comment) ride along VERBATIM as opaque-block segments, at top level and
inside a fragment branch, in source order, while participant, message and
fragment ops remain live; a kept branch line never holds a message or note,
so branch indexes count them all. A fragment stays one opaque segment only
when its kept lines would hide a message or note (a nested `rect` the
renderer reads no color for, a box holding more than declarations, a note
the writer cannot spell) or nests past 64 (verify says so). Only an un-segmentable
diagram (a stray `end`, an unclosed block) falls back to a whole-body OPAQUE
body. Either way the parser never silently drops constructs.

Verify: Tier 1 EMPTY_DIAGRAM, EDGE_MISANCHORED (message references missing
participant), LABEL_OVERFLOW (participant label or message text over char cap);
layout-geometry checks on the sequence layout (OFF_CANVAS, GROUP_BREACH,
NODE_OVERLAP); and UNSUPPORTED_SYNTAX naming verbatim segments.

Upstream: https://mermaid.js.org/syntax/sequenceDiagram.html
