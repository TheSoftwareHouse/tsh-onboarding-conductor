// This schema-driven route is the sole local exception to fixed DTO validation:
// configured field names must reach the runtime without whitelist stripping.
export type DynamicSubmitBody = Record<string, unknown>;

export type SubmitOnboardingDto = DynamicSubmitBody;
