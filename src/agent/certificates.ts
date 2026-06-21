import type {
  EdgeRouteCertificate,
  FamilyEdgeRouteCertificate,
  LayoutRouteCertificate,
  RegionContainmentCertificate,
  RouteCertificate,
} from '../types.ts'

export type LayoutCertificateProof = 'edge-route' | 'region-containment'

export function layoutCertificateProof(cert: LayoutRouteCertificate): LayoutCertificateProof {
  if ('elementId' in cert) return regionContainmentProof(cert)
  return edgeRouteProof(cert)
}

function edgeRouteProof(cert: EdgeRouteCertificate): LayoutCertificateProof {
  if ('family' in cert) return familyEdgeRouteProof(cert)
  return flowchartEdgeRouteProof(cert)
}

function flowchartEdgeRouteProof(cert: RouteCertificate): LayoutCertificateProof {
  switch (cert.invariant) {
    case 'straight':
    case 'explained-detour':
    case 'bundle':
    case 'outer-feedback':
    case 'feedback-detour':
    case 'self-loop':
    case 'container-attach':
    case 'unverified-shape':
      return 'edge-route'
    default:
      return assertNever(cert)
  }
}

function familyEdgeRouteProof(cert: FamilyEdgeRouteCertificate): LayoutCertificateProof {
  switch (cert.family) {
    case 'class':
    case 'er':
      return familyBoxRouteProof(cert.invariant)
    case 'architecture':
      return architectureRouteProof(cert.invariant)
    case 'sequence':
      return sequenceRouteProof(cert.invariant)
    default:
      return assertNever(cert)
  }
}

function familyBoxRouteProof(invariant: Extract<FamilyEdgeRouteCertificate, { family: 'class' | 'er' }>['invariant']): LayoutCertificateProof {
  switch (invariant) {
    case 'orthogonal-box':
    case 'unverified-family-route':
      return 'edge-route'
    default:
      return assertNever(invariant)
  }
}

function architectureRouteProof(invariant: Extract<FamilyEdgeRouteCertificate, { family: 'architecture' }>['invariant']): LayoutCertificateProof {
  switch (invariant) {
    case 'side-anchored':
    case 'unverified-family-route':
      return 'edge-route'
    default:
      return assertNever(invariant)
  }
}

function sequenceRouteProof(invariant: Extract<FamilyEdgeRouteCertificate, { family: 'sequence' }>['invariant']): LayoutCertificateProof {
  switch (invariant) {
    case 'lifeline-message':
    case 'self-message':
    case 'unverified-family-route':
      return 'edge-route'
    default:
      return assertNever(invariant)
  }
}

function regionContainmentProof(cert: RegionContainmentCertificate): LayoutCertificateProof {
  switch (cert.family) {
    case 'timeline':
    case 'xychart':
    case 'pie':
    case 'quadrant':
    case 'gantt':
      return regionInvariantProof(cert.invariant)
    default:
      return assertNever(cert.family)
  }
}

function regionInvariantProof(invariant: RegionContainmentCertificate['invariant']): LayoutCertificateProof {
  switch (invariant) {
    case 'timeline-interval':
    case 'plot-contained':
    case 'legend-contained':
    case 'section-contained':
    case 'unverified-family-layout':
      return 'region-containment'
    default:
      return assertNever(invariant)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled layout certificate variant: ${JSON.stringify(value)}`)
}
