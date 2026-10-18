// The crisp renderer does not need the sketch implementations. Full-library
// and explicitly styled entries enroll the other backends separately.
import { DefaultBackend, registerBuiltInBackend } from './backend.ts'

registerBuiltInBackend(DefaultBackend)
