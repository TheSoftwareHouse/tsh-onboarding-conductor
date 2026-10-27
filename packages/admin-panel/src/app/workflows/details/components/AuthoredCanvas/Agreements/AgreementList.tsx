import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import { suggestAgreementKey, type Agreement } from '../../../utils/agreements';
import { AgreementKeyInput } from './AgreementKeyInput';

export interface AgreementListProps {
  agreements: readonly Agreement[];
  /** Each step's yes/no fields offered as agreements, in document order; `null` when the step does not compile. */
  fieldsByStep: ReadonlyMap<string, readonly string[] | null>;
  readOnly: boolean;
  onChange: (agreements: Agreement[]) => void;
}

/** Every agreement of the workflow, with its step and field picked from the ones that can carry it. */
export function AgreementList({
  agreements,
  fieldsByStep,
  readOnly,
  onChange,
}: AgreementListProps): ReactElement {
  // Only steps that offer a field; an agreement's own step is added back below.
  const stepNames = [...fieldsByStep].flatMap(([step, fields]) =>
    fields !== null && fields.length > 0 ? [step] : [],
  );
  const firstCandidate = stepNames.flatMap((step) => {
    const field = fieldsByStep.get(step)?.[0];
    return field === undefined ? [] : [{ step, field }];
  })[0];

  function update(index: number, next: Partial<Agreement>): void {
    onChange(
      agreements.map((agreement, at) => (at === index ? { ...agreement, ...next } : agreement)),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {agreements.length === 0 && (
        <Typography variant="meta" className="leading-natural">
          {firstCandidate === undefined
            ? 'No consents or custom step stores a yes/no field yet.'
            : 'None. Track one here or from its step.'}
        </Typography>
      )}
      {agreements.map((agreement, index) => {
        const number = index + 1;
        const fields = fieldsByStep.get(agreement.step) ?? [];
        const stepItems = (
          stepNames.includes(agreement.step) ? stepNames : [...stepNames, agreement.step]
        ).map((step) => ({
          value: step,
          label: fieldsByStep.has(step) ? step : `${step} (missing)`,
        }));
        const fieldItems = (
          agreement.acceptedWhen === '' || fields.includes(agreement.acceptedWhen)
            ? fields
            : [...fields, agreement.acceptedWhen]
        ).map((field) => ({
          value: field,
          label: fields.includes(field) ? field : `${field} (not a stored yes/no field)`,
        }));
        return (
          <div
            // Agreements are identified by key, which is being edited here; the place is stable.
            key={index}
            role="group"
            aria-label={`Agreement ${number}`}
            className="flex flex-col gap-2 border border-border-rule p-3"
          >
            <div className="flex items-start gap-2">
              <AgreementKeyInput
                agreements={agreements}
                index={index}
                label={`Key of agreement ${number}`}
                readOnly={readOnly}
                onKey={(key) => update(index, { key })}
              />
              {!readOnly && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="h-7 px-1"
                  aria-label={`Remove agreement ${number}`}
                  onClick={() => onChange(agreements.filter((_, at) => at !== index))}
                >
                  <Close aria-hidden className="size-5" />
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Select
                aria-label={`Step of agreement ${number}`}
                items={stepItems}
                value={agreement.step}
                disabled={readOnly}
                className="h-9 min-w-0 flex-1"
                onValueChange={(step) =>
                  update(index, { step, acceptedWhen: fieldsByStep.get(step)?.[0] ?? '' })
                }
              />
              <Select
                aria-label={`Field of agreement ${number}`}
                items={fieldItems}
                value={agreement.acceptedWhen === '' ? null : agreement.acceptedWhen}
                placeholder="No yes/no field"
                disabled={readOnly || fieldItems.length === 0}
                className="h-9 min-w-0 flex-1"
                onValueChange={(acceptedWhen) => update(index, { acceptedWhen })}
              />
            </div>
          </div>
        );
      })}
      {!readOnly && firstCandidate !== undefined && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            onChange([
              ...agreements,
              {
                key: suggestAgreementKey(agreements, firstCandidate.field),
                step: firstCandidate.step,
                acceptedWhen: firstCandidate.field,
              },
            ])
          }
        >
          + Add agreement
        </Button>
      )}
    </div>
  );
}
