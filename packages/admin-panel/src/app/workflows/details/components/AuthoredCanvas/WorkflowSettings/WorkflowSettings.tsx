import { memo, type ReactElement } from 'react';
import { getWorkflowJsonSchema } from '@tsh/ddl-schema/workflow-schema';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import type { AuthoredDocument } from '../../../utils/authored-document';
import { setAgreements, setInitial, setRootKeys } from '../../../utils/authored-edits';
import type { ProjectedStep } from '../../../utils/authored-projection';
import {
  buildDefault,
  humanize,
  isComposite,
  isEmptyValue,
  type Schema,
} from '../../../utils/config-schema';
import { AgreementList } from '../Agreements/AgreementList';
import { InspectorBand } from '../InspectorBand';
import { PanelClose } from '../PanelClose';
import { SchemaForm } from '../SchemaForm/SchemaForm';

export interface WorkflowSettingsProps {
  doc: AuthoredDocument;
  /** The canvas's projection of `doc`. */
  steps: readonly ProjectedStep[];
  readOnly: boolean;
  onChange: (doc: AuthoredDocument) => void;
  onClose: () => void;
}

/** Root keys the generated form edits; `id` and `version` are fixed, `steps` and `agreements` have their own editors. */
const EDITED_KEYS = ['name', 'webhook', 'scoring'] as const;

/** The initial select's value for "the first step", which is what an unset `initial` means. */
const FIRST_STEP = '\u0000first';

function readRootSchema(key: string): Schema {
  return (getWorkflowJsonSchema() as { properties: Record<string, Schema> }).properties[key]!;
}

/** The document's own settings, drawn from the root of the workflow schema, so each is editable without the JSON tab. */
export const WorkflowSettings = memo(function WorkflowSettings({
  doc,
  steps,
  readOnly,
  onChange,
  onClose,
}: WorkflowSettingsProps): ReactElement {
  // An empty value unsets the key, so clearing the name drops it rather than writing "".
  function setKey(key: (typeof EDITED_KEYS)[number], next: unknown): void {
    onChange(setRootKeys(doc, [key], isEmptyValue(next) ? {} : { [key]: next }));
  }

  function handleInitial(initial: string): void {
    if (initial !== FIRST_STEP) {
      onChange(setInitial(doc, initial));
      return;
    }
    const next = { ...doc };
    delete next.initial;
    onChange(next);
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border-rule xl:w-md 2xl:w-lg">
      <header className="flex flex-col gap-2 border-b border-border-hair px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <Typography variant="caps-tiny" as="span" className="text-fg-4">
            Workflow settings
          </Typography>
          <PanelClose onClose={onClose} />
        </div>
        <Typography variant="mono" as="h2" className="wrap-anywhere text-fg-1">
          {doc.id ?? '—'}
        </Typography>
        <Typography variant="body-sm" as="span">
          Version {doc.version ?? '—'}
        </Typography>
      </header>
      <InspectorBand title="Start">
        <div className="flex items-center justify-between gap-2">
          <Typography variant="body-sm" as="span">
            Initial step
          </Typography>
          <Select
            aria-label="Initial step"
            items={[
              { value: FIRST_STEP, label: `First step (${doc.steps[0]?.name ?? 'none'})` },
              ...doc.steps.map((step) => ({ value: step.name, label: step.name })),
            ]}
            value={doc.initial ?? FIRST_STEP}
            disabled={readOnly}
            className="h-8 w-56"
            onValueChange={handleInitial}
          />
        </div>
      </InspectorBand>
      {/* One band per setting, so each reads as its own section rather than one long form. */}
      {EDITED_KEYS.map((key) => {
        const schema = readRootSchema(key);
        const isSet = doc[key] !== undefined;
        const label = humanize(key);
        let trailing: ReactElement | undefined;
        if (!readOnly && isSet) {
          trailing = (
            <Button
              variant="quiet"
              size="sm"
              className="h-7 px-1"
              aria-label={`Remove ${label.toLowerCase()}`}
              onClick={() => setKey(key, undefined)}
            >
              <Close aria-hidden className="size-5" />
            </Button>
          );
        } else if (!readOnly && isComposite(schema)) {
          trailing = (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Set ${label.toLowerCase()}`}
              onClick={() => setKey(key, buildDefault(schema))}
            >
              Set
            </Button>
          );
        }
        return (
          <InspectorBand key={key} title={label} trailing={trailing}>
            {!isSet && isComposite(schema) ? (
              <Typography variant="meta" className="text-fg-disabled">
                Not set
              </Typography>
            ) : (
              <SchemaForm
                schema={schema}
                name={key}
                label={label}
                value={doc[key]}
                readOnly={readOnly}
                optional
                onChange={(next) => setKey(key, next)}
              />
            )}
          </InspectorBand>
        );
      })}
      <InspectorBand title="Agreements">
        <AgreementList
          agreements={doc.agreements ?? []}
          fieldsByStep={
            new Map(steps.map((projected) => [projected.step.name, projected.agreementFields]))
          }
          readOnly={readOnly}
          onChange={(agreements) => onChange(setAgreements(doc, agreements))}
        />
      </InspectorBand>
    </aside>
  );
});
