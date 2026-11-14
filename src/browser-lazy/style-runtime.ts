/** Only renderer-consumed bindings cross the private provider boundary.
 * Node's registry/schema/registration surface stays in its synchronous entry. */
export {
  inferBackend,
  isStyledSpec,
  resolveStyleReference,
  resolveStyleStack,
  resolveStyleStackWithFace,
  styleRegistryRevision,
} from '../scene/style-registry.ts'

export { STYLE_OPTION_VALIDATION_ROOT } from '../render-style-option-schema.ts'
