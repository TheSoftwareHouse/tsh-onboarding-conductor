// PoC (throwaway): the document's own settings, drawn from the root of the authored schema, so every
// workflow-level key is editable without the JSON tab.
import type { ReactElement } from 'react';
import { getWorkflowJsonSchema } from '@tsh/ddl-schema/schema/workflow-json-schema';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { setRootKeys, type AuthoredDocument, type Json } from './authored-graph';
import { InspectorBand } from './InspectorBand';
import { PanelClose } from './PanelClose';
import { SchemaForm } from './SchemaForm/SchemaForm';
import {
  buildDefault,
  humanize,
  isComposite,
  isEmptyValue,
  type Schema,
} from './SchemaForm/schema-utils';

export interface WorkflowSettingsProps {
  doc: AuthoredDocument;
  stepNames: string[];
  readOnly: boolean;
  onChange: (next: AuthoredDocument) => void;
  onClose: () => void;
}

/** The root keys this form edits; `id` and `version` are fixed by the draft, `steps` by the canvas. */
const EDITED_KEYS = ['name', 'webhook', 'scoring', 'agreements'] as const;

function readRootSchema(key: string): Schema {
  return (getWorkflowJsonSchema() as { properties: Record<string, Schema> }).properties[key]!;
}

export function WorkflowSettings({
  doc,
  stepNames,
  readOnly,
  onChange,
  onClose,
}: WorkflowSettingsProps): ReactElement {
  // An empty value unsets the key, so clearing the name drops it rather than writing "".
  function setKey(key: string, next: unknown): void {
    onChange(setRootKeys(doc, [key], isEmptyValue(next) ? {} : ({ [key]: next } as Json)));
  }

  function handleInitial(initial: string): void {
    const next: AuthoredDocument = { ...doc, initial };
    if (initial === '') delete next.initial;
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
        <h2 className="font-mono text-body-lg-alt/normal font-normal wrap-anywhere text-tsh-black">
          {String(doc.id ?? '—')}
        </h2>
        <Typography variant="body-sm" as="span">
          Version {String(doc.version ?? '—')}
        </Typography>
      </header>
      <InspectorBand title="Start">
        <label className="flex items-center justify-between gap-2">
          <Typography variant="body-sm" as="span">
            Initial step
          </Typography>
          <select
            disabled={readOnly}
            className="border border-border-strong px-1 py-0.5 text-body-sm"
            value={doc.initial ?? ''}
            onChange={(event) => handleInitial(event.target.value)}
          >
            <option value="">— first step ({doc.steps[0]?.name ?? 'none'}) —</option>
            {stepNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </InspectorBand>
      {/* One band per setting, so each reads as its own section rather than one long form. */}
      {EDITED_KEYS.map((key) => {
        const schema = readRootSchema(key);
        const isSet = doc[key] !== undefined;
        const label = humanize(key);
        return (
          <InspectorBand
            key={key}
            title={label}
            trailing={
              readOnly ? undefined : isSet ? (
                <button
                  type="button"
                  aria-label={`Remove ${label.toLowerCase()}`}
                  title={`Remove ${label.toLowerCase()}`}
                  className="cursor-pointer text-fg-3 hover:text-fg-1"
                  onClick={() => setKey(key, undefined)}
                >
                  <Close aria-hidden className="size-5" />
                </button>
              ) : isComposite(schema) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setKey(key, buildDefault(schema))}
                >
                  Set
                </Button>
              ) : undefined
            }
          >
            {!isSet && isComposite(schema) ? (
              <Typography variant="meta" className="text-fg-disabled">
                Not set
              </Typography>
            ) : (
              <SchemaForm
                schema={schema}
                name={key}
                value={doc[key]}
                readOnly={readOnly}
                optional
                onChange={(next) => setKey(key, next)}
              />
            )}
          </InspectorBand>
        );
      })}
    </aside>
  );
}
