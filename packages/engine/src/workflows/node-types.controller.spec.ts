import { NodeTypesController } from './node-types.controller';
import type { WorkflowCompilationService } from './workflow-compilation.service';

describe('NodeTypesController', () => {
  it('hands both reads to the compilation service unchanged', () => {
    const palette = { nodeTypes: [] };
    const schema = { title: 'schema' };
    const service = {
      listNodeTypes: jest.fn().mockReturnValue(palette),
      getNodeGraphSchema: jest.fn().mockReturnValue(schema),
    } as unknown as WorkflowCompilationService;
    const controller = new NodeTypesController(service);

    expect(controller.list()).toBe(palette);
    expect(controller.schema()).toBe(schema);
  });
});
