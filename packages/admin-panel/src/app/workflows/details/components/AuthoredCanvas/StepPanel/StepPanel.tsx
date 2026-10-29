import { memo, useId, useState, type ReactElement } from 'react';
import { STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { Button } from '@/components/ui/Button/Button';
import { Chip } from '@/components/ui/Chip/Chip';
import { Input } from '@/components/ui/Input/Input';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { findStepCategoryTone } from '../../../constants/step-category-tones';
import { findStepTypeDescription } from '../../../constants/step-type-descriptions';
import {
  readArms,
  readTransitionIndex,
  readTransitions,
  type AuthoredArm,
  type AuthoredDocument,
} from '../../../utils/authored-document';
import {
  addInclude,
  connect,
  deleteStep,
  disconnect,
  findRenameProblem,
  removeInclude,
  renameField,
  renameStep,
  setAgreements,
  setArms,
  setConfigScoringRules,
  setInitial,
  setScoringRules,
  setSectionConfig,
  setTransitions,
} from '../../../utils/authored-edits';
import {
  acceptsScoring,
  listSections,
  type ProjectedStep,
} from '../../../utils/authored-projection';
import { FIELD_NAMES_LIST_ID } from '../../../utils/config-schema';
import { pluralize } from '../../../utils/pluralize';
import { StepAgreements } from '../Agreements/StepAgreements';
import { InspectorBand } from '../InspectorBand';
import { PanelClose } from '../PanelClose';
import { CustomTransitions } from './CustomTransitions';
import { PortArms } from './PortArms';
import { ScoringSection } from './ScoringSection';
import { StepSections } from './StepSections';

export interface StepPanelProps {
  doc: AuthoredDocument;
  /** The canvas's projection of `doc`. */
  steps: readonly ProjectedStep[];
  /** The selected step's name; the panel renders nothing when the document has no such step. */
  stepName: string;
  readOnly: boolean;
  onChange: (doc: AuthoredDocument) => void;
  /** After a rename's `onChange`, so the host can keep the same step selected. */
  onRenamed: (name: string) => void;
  onClose: () => void;
}

interface StepNameInputProps {
  doc: AuthoredDocument;
  name: string;
  readOnly: boolean;
  onRename: (to: string) => void;
}

function StepNameInput({ doc, name, readOnly, onRename }: StepNameInputProps): ReactElement {
  const errorId = useId();
  const [draft, setDraft] = useState(name);
  const problem = draft === name ? null : findRenameProblem(doc, name, draft);

  return (
    <>
      <Input
        font="mono"
        size="sm"
        aria-label="Step name"
        aria-invalid={problem !== null}
        aria-describedby={problem !== null ? errorId : undefined}
        readOnly={readOnly}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== name && problem === null && onRename(draft)}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      />
      {problem !== null && (
        <Typography id={errorId} variant="meta" className="text-tsh-red" role="alert">
          {problem}
        </Typography>
      )}
    </>
  );
}

function listFieldNames(doc: AuthoredDocument): string[] {
  return [
    ...new Set(
      doc.steps.flatMap((step) =>
        listSections(step).flatMap((section) =>
          Array.isArray(section.fields) ? section.fields.map((field) => field.name) : [],
        ),
      ),
    ),
  ];
}

/** The inspector for one step of the authored document: rename, wire, configure; every edit is a new document. */
export const StepPanel = memo(function StepPanel({
  doc,
  steps,
  stepName,
  readOnly,
  onChange,
  onRenamed,
  onClose,
}: StepPanelProps): ReactElement | null {
  const projected = steps.find((candidate) => candidate.step.name === stepName);
  if (projected === undefined) return null;

  const { step } = projected;
  const stepNames = doc.steps.map((candidate) => candidate.name);
  const knownPorts = projected.ports.kind === 'known' ? projected.ports.ports : [];
  const portNames = knownPorts.map((port) => port.name);
  const ports = [...portNames, ...projected.strayPorts];
  const transitions = readTransitions(step);
  const description = findStepTypeDescription(step.type);
  const tone = projected.category === null ? undefined : findStepCategoryTone(projected.category);

  function wire(port: string, target: string | null): void {
    onChange(
      target === null
        ? disconnect(doc, stepName, port, null)
        : connect(doc, stepName, port, target),
    );
  }

  function rename(to: string): void {
    onChange(renameStep(doc, stepName, to));
    onRenamed(to);
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border-rule xl:w-md 2xl:w-lg">
      <datalist id={FIELD_NAMES_LIST_ID}>
        {listFieldNames(doc).map((field) => (
          <option key={field} value={field} />
        ))}
      </datalist>
      <header className="flex flex-col gap-2 border-b border-border-hair px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <Typography variant="caps-tiny" as="span" className="text-fg-4">
            Selected step
          </Typography>
          <PanelClose onClose={onClose} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Typography variant="mono" as="span" className="text-fg-1">
            {step.type}
          </Typography>
          {projected.category !== null && (
            // The card's stripe colour, so the chip ties the panel to the card and the palette group.
            <Chip className={cn('font-medium text-fg-1', tone?.bar)}>{projected.category}</Chip>
          )}
        </div>
        {description !== undefined && (
          <Typography variant="meta" className="leading-natural">
            {description}
          </Typography>
        )}
        <StepNameInput
          key={stepName}
          doc={doc}
          name={stepName}
          readOnly={readOnly}
          onRename={rename}
        />
        {!readOnly && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={projected.isInitial}
              onClick={() => onChange(setInitial(doc, stepName))}
            >
              {projected.isInitial ? 'Initial step' : 'Set as initial'}
            </Button>
            <Button
              variant="danger-outline"
              size="sm"
              onClick={() => {
                onChange(deleteStep(doc, stepName));
                onClose();
              }}
            >
              Delete step
            </Button>
          </div>
        )}
      </header>

      {projected.issues.length > 0 && (
        <InspectorBand title="Problems" meta={pluralize(projected.issues.length, 'problem')}>
          <ul aria-label="Problems" className="flex list-disc flex-col gap-1 pl-4 text-tsh-red">
            {projected.issues.map((issue) => (
              <Typography
                key={issue}
                variant="meta"
                as="li"
                className="leading-natural wrap-break-word text-tsh-red"
              >
                {issue}
              </Typography>
            ))}
          </ul>
        </InspectorBand>
      )}

      <InspectorBand title="Ports" meta={pluralize(ports.length, 'port')}>
        {projected.ports.kind === 'config-error' && (
          <Typography variant="meta" className="text-tsh-red">
            {projected.ports.message}
          </Typography>
        )}
        {step.type === STEP_TYPE.custom && (
          <CustomTransitions
            stepType={step.type}
            config={step.config ?? {}}
            transitions={transitions}
            ports={knownPorts}
            stepNames={stepNames}
            readOnly={readOnly}
            onChange={(next) => onChange(setTransitions(doc, stepName, next))}
          />
        )}
        {ports
          .filter((port) => readTransitionIndex(port) === null)
          .map((port) => {
            const info = knownPorts.find((candidate) => candidate.name === port);
            const isStray = !portNames.includes(port);
            const portName = info?.label ?? port;
            const label = (
              <Typography
                variant="mono"
                as="span"
                className={isStray ? 'text-tsh-red line-through' : ''}
                title={info?.detail}
              >
                {portName}
                {info?.detail ? (
                  <Typography variant="meta" as="span" className="block">
                    {info.detail}
                  </Typography>
                ) : null}
              </Typography>
            );
            return (
              <PortArms
                key={port}
                label={label}
                portName={portName}
                arms={readArms(step, port)}
                stepNames={stepNames}
                readOnly={readOnly}
                onWire={(target) => wire(port, target)}
                onArms={(arms: AuthoredArm[]) => onChange(setArms(doc, stepName, port, arms))}
              />
            );
          })}
      </InspectorBand>

      <StepSections
        step={step}
        storedFields={projected.storedFields}
        readOnly={readOnly}
        onConfig={(include, config) => onChange(setSectionConfig(doc, stepName, include, config))}
        onRenameField={(from, to) => {
          const renamed = renameField(doc, stepName, from, to);
          onChange(renamed.doc);
          return renamed.referencesUpdated;
        }}
        onAddSection={(type) => onChange(addInclude(doc, stepName, type))}
        onRemoveSection={(include) => onChange(removeInclude(doc, stepName, include))}
      />

      {acceptsScoring(step.type) && (
        <ScoringSection
          step={step}
          declared={Object.keys(doc.scoring ?? {})}
          readOnly={readOnly}
          onRules={(rules) => onChange(setScoringRules(doc, stepName, rules))}
          onConfigRules={(rules) => onChange(setConfigScoringRules(doc, stepName, rules))}
        />
      )}

      <StepAgreements
        agreements={doc.agreements ?? []}
        stepName={stepName}
        fields={projected.agreementFields}
        readOnly={readOnly}
        onChange={(agreements) => onChange(setAgreements(doc, agreements))}
      />
    </aside>
  );
});
