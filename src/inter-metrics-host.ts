import type { ProfileTextMeasurementInput, TextMeasurementProfile } from './text-measurement-profile.ts'
import { registerEstimatedTextFallback, registerImmutableTextMeasurement } from './text-measurement-profile.ts'
export function registerInterMetrics(profile: TextMeasurementProfile, covers: (input: Readonly<ProfileTextMeasurementInput>) => boolean): TextMeasurementProfile {
  registerImmutableTextMeasurement(profile)
  registerEstimatedTextFallback(profile, covers)
  return profile
}
