import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ConfigurableSynchronousRuntimeAdapter } from './configurable-synchronous-runtime.adapter';
import { ONBOARDING_RUNTIME_PORT } from './onboarding-runtime.port';

@Module({
  imports: [WorkflowsModule],
  providers: [
    ConfigurableSynchronousRuntimeAdapter,
    {
      provide: ONBOARDING_RUNTIME_PORT,
      useExisting: ConfigurableSynchronousRuntimeAdapter,
    },
  ],
  exports: [ONBOARDING_RUNTIME_PORT],
})
export class RuntimeModule {}
