/**
 * Playbook and API version this contracts package describes.
 * M1 (BUILD_PLAN.md §14) adds the provider ports, capability model, error taxonomy
 * and the action transition table to this package.
 */
export const OUTREACH_API_VERSION = 'outreach.splitin.net/v1alpha1' as const;

export type OutreachApiVersion = typeof OUTREACH_API_VERSION;

export function isSupportedApiVersion(value: unknown): value is OutreachApiVersion {
  return value === OUTREACH_API_VERSION;
}
