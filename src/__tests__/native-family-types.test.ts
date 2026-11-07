import { expect, test } from 'bun:test'
import { buildMermaid, createMermaid, mutate, mutateChecked } from '../agent/core.ts'
import type { AgentflowValidDiagram, CynefinValidDiagram, RailroadValidDiagram, SwimlaneValidDiagram, TreeviewValidDiagram, UsecaseValidDiagram, VennValidDiagram, WardleyValidDiagram } from '../agent/types.ts'

// Compiled by the regular typecheck. This contract also checks the general
// dispatcher overload cannot admit another family's operations for a literal.
function compileTimeNativeFamilies(): void {
  const agentflow: AgentflowValidDiagram = createMermaid('agentflow')
  const builtAgentflow = buildMermaid('agentflow', [{ kind: 'add_node', id: 'A', label: 'Task' }])
  if (builtAgentflow.ok) {
    const precise: AgentflowValidDiagram = builtAgentflow.value
    void precise
  }
  const editedAgentflow = mutate(agentflow, { kind: 'add_node', id: 'A', label: 'Task' })
  if (editedAgentflow.ok) {
    const precise: AgentflowValidDiagram = editedAgentflow.value
    void precise
  }
  const checkedAgentflow = mutateChecked(agentflow, {} as unknown)
  if (checkedAgentflow.ok) {
    const precise: AgentflowValidDiagram = checkedAgentflow.value
    void precise
  }
  const cynefin: CynefinValidDiagram = createMermaid('cynefin')
  const builtCynefin = buildMermaid('cynefin', [{ kind: 'add_item', domain: 'complex', label: 'Explore' }])
  if (builtCynefin.ok) {
    const precise: CynefinValidDiagram = builtCynefin.value
    void precise
  }
  const editedCynefin = mutate(cynefin, { kind: 'add_item', domain: 'complex', label: 'Explore' })
  if (editedCynefin.ok) {
    const precise: CynefinValidDiagram = editedCynefin.value
    void precise
  }
  const checkedCynefin = mutateChecked(cynefin, {} as unknown)
  if (checkedCynefin.ok) {
    const precise: CynefinValidDiagram = checkedCynefin.value
    void precise
  }
  const railroad: RailroadValidDiagram = createMermaid('railroad')
  const builtRailroad = buildMermaid('railroad', [{ kind: 'add_rule', name: 'entry', definition: { type: 'terminal', value: 'a' } }])
  if (builtRailroad.ok) {
    const precise: RailroadValidDiagram = builtRailroad.value
    void precise
  }
  const editedRailroad = mutate(railroad, { kind: 'add_rule', name: 'entry', definition: { type: 'terminal', value: 'a' } })
  if (editedRailroad.ok) {
    const precise: RailroadValidDiagram = editedRailroad.value
    void precise
  }
  const checkedRailroad = mutateChecked(railroad, {} as unknown)
  if (checkedRailroad.ok) {
    const precise: RailroadValidDiagram = checkedRailroad.value
    void precise
  }
  const swimlane: SwimlaneValidDiagram = createMermaid('swimlane')
  const builtSwimlane = buildMermaid('swimlane', [{ kind: 'add_node', id: 'A', label: 'Task' }])
  if (builtSwimlane.ok) {
    const precise: SwimlaneValidDiagram = builtSwimlane.value
    void precise
  }
  const editedSwimlane = mutate(swimlane, { kind: 'add_node', id: 'A', label: 'Task' })
  if (editedSwimlane.ok) {
    const precise: SwimlaneValidDiagram = editedSwimlane.value
    void precise
  }
  const checkedSwimlane = mutateChecked(swimlane, {} as unknown)
  if (checkedSwimlane.ok) {
    const precise: SwimlaneValidDiagram = checkedSwimlane.value
    void precise
  }
  const treeview: TreeviewValidDiagram = createMermaid('treeview')
  const builtTreeview = buildMermaid('treeview', [{ kind: 'add_node', label: 'root' }])
  if (builtTreeview.ok) {
    const precise: TreeviewValidDiagram = builtTreeview.value
    void precise
  }
  const editedTreeview = mutate(treeview, { kind: 'add_node', label: 'root' })
  if (editedTreeview.ok) {
    const precise: TreeviewValidDiagram = editedTreeview.value
    void precise
  }
  const checkedTreeview = mutateChecked(treeview, {} as unknown)
  if (checkedTreeview.ok) {
    const precise: TreeviewValidDiagram = checkedTreeview.value
    void precise
  }
  const usecase: UsecaseValidDiagram = createMermaid('usecase')
  const builtUsecase = buildMermaid('usecase', [{ kind: 'add_actor', id: 'A', label: 'Actor' }])
  if (builtUsecase.ok) {
    const precise: UsecaseValidDiagram = builtUsecase.value
    void precise
  }
  const editedUsecase = mutate(usecase, { kind: 'add_actor', id: 'A', label: 'Actor' })
  if (editedUsecase.ok) {
    const precise: UsecaseValidDiagram = editedUsecase.value
    void precise
  }
  const checkedUsecase = mutateChecked(usecase, {} as unknown)
  if (checkedUsecase.ok) {
    const precise: UsecaseValidDiagram = checkedUsecase.value
    void precise
  }
  const venn: VennValidDiagram = createMermaid('venn')
  const builtVenn = buildMermaid('venn', [{ kind: 'set_subset', sets: ['A'], size: 10 }])
  if (builtVenn.ok) {
    const precise: VennValidDiagram = builtVenn.value
    void precise
  }
  const editedVenn = mutate(venn, { kind: 'set_subset', sets: ['A'], size: 10 })
  if (editedVenn.ok) {
    const precise: VennValidDiagram = editedVenn.value
    void precise
  }
  const checkedVenn = mutateChecked(venn, {} as unknown)
  if (checkedVenn.ok) {
    const precise: VennValidDiagram = checkedVenn.value
    void precise
  }
  const wardley: WardleyValidDiagram = createMermaid('wardley')
  const builtWardley = buildMermaid('wardley', [{ kind: 'add_component', id: 'A', x: 50, y: 50 }])
  if (builtWardley.ok) {
    const precise: WardleyValidDiagram = builtWardley.value
    void precise
  }
  const editedWardley = mutate(wardley, { kind: 'add_component', id: 'A', x: 50, y: 50 })
  if (editedWardley.ok) {
    const precise: WardleyValidDiagram = editedWardley.value
    void precise
  }
  const checkedWardley = mutateChecked(wardley, {} as unknown)
  if (checkedWardley.ok) {
    const precise: WardleyValidDiagram = checkedWardley.value
    void precise
  }
  // @ts-expect-error TreeView has no actor declaration operation.
  buildMermaid('treeview', [{ kind: 'add_actor', id: 'A' }])
  // @ts-expect-error A concrete UseCase diagram cannot accept a TreeView node operation.
  mutate(usecase, { kind: 'add_node', label: 'Root' })
  // @ts-expect-error Railroad expressions require string terminal values.
  buildMermaid('railroad', [{ kind: 'add_rule', name: 'entry', definition: { type: 'terminal', value: 5 } }])
  // @ts-expect-error Venn subset sizes are numeric.
  buildMermaid('venn', [{ kind: 'set_subset', sets: ['A'], size: 'large' }])
}
void compileTimeNativeFamilies

test('typed family authoring clients build native models through the public API', () => {
  const agentflow = buildMermaid('agentflow', [{ kind: 'add_node', id: 'A', label: 'Task' }])
  expect(agentflow.ok && agentflow.value.body.kind).toBe('agentflow')
  const cynefin = buildMermaid('cynefin', [{ kind: 'add_item', domain: 'complex', label: 'Explore' }])
  expect(cynefin.ok && cynefin.value.body.kind).toBe('cynefin')
  const railroad = buildMermaid('railroad', [{ kind: 'add_rule', name: 'entry', definition: { type: 'terminal', value: 'a' } }])
  expect(railroad.ok && railroad.value.body.kind).toBe('railroad')
  const swimlane = buildMermaid('swimlane', [{ kind: 'add_node', id: 'A', label: 'Task' }])
  expect(swimlane.ok && swimlane.value.body.kind).toBe('swimlane')
  const treeview = buildMermaid('treeview', [{ kind: 'add_node', label: 'root' }])
  expect(treeview.ok && treeview.value.body.kind).toBe('treeview')
  const usecase = buildMermaid('usecase', [{ kind: 'add_actor', id: 'A', label: 'Actor' }])
  expect(usecase.ok && usecase.value.body.kind).toBe('usecase')
  const venn = buildMermaid('venn', [{ kind: 'set_subset', sets: ['A'], size: 10 }])
  expect(venn.ok && venn.value.body.kind).toBe('venn')
  const wardley = buildMermaid('wardley', [{ kind: 'add_component', id: 'A', x: 50, y: 50 }])
  expect(wardley.ok && wardley.value.body.kind).toBe('wardley')
})
