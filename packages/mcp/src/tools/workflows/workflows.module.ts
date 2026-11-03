import { Module } from '@nestjs/common';
import { ClassificationModule } from '../../classification/classification.module';
import { ConfirmationModule } from '../../confirmation/confirmation.module';
import { EngineModule } from '../../engine/engine.module';
import { CompileWorkflowTool } from './compile-workflow.tool';
import { CreateWorkflowDraftTool } from './create-workflow-draft.tool';
import { DiffWorkflowVersionsTool } from './diff-workflow-versions.tool';
import { GetWorkflowDocumentTool } from './get-workflow-document.tool';
import { GetWorkflowVersionTool } from './get-workflow-version.tool';
import { ListWorkflowsTool } from './list-workflows.tool';
import { WorkflowVersionReader } from './workflow-version-reader';

@Module({
  imports: [EngineModule, ClassificationModule, ConfirmationModule],
  providers: [
    WorkflowVersionReader,
    ListWorkflowsTool,
    GetWorkflowVersionTool,
    GetWorkflowDocumentTool,
    DiffWorkflowVersionsTool,
    CompileWorkflowTool,
    CreateWorkflowDraftTool,
  ],
})
export class WorkflowsToolsModule {}
