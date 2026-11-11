/** The source-only async adapter loads the canonical SPI when Scene rendering
 * is selected. Node/SDK entries keep importing this authority synchronously. */
export {
  DefaultBackend, getBackendDescriptor, isBuiltinDefaultBackend,
  isOriginalEnrolledDefaultBackend, assertBackendConformance,
  registerBuiltInBackend, composeGroup, pageRectFor, capturedPart,
} from '../scene/backend.ts'
