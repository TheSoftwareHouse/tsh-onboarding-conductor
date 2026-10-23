/**
 * Where an onboarding's documents live in object storage. The client upload flow stages under one
 * key and promotes to the other; a connector-written document (`ConnectorDocumentStore`) is born
 * at the final key.
 */
export const buildStagingObjectKey = (onboardingId: string, documentId: string): string =>
  `onboardings/${onboardingId}/${documentId}/staged`;

export const buildFinalObjectKey = (onboardingId: string, documentId: string): string =>
  `onboardings/${onboardingId}/${documentId}/final`;
