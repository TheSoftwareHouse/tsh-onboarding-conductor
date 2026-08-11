import Ajv from 'ajv';
import committedSchema from '../../onboarding-workflow.schema.json';
import { FIELD_TYPE_DEFINITIONS } from '../fields/field-type.registry';
import { FIELD_FORMAT_DEFINITIONS } from '../formats/field-format.registry';
import { buildWorkflowJsonSchema } from './workflow-json-schema.builder';
import { workflowJsonSchema } from './workflow-json-schema';

describe('workflow JSON schema', () => {
  it('matches the committed artifact', () => {
    // Regenerate with `pnpm --filter @tsh/ddl-schema schema:generate` when this fails.
    expect(workflowJsonSchema).toEqual(committedSchema);
  });

  it('serializes identically to the committed artifact', () => {
    expect(JSON.stringify(workflowJsonSchema)).toBe(JSON.stringify(committedSchema));
  });

  it('contributes a descriptor for every field type at every level it supports', () => {
    const definitions = (workflowJsonSchema as { definitions: Record<string, unknown> })
      .definitions;

    for (const fieldType of FIELD_TYPE_DEFINITIONS) {
      for (const level of fieldType.levels) {
        const name =
          level === 'root'
            ? `${fieldType.type}Descriptor`
            : `${level}${fieldType.type.charAt(0).toUpperCase()}${fieldType.type.slice(1)}Descriptor`;

        expect(definitions[name]).toBeDefined();
      }
    }
  });

  it('derives the text format enum from the format registry', () => {
    const definitions = workflowJsonSchema as {
      definitions: { textValidation: { properties: { format: { enum: string[] } } } };
    };

    expect(definitions.definitions.textValidation.properties.format.enum).toEqual(
      FIELD_FORMAT_DEFINITIONS.map((format) => format.name),
    );
  });

  it('compiles on a strict Ajv instance', () => {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true });

    expect(() => ajv.compile(buildWorkflowJsonSchema())).not.toThrow();
  });
});
