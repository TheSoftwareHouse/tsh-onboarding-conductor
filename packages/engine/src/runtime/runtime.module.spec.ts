import { Test } from '@nestjs/testing';
import { ConfigurableSynchronousRuntimeAdapter } from './configurable-synchronous-runtime.adapter';
import { ONBOARDING_RUNTIME_PORT, WORKFLOW_SOURCE } from './onboarding-runtime.port';
import { RuntimeModule } from './runtime.module';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';

describe('RuntimeModule', () => {
  it('resolves the workflow source and runtime port through module DI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeModule],
    }).compile();

    const workflowSource = moduleRef.get(WORKFLOW_SOURCE);
    const adapter = moduleRef.get(ConfigurableSynchronousRuntimeAdapter);
    const runtimePort = moduleRef.get(ONBOARDING_RUNTIME_PORT);

    expect(workflowSource).toBeInstanceOf(WorkflowRegistryService);
    expect(adapter).toBeInstanceOf(ConfigurableSynchronousRuntimeAdapter);
    expect(runtimePort).toBe(adapter);

    await moduleRef.close();
  });
});
