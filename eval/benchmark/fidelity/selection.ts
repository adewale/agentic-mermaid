/** Core public-model adapters own these project identities. Other projects use
 * the community capability lane, so explicit peer-only selection prepares none
 * of the core source, reference, runtime or filesystem prerequisites. */
export const fidelityCoreProjects = { agentic: 'adewale/agentic-mermaid', pele: 'obsidianmd/pele', mermaid: 'mermaid-js/mermaid' } as const
export const selectsCoreFidelity = (projects?: readonly string[]) => !projects || Object.values(fidelityCoreProjects).some(project => projects.includes(project))
