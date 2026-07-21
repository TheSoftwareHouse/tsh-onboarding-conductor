export type DemoBffAppConfig = {
  engineBaseUrl: string;
  engineServiceSecret: string;
  demoWorkflowId: string;
};

export function loadAppConfig(env: NodeJS.ProcessEnv): DemoBffAppConfig {
  const engineBaseUrl = env.ENGINE_BASE_URL;
  const engineServiceSecret = env.ENGINE_SERVICE_SECRET;
  const configuredDemoWorkflowId = env.DEMO_WORKFLOW_ID;

  if (!engineBaseUrl || typeof engineBaseUrl !== 'string' || engineBaseUrl.trim() === '') {
    throw new Error('ENGINE_BASE_URL is required');
  }

  if (
    !engineServiceSecret ||
    typeof engineServiceSecret !== 'string' ||
    engineServiceSecret.trim() === ''
  ) {
    throw new Error('ENGINE_SERVICE_SECRET is required');
  }

  const demoWorkflowId =
    typeof configuredDemoWorkflowId === 'string' && configuredDemoWorkflowId.trim() !== ''
      ? configuredDemoWorkflowId.trim()
      : 'base';

  return {
    engineBaseUrl: engineBaseUrl.trim(),
    engineServiceSecret: engineServiceSecret.trim(),
    demoWorkflowId,
  };
}
