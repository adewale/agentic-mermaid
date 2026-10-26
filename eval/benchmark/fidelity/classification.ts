export interface FamilyPolicy { families: { id: string; maturity: string }[] }
export interface AdmissionAttempt { accepted: boolean; error?: string; qualificationFindings?: string[] }
export interface AdmissionClassification {
  family: string
  maturity: string
  required: boolean
  admission: boolean
  cause: 'returned-output' | 'required-family-unavailable' | 'optional-family-unavailable' | 'security-policy' | 'environment' | 'source-rejection' | 'output-qualification' | 'runtime-or-unclassified'
  drawingFidelity: 'unmeasured'
  evidence: string[]
}

/** Preserve raw admission. A cause is an explanatory dimension, never a way to
 * turn rejection into acceptance or SVG text into a drawing-fidelity pass. */
export function classifyAdmission(policy: FamilyPolicy, family: string, attempt: AdmissionAttempt): AdmissionClassification {
  const maturity = ['eventmodeling', 'zenuml'].includes(family) ? 'review-required' : policy.families.find(item => item.id === family)?.maturity ?? 'unknown'
  const required = maturity === 'stable' || maturity === 'review-required'
  const error = attempt.error ?? '', findings = attempt.qualificationFindings ?? []
  let cause: AdmissionClassification['cause'] = 'runtime-or-unclassified'
  if (attempt.accepted && !findings.length) cause = 'returned-output'
  else if (findings.length) cause = 'output-qualification'
  else if (/^RenderConfigError: Raw Mermaid themeCSS is not allowed in default security mode/.test(error)) cause = 'security-policy'
  else if (/^EncodingError: The source image cannot be decoded\./.test(error) || /^(?:NetworkError|TimeoutError):/.test(error)) cause = 'environment'
  else if (/^(?:UnknownDiagramError: No diagram type detected|PeleError: No diagram type detected|(?:BrowserFamilyDetectionError|MermaidFamilyDetectionError): Unsupported Mermaid family)/.test(error)) cause = required ? 'required-family-unavailable' : 'optional-family-unavailable'
  else if (/^(?:Error|PeleError): (?:Parse error on line|Lexical error on line|Parsing failed:)/.test(error)) cause = 'source-rejection'
  return { family, maturity, required, admission: attempt.accepted && !findings.length, cause, drawingFidelity: 'unmeasured', evidence: [...(error ? [error] : []), ...findings] }
}

export function compareAdmission(peer: AdmissionClassification, baseline: AdmissionClassification) {
  if (peer.family !== baseline.family) throw Error('Admission comparison requires the same family; callers must join the same source occurrence')
  return {
    admissionDifference: Number(peer.admission) - Number(baseline.admission),
    outcome: peer.admission ? baseline.admission ? 'both-returned-output' : 'peer-only-output' : baseline.admission ? 'baseline-only-output' : 'neither-returned-output',
    peerCause: peer.cause,
    baselineCause: baseline.cause,
    fidelityConclusion: 'No drawing-fidelity conclusion from admission alone',
  }
}

/** Every reference case stays visible, including a bad fixture or unavailable
 * projection. Only independently checked, reference-passing criteria can enter
 * a fidelity comparison; raw outcomes are retained alongside that cohort. */
export function calibrateCriteria(rows: { tool: string; caseId: string; criterion: string; status: string }[], baseline = 'mermaid-js/mermaid') {
  const reference = rows.filter(row => row.tool === baseline)
  const keys = new Set<string>()
  for (const row of reference) { const key = JSON.stringify([row.caseId, row.criterion]); if (keys.has(key)) throw Error('Duplicate reference criterion'); keys.add(key) }
  return {
    baseline,
    calibrated: reference.filter(row => row.status === 'passed').map(row => ({ caseId: row.caseId, criterion: row.criterion })),
    reviewRequired: reference.filter(row => row.status !== 'passed').map(row => ({ caseId: row.caseId, criterion: row.criterion, status: row.status, reason: row.status === 'unavailable' || row.status === 'unsupported' ? 'Required reference evidence unavailable; not a peer pass or failure' : 'Review source, expected criterion, observer and actual reference output before a fidelity ranking' })),
    rawPopulation: reference.length,
  }
}
