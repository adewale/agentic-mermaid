import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const baseline = '/tmp/issue619-implementation-20261120/v13-pipeline/qualification-final'
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'))
const sha = data => createHash('sha256').update(data).digest('hex')
const filename = '/tmp/issue619-followup-20261121/package-c18f6073/package/dist/agent.js'
const finalBytes = fs.readFileSync(filename)
const api = await import(pathToFileURL(filename))
fs.mkdirSync(join(here,'renders'),{recursive:true})
const priorRows = new Map(read('/tmp/issue619-kink-20261120/aesthetics.json').rows.map(row => [row.id, row]))
const archived = '/tmp/issue619-kink-20261120/renders'
const rows = []
const metrics = quality => ({
  crossings: quality.metrics.edgeCrossings, bends: quality.metrics.routeGeometry.bends,
  wire: quality.metrics.routeGeometry.length, area: quality.metrics.routeGeometry.area,
  parallel: quality.metrics.routeOverlaps.parallel, opposing: quality.metrics.routeOverlaps.opposing,
  labelConflicts: quality.metrics.labelConflicts.total
})
for (const sample of read(join(baseline,'plan.json')).cases) {
  const { id, source, sourceSha256, elkOptions: options } = sample
  const prior = priorRows.get(id)
  assert.equal(sha(source),sourceSha256)
  assert.equal(prior.sourceSha256,sourceSha256)
  const priorSvg = fs.readFileSync(join(archived, id+'.svg'))
  const priorProduct = {layout:read(join(archived,id+'.layout.json'))}
  const priorReceipt = read(join(archived,id+'.receipt.json'))
  prior.svgSha256 = prior.svg
  prior.archivedQualityOK = prior.quality
  prior.verification = { ok:prior.verified, warnings:(prior.warnings ?? []).map(code=>({code})) }
  prior.svgProof = priorReceipt.layoutCertification
  assert.equal(sha(priorSvg), prior.svgSha256)
  const render = api.renderMermaidSVGWithReceipt(source, options)
  const layout = api.layoutMermaidWithReceipt(source, {...options,debug:true}).layout
  const productLayout = JSON.parse(JSON.stringify(layout))
  const quality = JSON.parse(JSON.stringify(api.checkQuality(layout)))
  const verification = JSON.parse(JSON.stringify(api.verifyMermaid(source, {renderOptions:options})))
  const warnings = verification.warnings?.map(warn => warn.code)
  const priorWarnings = prior.verification.warnings?.map(warn => warn.code)
  const certificate = render.receipt.layoutCertification
  const priorCertificate = prior.svgProof
  fs.writeFileSync(join(here,'renders',id+'.svg'),render.svg)
  fs.writeFileSync(join(here,'renders',id+'.receipt.json'),JSON.stringify(render.receipt,null,2))
  fs.writeFileSync(join(here,'renders',id+'.layout.json'),JSON.stringify(productLayout,null,2))
  assert.equal(certificate.scope, priorCertificate.scope)
  rows.push({id,sourceSha256,svg:sha(render.svg),priorSvg:prior.svgSha256,
    sameSvg:sha(render.svg)===prior.svgSha256,sameLayout:isDeepStrictEqual(priorProduct.layout,productLayout),
    sameQuality:isDeepStrictEqual(metrics(quality),prior.final),sameVerify:verification.ok===prior.verification.ok && isDeepStrictEqual(warnings,priorWarnings),
    sameEntireReceipt:isDeepStrictEqual(JSON.parse(JSON.stringify(render.receipt)),priorReceipt),sameProof:isDeepStrictEqual(JSON.parse(JSON.stringify(certificate)), priorCertificate),prior:prior.final,final:metrics(quality),
    priorProof:priorCertificate.status,proof:certificate.status,priorIssues:priorCertificate.issues?.length,issues:certificate.issues?.length,
    priorQuality:prior.archivedQualityOK,quality:quality.ok,priorVerified:prior.verification.ok,verified:verification.ok,
    priorWarnings,warnings,selected:render.receipt.layoutDecisions?.map(entry=>entry.selected)})
}
const result={qualityScope:'Archived seven route/label metric fields plus actual public quality boolean; no reconstructed ownership verdict',verifyScope:'Archived verification status and warning codes',revision:'c18f607364ca1d85dd91a669c8ac33a2c7173a23; build-input-c18f6073.json',publicEntry:filename,entrySha256:sha(finalBytes),node:process.version,
  baselinePackage:'/tmp/issue619-kink-20261120/package/package',rows}
fs.writeFileSync(join(here,'aesthetics.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({cases:rows.length,exactLayout:rows.filter(r=>r.sameLayout).length,exactSvg:rows.filter(r=>r.sameSvg).length,
   exactQuality:rows.filter(r=>r.sameQuality).length,exactReceipt:rows.filter(r=>r.sameEntireReceipt).length,exactVerify:rows.filter(r=>r.sameVerify).length,
   passedPaint:rows.filter(r=>r.proof==='passed').length,verifyOK:rows.filter(r=>r.verified).length,
   changed:rows.filter(r=>!r.sameSvg).map(r=>({id:r.id,prior:r.prior,final:r.final})),warningChanges:rows.filter(r=>!isDeepStrictEqual(r.warnings,r.priorWarnings)).map(r=>r.id)}))
