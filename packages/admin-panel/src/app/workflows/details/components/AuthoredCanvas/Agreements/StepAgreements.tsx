import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Close } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { suggestAgreementKey, type Agreement } from '../../../utils/agreements';
import { pluralize } from '../../../utils/pluralize';
import { Checkbox } from '../Checkbox';
import { InspectorBand } from '../InspectorBand';
import { AgreementKeyInput } from './AgreementKeyInput';

export interface StepAgreementsProps {
  /** Every agreement of the workflow; this section edits the ones on `stepName`. */
  agreements: readonly Agreement[];
  stepName: string;
  /** The step's stored yes/no fields; `null` when the step does not compile. */
  fields: readonly string[] | null;
  readOnly: boolean;
  onChange: (agreements: Agreement[]) => void;
}

/** "Track as agreement" per yes/no field the step stores; renders nothing when there is none to track. */
export function StepAgreements({
  agreements,
  stepName,
  fields,
  readOnly,
  onChange,
}: StepAgreementsProps): ReactElement | null {
  const own = agreements.flatMap((agreement, index) =>
    agreement.step === stepName ? [{ agreement, index }] : [],
  );
  const candidates = fields ?? [];
  // Agreements on a field the step no longer stores, kept visible so they can be removed here.
  const stale = own.filter(({ agreement }) => !candidates.includes(agreement.acceptedWhen));
  if (candidates.length === 0 && own.length === 0) return null;

  function track(field: string): void {
    onChange([
      ...agreements,
      { key: suggestAgreementKey(agreements, field), step: stepName, acceptedWhen: field },
    ]);
  }

  function setKey(index: number, key: string): void {
    onChange(agreements.map((agreement, at) => (at === index ? { ...agreement, key } : agreement)));
  }

  const untrack = (field: string): void =>
    onChange(
      agreements.filter(
        (agreement) => agreement.step !== stepName || agreement.acceptedWhen !== field,
      ),
    );
  const remove = (index: number): void => onChange(agreements.filter((_, at) => at !== index));

  return (
    <InspectorBand title="Agreements" meta={pluralize(own.length, 'agreement')}>
      <Typography variant="meta" className="leading-natural">
        Records the applicant's acceptance when the field is true on submit.
      </Typography>
      {candidates.map((field) => {
        const tracked = own.filter(({ agreement }) => agreement.acceptedWhen === field);
        return (
          <div key={field} className="flex flex-col gap-2 border border-border-rule p-3">
            <Typography variant="body-sm" as="label" className="flex items-center gap-2">
              <Checkbox
                checked={tracked.length > 0}
                disabled={readOnly}
                onChange={(event) => (event.target.checked ? track(field) : untrack(field))}
              />
              <span>
                Track{' '}
                <Typography variant="mono" as="span" className="text-inherit">
                  {field}
                </Typography>{' '}
                as agreement
              </span>
            </Typography>
            {tracked.map(({ index }) => (
              <AgreementKeyInput
                key={index}
                agreements={agreements}
                index={index}
                label={`Agreement key for ${field}`}
                readOnly={readOnly}
                onKey={(key) => setKey(index, key)}
              />
            ))}
          </div>
        );
      })}
      {fields !== null &&
        stale.map(({ agreement, index }) => (
          <div key={index} className="flex flex-col gap-1 border border-border-rule p-3">
            <div className="flex items-center justify-between gap-2">
              <Typography variant="mono" as="span" className="text-tsh-red line-through">
                {agreement.key} · {agreement.acceptedWhen || 'no field'}
              </Typography>
              {!readOnly && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="h-7 px-1"
                  aria-label={`Remove agreement ${agreement.key}`}
                  onClick={() => remove(index)}
                >
                  <Close aria-hidden className="size-5" />
                </Button>
              )}
            </div>
            <Typography variant="meta" className="text-tsh-red">
              Not a stored yes/no field of this step.
            </Typography>
          </div>
        ))}
    </InspectorBand>
  );
}
