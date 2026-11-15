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

IMPORTANT — segment-preserving fidelity: `alt`, `opt`, `loop`, `par`,
`par_over`, `critical` (branches continue with `option`), `break` and `rect`
(its label is the fill color, a CSS color) are typed fragments. Their
messages appear in describe/facts/verify and fragment ops can author or edit
them. `create participant|actor` and `destroy` lines and `Note left of|right
of|over …` lines are typed statements too, at top level and inside those
fragments (facts: `create …`, `destroy …`, with `fragment#f branch#b` inside a
fragment); an edit that would separate a directive from the message Mermaid
requires right after it is refused. Other constructs (a fragment nested in
another, box/activate/autonumber/title) ride along VERBATIM as opaque-block
segments while
participant and top-level message ops remain live. Only an un-segmentable
diagram (a stray `end`, an unclosed block) falls back to a whole-body OPAQUE
body. Either way the parser never silently drops constructs.

Verify: Tier 1 EMPTY_DIAGRAM, EDGE_MISANCHORED (message references missing
participant), LABEL_OVERFLOW (participant label or message text over char cap);
layout-geometry checks on the sequence layout (OFF_CANVAS, GROUP_BREACH,
NODE_OVERLAP); and UNSUPPORTED_SYNTAX naming verbatim segments.

Upstream: https://mermaid.js.org/syntax/sequenceDiagram.html
