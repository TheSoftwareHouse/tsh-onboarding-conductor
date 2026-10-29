import { useState, type ReactElement } from 'react';
import { COLLECT_STEP_CATEGORY, findStepType, STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { Button } from '@/components/ui/Button/Button';
import { ChevronRight } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import type { AuthoredStep } from '../../../utils/authored-document';
import {
  listIncludableTypes,
  listSections,
  type SectionField,
  type StepSection,
} from '../../../utils/authored-projection';
import { checkStepConfig } from '../../../utils/check-config';
import { readConfigDefaults, type Schema } from '../../../utils/config-schema';
import { withHttpRequestSchema } from '../../../utils/http-request-schema';
import { pluralize } from '../../../utils/pluralize';
import { ConfigFormContext } from '../SchemaForm/config-form-context';
import { SchemaForm } from '../SchemaForm/SchemaForm';
import { FieldList } from './FieldList';
import { InspectorBand } from '../InspectorBand';
import { JsonConfig } from './JsonConfig';

type Config = Record<string, unknown>;

export interface StepSectionsProps {
  step: AuthoredStep;
  /** What the step's compiled steps store, sub-steps included; `null` when it does not compile. */
  storedFields: SectionField[] | null;
  readOnly: boolean;
  onConfig: (include: number | null, config: Config) => void;
  /** Renames a field of the step's own `config.fields` with its references; returns whether they followed. */
  onRenameField: (from: string, to: string) => boolean;
  onAddSection: (type: string) => void;
  onRemoveSection: (include: number) => void;
}

/** Types whose config declares the fields they collect, so they collect even while that list is empty. */
function definesFields(type: string): boolean {
  const schema = findStepType(type)?.buildConfigSchema() as Schema | undefined;
  return type === STEP_TYPE.custom || schema?.properties?.fields !== undefined;
}

/** A custom step's lists edited elsewhere: `scoring` in the Scoring section, `transitions` under Ports. */
const CUSTOM_LISTS_EDITED_ELSEWHERE = ['scoring', 'transitions'];

/** A custom step's form without the lists the panel edits in their own sections. */
function withoutListsEditedElsewhere(type: string, schema: Schema): Schema {
  if (type !== STEP_TYPE.custom || schema.properties === undefined) return schema;
  const isOwn = (key: string): boolean => !CUSTOM_LISTS_EDITED_ELSEWHERE.includes(key);
  const properties = Object.fromEntries(
    Object.entries(schema.properties).filter(([key]) => isOwn(key)),
  );
  return { ...schema, properties, required: schema.required?.filter(isOwn) };
}

export function StepSections({
  step,
  storedFields,
  readOnly,
  onConfig,
  onRenameField,
  onAddSection,
  onRemoveSection,
}: StepSectionsProps): ReactElement {
  const [own, ...includes] = listSections(step);
  const includedNames = new Set(
    includes.flatMap((section) =>
      Array.isArray(section.fields) ? section.fields.map((field) => field.name) : [],
    ),
  );
  // The compile sees sub-steps too, so OTP's code and KYC's callback fields count as the step's own.
  const sections = [
    storedFields === null
      ? own!
      : { ...own!, fields: storedFields.filter((field) => !includedNames.has(field.name)) },
    ...includes,
  ];
  const total = sections.reduce(
    (sum, section) => sum + (Array.isArray(section.fields) ? section.fields.length : 0),
    0,
  );
  const collects =
    definesFields(step.type) ||
    sections.some((section) => !Array.isArray(section.fields) || section.fields.length > 0);
  const includable = listIncludableTypes(step);
  const canInclude =
    !readOnly &&
    findStepType(step.type)?.category === COLLECT_STEP_CATEGORY &&
    includable.length > 0;

  return (
    <InspectorBand
      title={collects ? 'Collects' : 'Settings'}
      meta={collects ? pluralize(total, 'field') : undefined}
      trailing={
        canInclude ? (
          <Select
            aria-label="Include a section"
            items={includable.map((type) => ({ value: type, label: type }))}
            value={null}
            placeholder="+ Include a section"
            className="h-8 w-52"
            onValueChange={onAddSection}
          />
        ) : undefined
      }
    >
      {sections.map((section) => {
        const { include } = section;

        return (
          <SectionBlock
            key={`${include ?? 'own'}:${section.type}`}
            section={section}
            // A card only separates sections; a step with just its own type needs none.
            carded={sections.length > 1}
            showFields={collects}
            readOnly={readOnly}
            onConfig={(config) => onConfig(include, config)}
            onRenameField={include === null ? onRenameField : null}
            onRemove={include === null ? undefined : () => onRemoveSection(include)}
          />
        );
      })}
    </InspectorBand>
  );
}

interface SectionBlockProps {
  section: StepSection;
  readOnly: boolean;
  onConfig: (config: Config) => void;
  /** Set on the step's own section only: an included section's fields are not the step's root fields. */
  onRenameField: ((from: string, to: string) => boolean) | null;
  /** Set on an included section only; the step's own type cannot be removed. */
  onRemove?: () => void;
  carded: boolean;
  /** Off for a step that stores nothing: only its config shows, already open. */
  showFields: boolean;
}

function SectionBlock({
  section,
  readOnly,
  onConfig,
  onRenameField,
  onRemove,
  carded,
  showFields,
}: SectionBlockProps): ReactElement {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  // The config form is most of a step's length, so it folds away unless the config is broken.
  const [configOpen, setConfigOpen] = useState(!showFields || !Array.isArray(section.fields));
  const baseSchema = findStepType(section.type)?.buildConfigSchema() as Schema | undefined;
  const requestSchema =
    baseSchema && withHttpRequestSchema(section.type, baseSchema, section.config);
  const schema = requestSchema && withoutListsEditedElsewhere(section.type, requestSchema);

  return (
    <div className={cn('flex flex-col gap-3', carded && 'border border-border-rule p-3')}>
      {/* The step's own type heads the panel; a heading here only tells sections apart. */}
      {carded && (
        <div className="flex items-center justify-between">
          <Typography variant="mono" as="span">
            {section.type}
          </Typography>
          <span className="flex items-center gap-2">
            <Typography variant="meta" as="span">
              {section.include === null ? 'step type' : 'included section'}
            </Typography>
            {onRemove && !readOnly && (
              <Button
                variant="danger"
                size="sm"
                aria-label={`Remove section ${section.type}`}
                onClick={onRemove}
              >
                Remove
              </Button>
            )}
          </span>
        </div>
      )}

      {showFields && (
        <div className="flex flex-col gap-1">
          {/* form, wait-for-external and connector-call take their fields from config.fields verbatim. */}
          <Typography variant="meta">
            {Array.isArray(section.fields) ? `${pluralize(section.fields.length, 'field')} · ` : ''}
            {'fields' in section.config ? 'defined in config.fields' : 'built in'}
          </Typography>
          <FieldList fields={section.fields} />
        </div>
      )}

      <div className={cn('flex flex-col gap-2', showFields && 'border-t border-border-rule pt-2')}>
        <div className="flex items-center justify-between">
          <Button
            variant="quiet"
            size="sm"
            className="px-0"
            aria-expanded={configOpen}
            onClick={() => setConfigOpen(!configOpen)}
          >
            <ChevronRight
              aria-hidden
              className={cn('size-5 transition-transform', configOpen && 'rotate-90')}
            />
            Configure
          </Button>
          {configOpen && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setMode((current) => (current === 'form' ? 'json' : 'form'))}
            >
              {mode === 'form' ? 'Edit as JSON' : 'Back to form'}
            </Button>
          )}
        </div>
        {!configOpen ? null : mode === 'form' && schema ? (
          <ConfigFormContext.Provider
            value={{
              stepType: section.type,
              renameField: onRenameField,
              failures: checkStepConfig(section.type, section.config),
            }}
          >
            <SchemaForm
              schema={schema}
              value={section.config}
              defaults={readConfigDefaults(section.type, section.config)}
              readOnly={readOnly}
              hidesUnset
              onChange={(next) => onConfig((next ?? {}) as Config)}
            />
          </ConfigFormContext.Provider>
        ) : (
          <JsonConfig config={section.config} readOnly={readOnly} onConfig={onConfig} />
        )}
      </div>
    </div>
  );
}
