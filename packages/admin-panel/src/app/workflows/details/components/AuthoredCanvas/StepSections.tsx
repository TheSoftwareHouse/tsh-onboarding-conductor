// PoC (throwaway): a step's sections — the fields each type builds in, and a form for the config that shapes them.
import { useState, type ReactElement } from 'react';
import { findStepType } from '@tsh/ddl-schema/step-types/step-type.registry';
import { Button } from '@/components/ui/Button/Button';
import { ChevronRight } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { Typography } from '@/components/ui/Typography/Typography';
import { JSON_INDENT } from '../../constants/json-indent';
import {
  listComposableTypes,
  listSections,
  readConfigDefaults,
  type AuthoredStep,
  type Json,
  type StepSection,
} from './authored-graph';
import { InspectorBand } from './InspectorBand';
import { SchemaForm } from './SchemaForm/SchemaForm';
import type { Schema } from './SchemaForm/schema-utils';

export interface StepSectionsProps {
  step: AuthoredStep;
  readOnly: boolean;
  onConfig: (include: number | null, config: Json) => void;
  onAddSection: (type: string) => void;
  onRemoveSection: (include: number) => void;
}

export function StepSections({
  step,
  readOnly,
  onConfig,
  onAddSection,
  onRemoveSection,
}: StepSectionsProps): ReactElement {
  const sections = listSections(step);
  const total = sections.reduce(
    (sum, section) => sum + (Array.isArray(section.fields) ? section.fields.length : 0),
    0,
  );

  return (
    <InspectorBand
      title="Collects"
      meta={`${total} ${total === 1 ? 'field' : 'fields'}`}
      trailing={
        readOnly ? undefined : (
          <select
            aria-label="Include a section"
            className="border border-border-strong px-1 py-0.5 text-body-sm"
            value=""
            onChange={(event) => event.target.value !== '' && onAddSection(event.target.value)}
          >
            <option value="">+ Include a section</option>
            {listComposableTypes().map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        )
      }
    >
      {sections.map((section) => (
        <SectionBlock
          key={`${section.include ?? 'own'}:${section.type}`}
          section={section}
          // A card only separates sections; a step with just its own type needs none.
          carded={sections.length > 1}
          readOnly={readOnly}
          onConfig={(config) => onConfig(section.include, config)}
          onRemove={
            section.include === null ? undefined : () => onRemoveSection(section.include as number)
          }
        />
      ))}
    </InspectorBand>
  );
}

interface SectionBlockProps {
  section: StepSection;
  readOnly: boolean;
  onConfig: (config: Json) => void;
  /** Set on an included section only; the step's own type cannot be removed. */
  onRemove?: () => void;
  carded: boolean;
}

function SectionBlock({
  section,
  readOnly,
  onConfig,
  onRemove,
  carded,
}: SectionBlockProps): ReactElement {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  // The config form is most of a step's length, so it folds away unless the config is broken.
  const [configOpen, setConfigOpen] = useState(!Array.isArray(section.fields));
  const schema = findStepType(section.type)?.buildConfigSchema() as Schema | undefined;

  return (
    <div className={cn('flex flex-col gap-3', carded && 'border border-border-rule p-3')}>
      <div className="flex items-baseline justify-between">
        <Typography variant="mono" as="span">
          {section.type}
        </Typography>
        <span className="flex items-baseline gap-2">
          <Typography variant="meta" as="span">
            {section.include === null ? 'step type' : 'included section'}
          </Typography>
          {onRemove && !readOnly && (
            <button
              type="button"
              className="cursor-pointer text-caption text-tsh-red underline"
              onClick={onRemove}
            >
              Remove
            </button>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {/* form, wait-for-external and connector-call take their fields from config.fields verbatim. */}
        <Typography variant="meta">
          {Array.isArray(section.fields)
            ? `${section.fields.length} ${section.fields.length === 1 ? 'field' : 'fields'} · `
            : ''}
          {'fields' in section.config ? 'defined in config.fields' : 'built in'}
        </Typography>
        <FieldList fields={section.fields} />
      </div>

      <div className="flex flex-col gap-2 border-t border-border-rule pt-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-expanded={configOpen}
            className="flex cursor-pointer items-center gap-1 text-fg-2 hover:text-fg-1"
            onClick={() => setConfigOpen(!configOpen)}
          >
            <ChevronRight
              aria-hidden
              className={cn('size-5 transition-transform', configOpen && 'rotate-90')}
            />
            <Typography variant="meta" as="span">
              Configure
            </Typography>
          </button>
          {configOpen && (
            <button
              type="button"
              className="cursor-pointer text-caption text-fg-4 underline"
              onClick={() => setMode((current) => (current === 'form' ? 'json' : 'form'))}
            >
              {mode === 'form' ? 'Edit as JSON' : 'Back to form'}
            </button>
          )}
        </div>
        {!configOpen ? null : mode === 'form' && schema ? (
          <SchemaForm
            schema={schema}
            value={section.config}
            defaults={readConfigDefaults(section.type, section.config)}
            readOnly={readOnly}
            onChange={(next) => onConfig((next ?? {}) as Json)}
          />
        ) : (
          <JsonConfig config={section.config} readOnly={readOnly} onConfig={onConfig} />
        )}
      </div>
    </div>
  );
}

/** Past this many, a section shows the first few and a toggle, so one long section cannot bury the rest. */
const VISIBLE_FIELDS = 5;

function FieldList({ fields }: { fields: StepSection['fields'] }): ReactElement {
  const [showAll, setShowAll] = useState(false);
  if (!Array.isArray(fields)) {
    return (
      <Typography variant="meta" className="text-tsh-red">
        {fields.error}
      </Typography>
    );
  }
  if (fields.length === 0) {
    return (
      <Typography variant="meta" className="text-fg-disabled">
        no fields
      </Typography>
    );
  }
  const isLong = fields.length > VISIBLE_FIELDS;
  const shown = isLong && !showAll ? fields.slice(0, VISIBLE_FIELDS) : fields;
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {shown.map((field) => (
          // Required is the usual case, so only an optional field says anything beyond its type.
          <li
            key={field.name}
            className="flex items-baseline justify-between gap-2 border-b border-tsh-black/6 py-1.5 last:border-b-0"
          >
            <Typography
              variant="mono"
              as="span"
              className="truncate text-caption"
              title={field.name}
            >
              {field.name}
            </Typography>
            <span className="flex shrink-0 items-baseline gap-2">
              {!field.required && (
                <Typography variant="meta" as="span" className="border border-border-strong px-1">
                  optional
                </Typography>
              )}
              <Typography variant="meta" as="span">
                {field.type}
              </Typography>
            </span>
          </li>
        ))}
      </ul>
      {isLong && (
        <button
          type="button"
          className="cursor-pointer self-start pt-1.5 text-caption text-fg-3 underline hover:text-fg-1"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show fewer' : `Show all ${fields.length} fields`}
        </button>
      )}
    </div>
  );
}

function JsonConfig({
  config,
  readOnly,
  onConfig,
}: {
  config: Json;
  readOnly: boolean;
  onConfig: (config: Json) => void;
}): ReactElement {
  const saved = JSON.stringify(config, null, JSON_INDENT);
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);

  function apply(): void {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        setError('Config must be an object');
        return;
      }
      setError(null);
      onConfig(value as Json);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Invalid JSON');
    }
  }

  return (
    <>
      <textarea
        className="min-h-40 border border-border-strong p-2 font-mono text-caption"
        value={text}
        readOnly={readOnly}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
      />
      {error && (
        <Typography variant="meta" className="text-tsh-red">
          {error}
        </Typography>
      )}
      {!readOnly && (
        <Button variant="outline" size="sm" disabled={text === saved} onClick={apply}>
          Apply
        </Button>
      )}
    </>
  );
}
