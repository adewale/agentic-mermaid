// ============================================================================
// Sequence participant creation rules, faithful to pinned Mermaid 11.16.
//
// Which statement creates, names, places (in a `box`) or links a participant
// is decided in one place: the statement grammar turns a line into ParticipantEvents
// (`sequenceParticipantEvents` in ./parser.ts), and SequenceParticipantFold
// applies them in source order exactly as upstream's `sequenceDb.ts` does
// (`addActor`, `insertLinks`). The renderer parser and the typed body both
// fold the same events, and the typed body's serializer and mutations read
// the same events to decide where a declaration must go.
//
// Upstream's grammar hands every actor reference to `addActor`: a message
// names its two ends, a note its actors, `link`/`links` its actor, all as
// bare mentions; `participant`/`actor` (and `create`) declare. `activate`,
// `deactivate` and `destroy` reference an actor without creating it.
//
// Two readings are ours, not upstream's: a naming declaration keeps the
// actor's links (upstream drops them, BUG-16), and an actor a second box
// meets stays in its first box (upstream rejects the diagram).
// ============================================================================

import type { SequenceActorType } from './types.ts'

export type ParticipantEvent =
  /** An actor reference with no description: creates a plain participant
   * the first time, and changes nothing afterwards. */
  | { kind: 'mention'; id: string }
  /** A `participant`/`actor` declaration. `label` is present only when it
   * names the actor (`as …` or a metadata alias): only a naming declaration
   * changes an actor that already exists. `create` marks `create
   * participant …`, which never changes a known actor. */
  | { kind: 'declare'; id: string; keyword: 'participant' | 'actor'; type: SequenceActorType; label?: string; create?: true }
  /** Safe actor-menu links, merged into the actor's links. */
  | { kind: 'links'; id: string; links: Record<string, string> }

export interface SequenceParticipantRecord {
  id: string
  label: string
  type: SequenceActorType
  /** Keyword of the declaration that created or last named it; absent for a
   * participant that was only mentioned. */
  keyword?: 'participant' | 'actor'
  links?: Record<string, string>
  /** Index (in opening order) of the box upstream places it in. */
  box?: number
}

/** A `box … end` group as the fold sees it: upstream's `actorKeys`. */
export interface SequenceParticipantBox {
  label?: string
  actorIds: string[]
}

export interface SequenceParticipantFoldOptions {
  /** Hears a participant a second box meets: upstream rejects that, and ours
   * keeps the participant in the box that first placed it. */
  onBoxConflict?: (id: string) => void
  /** Fold as Mermaid 11.16 does, where a naming declaration drops the
   * actor's links (BUG-16); ours keeps them. The typed serializer asks this
   * to write links again where Mermaid would lose them. */
  upstreamLinks?: boolean
}

/** The participants a sequence of events creates, in upstream's order. */
export class SequenceParticipantFold {
  private readonly records = new Map<string, SequenceParticipantRecord>()
  private readonly order: string[] = []
  private readonly boxes: SequenceParticipantBox[] = []
  private currentBox: number | undefined

  constructor(private readonly options: SequenceParticipantFoldOptions = {}) {}

  apply(event: ParticipantEvent): void {
    if (event.kind === 'links') {
      const record = this.records.get(event.id)
      if (record) record.links = { ...record.links, ...event.links }
      return
    }
    this.addActor(event.id, event.kind === 'declare' ? event : undefined)
  }

  applyAll(events: readonly ParticipantEvent[]): void {
    for (const event of events) this.apply(event)
  }

  /** Statements until `closeBox` are inside `box`. */
  openBox(box: SequenceParticipantBox): void {
    this.boxes.push(box)
    this.currentBox = this.boxes.length - 1
  }

  closeBox(): void {
    this.currentBox = undefined
  }

  has(id: string): boolean {
    return this.records.has(id)
  }

  /** Position in creation order; stable once created. */
  indexOf(id: string): number {
    return this.order.indexOf(id)
  }

  list(): SequenceParticipantRecord[] {
    return this.order.map(id => this.records.get(id)!)
  }

  /** Upstream's `addActor`. Every statement that meets an actor inside a box
   * places it there, once; only a statement that creates or renames it
   * lists it in the box's keys. A naming declaration names the actor again,
   * and its links stay (upstream drops them: `upstreamLinks`); any other
   * statement about a known actor changes nothing else. A second box that
   * meets an actor is an error upstream; ours keeps the actor in its first
   * box and tells `onBoxConflict`. */
  private addActor(id: string, declaration: Extract<ParticipantEvent, { kind: 'declare' }> | undefined): void {
    const old = this.records.get(id)
    let box = this.currentBox
    if (old) {
      if (box !== undefined && old.box !== undefined && box !== old.box) {
        this.options.onBoxConflict?.(id)
      }
      box = old.box ?? box
      if (box !== undefined) old.box = box
      if (declaration?.label === undefined || declaration.create) return
    }
    const record: SequenceParticipantRecord = {
      id,
      label: declaration?.label ?? id,
      type: declaration?.type ?? 'participant',
      ...(declaration ? { keyword: declaration.keyword } : {}),
      ...(old?.links && !this.options.upstreamLinks ? { links: old.links } : {}),
      ...(box !== undefined ? { box } : {}),
    }
    this.records.set(id, record)
    if (!old) this.order.push(id)
    if (this.currentBox !== undefined && box === this.currentBox) this.boxes[this.currentBox]!.actorIds.push(id)
  }
}
