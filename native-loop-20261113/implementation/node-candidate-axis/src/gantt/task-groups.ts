/** Preserve authored task order within each model section, including repeated
 * section labels whose numeric identities remain distinct. */
export function groupGanttTasksBySection<T extends { sectionIndex: number }>(tasks: readonly T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>()
  for (const task of tasks) {
    let group = groups.get(task.sectionIndex)
    if (!group) groups.set(task.sectionIndex, group = [])
    group.push(task)
  }
  return groups
}
