import { Injectable } from '@nestjs/common';
import { FieldClassLookup } from '../../classification/field-class-lookup';
import { EngineClient } from '../../engine/engine-client';
import { FieldClass } from '../../masking/masking.constants';
import { RequestContext } from '../../request-context/request-context';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { getInteger, getString } from '../shared/tool-arguments';
import { CompiledWorkflow, WorkflowVersionReader } from './workflow-version-reader';
import { WorkflowToolName } from './workflows.constants';

type CompiledStep = CompiledWorkflow['steps'][number];

@Injectable()
@McpTool()
export class GetWorkflowVersionTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = WorkflowToolName.GET_VERSION;
  readonly description =
    'Reads one version of a workflow as the engine runs it: per step its status, fields, ' +
    'transitions (their `when` conditions carry the score thresholds and field tests), score ' +
    'rules and connectors, plus the score bounds. Each field carries `maskingClass`, which is ' +
    'what the assistant can see of that field in onboarding data: pass (in clear), pseudonymise ' +
    '(stable token), generalise (age band) or drop (never shown). A connector the operators ' +
    'switched shows `selected` and the `authoredId` it replaced. Use it to explain how a ' +
    'decision was reached or what a version collects; get the version number from list_workflows.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      workflowId: { type: 'string', description: 'The workflow id, e.g. from list_workflows.' },
      version: { type: 'integer', minimum: 1, description: 'The version number to read.' },
    },
    required: ['workflowId', 'version'],
    additionalProperties: false,
  };

  constructor(
    private readonly engine: EngineClient,
    private readonly reader: WorkflowVersionReader,
    private readonly classes: FieldClassLookup,
  ) {}

  async handler(args: ToolArguments, context: RequestContext) {
    const ref = { workflowId: getString(args, 'workflowId'), version: getInteger(args, 'version') };
    const [{ status, definition }, { classes }, projection] = await Promise.all([
      this.reader.getCompiled(ref, context),
      this.classes.getVersionClasses(ref, context),
      this.engine.request('get', '/v1/admin/workflows/{workflowId}/versions/{version}', context, {
        path: ref,
      }),
    ]);
    const projectedConnectors = new Map(
      projection.steps.flatMap((step) =>
        step.connectors.map((connector) => [`${step.name}/${connector.name}`, connector] as const),
      ),
    );

    const describeStep = (step: CompiledStep) => ({
      name: step.name,
      status: step.status,
      fields: Object.entries(step.data).map(([name, field]) => ({
        name,
        type: field.type,
        required: field.required,
        ...(field.persist === false ? { persisted: false } : {}),
        ...('when' in field && field.when !== undefined ? { when: field.when } : {}),
        maskingClass: classes.get(name)?.class ?? FieldClass.DROP,
      })),
      ...(step.scoring === undefined ? {} : { scoringRules: step.scoring }),
      connectors: (step.connectors ?? []).map((connector) => {
        const projected = projectedConnectors.get(`${step.name}/${connector.name}`);

        return {
          name: connector.name,
          id: projected?.id ?? connector.id,
          type: connector.type,
          ...(projected?.selected ? { selected: true, authoredId: projected.authoredId } : {}),
          ...(connector.fallback === undefined
            ? {}
            : { fallbackIds: connector.fallback.map(({ id }) => id) }),
        };
      }),
      transitions: step.transitions,
    });

    return {
      workflowId: definition.id,
      version: definition.version,
      status,
      name: definition.name ?? null,
      initialStep: definition.initial ?? definition.steps[0].name,
      scores: definition.scoring ?? {},
      ...(definition.agreements === undefined ? {} : { agreements: definition.agreements }),
      steps: definition.steps.map(describeStep),
    };
  }
}
