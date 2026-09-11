import { StepTypesController } from './step-types.controller';
import type { WorkflowCompilationService } from './workflow-compilation.service';

describe('StepTypesController', () => {
  it('hands both reads to the compilation service unchanged', () => {
    const palette = { stepTypes: [] };
    const schema = { title: 'schema' };
    const service = {
      listStepTypes: jest.fn().mockReturnValue(palette),
      getWorkflowSchema: jest.fn().mockReturnValue(schema),
    } as unknown as WorkflowCompilationService;
    const controller = new StepTypesController(service);

    expect(controller.list()).toBe(palette);
    expect(controller.schema()).toBe(schema);
  });
});
