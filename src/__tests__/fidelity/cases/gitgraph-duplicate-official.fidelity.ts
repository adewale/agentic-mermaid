import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { GitGraphDuplicateCommitError } from '../../../gitgraph/parser.ts'
import { renderMermaidSVG } from '../../../index.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// The official mainBranchName example contains two custom commits named
// Boston. Pinned Mermaid 11.16 logs a duplicate-ID warning and continues;
// Agentic Mermaid refuses ambiguous structured identity and native rendering.
const markdown = readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'skills/agentic-mermaid-diagram-workflow/references/upstream/gitgraph.md'), 'utf8')
const matchingFences = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)]
  .map(match => match[1]!.trim())
  .filter(fence => fence.includes("mainBranchName: 'MetroLine1'") && (fence.match(/commit id:"Boston"/g) ?? []).length === 2)
if (matchingFences.length !== 1) throw new Error('Expected one exact official duplicate-Boston GitGraph fence')
const source = `${matchingFences[0]}\n`

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  if (!evidence.semantics || typeof evidence.semantics !== 'object' || Array.isArray(evidence.semantics)) {
    throw new Error('GitGraph duplicate-ID evidence must be an object')
  }
  return evidence.semantics as Record<string, FidelityJson>
}

const duplicateOfficialCommitId: FidelityCaseDefinition = {
  id: 'gitgraph.official.main-branch-duplicate-id-diagnosed',
  family: 'gitgraph',
  featureId: 'official-doc:gitgraph:section:customizing-main-branch-name',
  source,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/gitgraph.html#customizing-main-branch-name',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  expected: {
    agent: { applicability: 'applicable', disposition: 'source-preserved', diagnosticCodes: ['RENDER_FAILED', 'UNSUPPORTED_SYNTAX'],
      evaluate: evidence => facts(evidence).bodyKind === 'opaque' && facts(evidence).sourcePreserved === true
        && facts(evidence).duplicateId === 'Boston' && facts(evidence).verifyRejected === true
        && facts(evidence).warningSyntax === 'gitgraph_duplicate_commit_id'
        && facts(evidence).remediationNamed === true && facts(evidence).renderFailureNamesDuplicate === true
        ? 'source-preserved' : 'absent' },
    render: { applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['GITGRAPH_DUPLICATE_COMMIT_ID'],
      evaluate: evidence => facts(evidence).duplicateId === 'Boston' && facts(evidence).renderRejected === true ? 'diagnosed' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'source-preserved',
      evaluate: evidence => facts(evidence).exactSource === true ? 'source-preserved' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['INVALID_OP'],
      evaluate: evidence => facts(evidence).rejected === true ? 'diagnosed' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('Official duplicate-ID fence should be preserved by the typed agent')
    const verification = verifyMermaid(parsed.value)
    const warning = verification.warnings.find(item => item.code === 'UNSUPPORTED_SYNTAX')
    const renderFailure = verification.warnings.find(item => item.code === 'RENDER_FAILED')
    let renderError: unknown
    try { renderMermaidSVG(source, { embedFontImport: false }) } catch (error) { renderError = error }
    const mutation = mutate(parsed.value, { kind: 'append_commit', id: 'after-duplicate' })
    return {
      agent: { status: 'observed', diagnosticCodes: verification.warnings.map(warning => warning.code),
        semantics: { bodyKind: parsed.value.body.kind, sourcePreserved: serializeMermaid(parsed.value) === source,
          duplicateId: parsed.value.body.kind === 'opaque' ? parsed.value.body.diagnostic?.id ?? null : null,
          verifyRejected: !verification.ok,
          warningSyntax: warning?.code === 'UNSUPPORTED_SYNTAX' ? warning.syntax : null,
          remediationNamed: warning?.code === 'UNSUPPORTED_SYNTAX' && warning.message.includes('Rename one duplicate ID'),
          renderFailureNamesDuplicate: renderFailure?.code === 'RENDER_FAILED'
            && renderFailure.reason.includes("Duplicate gitGraph commit id 'Boston'") } },
      render: { status: 'observed', diagnosticCodes: renderError instanceof GitGraphDuplicateCommitError ? [renderError.code] : [],
        semantics: { duplicateId: renderError instanceof GitGraphDuplicateCommitError ? renderError.id : null,
          renderRejected: renderError instanceof GitGraphDuplicateCommitError } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { exactSource: serializeMermaid(parsed.value) === source } },
      mutate: { status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: { rejected: !mutation.ok } },
    }
  },
}

export const fidelityCases = [duplicateOfficialCommitId] as const satisfies readonly FidelityCaseDefinition[]
