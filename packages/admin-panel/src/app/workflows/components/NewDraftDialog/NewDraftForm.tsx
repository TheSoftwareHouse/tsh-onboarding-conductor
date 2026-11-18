import type { ChangeEvent, ReactElement } from 'react';
import { useId } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { WORKFLOW_VERSION_STATUS } from '@/api/workflows/workflow-versions';
import { Button } from '@/components/ui/Button/Button';
import { Callout } from '@/components/ui/Callout/Callout';
import { FormField, fieldDescribedBy } from '@/components/ui/form/FormField/FormField';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { Input } from '@/components/ui/Input/Input';
import { TextLink } from '@/components/ui/TextLink/TextLink';
import { Typography } from '@/components/ui/Typography/Typography';
import { ADMIN_ROUTES } from '@/constants/routes';
import { cn } from '@/lib/cn';
import {
  newDraftSchema,
  parseDraftUpload,
  type NewDraftValues,
} from '../../utils/new-draft-schema';
import {
  ForkSourceFields,
  useForkSource,
  type ForkPrefill,
  type InitialFork,
} from './ForkSourceFields';

export interface NewDraftFormProps {
  isSubmitting: boolean;
  onSubmit: (document: WorkflowDocumentInput) => void;
  onCancel: () => void;
  /** Opens the form on Fork with this version chosen. */
  initialFork?: InitialFork;
}

const SOURCE_OPTIONS = [
  {
    value: 'fork',
    label: 'Fork an existing version',
    description: 'Copy a published or retired version into a new draft, under its ID or a new one.',
  },
  {
    value: 'empty',
    label: 'Empty workflow',
    description: 'Start with just an ID and a version, then add steps in the editor.',
  },
  {
    value: 'upload',
    label: 'Upload a definition file',
    description:
      'Start from a workflow .json file. Its ID and version are filled in, and you can change them.',
  },
] as const;

const DEFAULT_VALUES: NewDraftValues = {
  source: 'fork',
  workflowId: '',
  version: '1',
  name: '',
  upload: null,
  fork: null,
};

/** The "Start from" choice plus the fields it needs; owns its form state, so closing the dialog discards it. */
export function NewDraftForm({
  isSubmitting,
  onSubmit,
  onCancel,
  initialFork,
}: NewDraftFormProps): ReactElement {
  const idPrefix = useId();
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm<NewDraftValues, unknown, WorkflowDocumentInput>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(newDraftSchema),
  });
  const source = watch('source');
  const upload = watch('upload');
  const fork = watch('fork');
  const workflowId = watch('workflowId');

  const applyPrefill = (prefill: ForkPrefill): void => {
    setValue('fork', prefill.fork, { shouldDirty: true });
    setValue('workflowId', prefill.workflowId, { shouldDirty: true });
    setValue('version', prefill.version, { shouldDirty: true });
    setValue('name', prefill.name, { shouldDirty: true });
    clearErrors(['fork', 'workflowId', 'version']);
  };
  const forkSource = useForkSource({
    initialFork,
    isActive: source === 'fork',
    onPrefill: applyPrefill,
    onReset: () => setValue('fork', null),
  });
  const sourceVersions = useQuery({
    ...workflowQueries.versions(fork?.workflowId ?? ''),
    enabled: fork !== null,
  }).data;
  const existingDraft =
    source === 'fork' && fork !== null && workflowId.trim() === fork.workflowId
      ? sourceVersions?.find((entry) => entry.status === WORKFLOW_VERSION_STATUS.draft)
      : undefined;
  const existingDraftPath =
    existingDraft === undefined
      ? ''
      : `${ADMIN_ROUTES.workflows.details(workflowId.trim())}?version=${existingDraft.version}`;
  const uploadId = `${idPrefix}-upload`;

  const submit = handleSubmit(onSubmit);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    const parsed = file === undefined ? null : parseDraftUpload(await file.text());
    setValue('upload', parsed, { shouldDirty: true });
    if (parsed?.status === 'ready') {
      setValue('workflowId', parsed.id, { shouldDirty: true });
      setValue('version', String(parsed.version), { shouldDirty: true });
      setValue('name', parsed.name, { shouldDirty: true });
    }
    clearErrors(['upload', 'workflowId', 'version']);
  };

  const isLoadingFork = source === 'fork' && forkSource.isLoading;
  const idHint =
    source !== 'fork' || fork === null
      ? null
      : fork.scope === 'users'
        ? 'Changing the ID creates a new workflow and renames its connector source keys.'
        : 'Built-in workflows are copied under a new ID, with their connector source keys renamed.';

  const identityFields = (
    <>
      {existingDraft !== undefined && (
        <div className="col-span-2">
          <Callout variant="notice" role="status">
            This workflow already has draft v{existingDraft.version}.{' '}
            <TextLink to={existingDraftPath} onClick={onCancel}>
              Open it
            </TextLink>
            , or change the ID to create a new workflow.
          </Callout>
        </div>
      )}
      <TextFormField
        control={control}
        name="workflowId"
        controlId={`${idPrefix}-workflow-id`}
        autoComplete="off"
        label="Workflow ID"
        isRequired
        font="mono"
        disabled={isLoadingFork}
        description={idHint ?? undefined}
      />
      <TextFormField
        control={control}
        name="version"
        controlId={`${idPrefix}-version`}
        autoComplete="off"
        label="Version"
        isRequired
        font="mono"
        disabled={isLoadingFork}
      />
      <div className="col-span-2">
        <TextFormField
          control={control}
          name="name"
          controlId={`${idPrefix}-name`}
          label="Name"
          disabled={isLoadingFork}
        />
      </div>
    </>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <div className="flex flex-col gap-6 p-6">
        <fieldset className="flex flex-col gap-2.5">
          <Typography as="legend" variant="caps-tiny" className="mb-2.5 text-fg-3">
            Start from
          </Typography>
          <Controller
            control={control}
            name="source"
            render={({ field }) => (
              <>
                {SOURCE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 border p-4',
                      field.value === option.value ? 'border-tsh-black' : 'border-border-strong',
                    )}
                  >
                    <input
                      type="radio"
                      name={field.name}
                      value={option.value}
                      checked={field.value === option.value}
                      onChange={() => {
                        // A read upload's id, version and name never carry into a fork.
                        if (option.value === 'fork' && upload !== null) {
                          setValue('upload', null);
                          forkSource.refill();
                        }
                        field.onChange(option.value);
                      }}
                      className="mt-0.5 size-4 accent-tsh-black"
                    />
                    <span className="flex flex-col gap-1">
                      <Typography variant="body-md" as="span" className="text-fg-1">
                        {option.label}
                      </Typography>
                      <Typography variant="body-sm" as="span" className="text-pretty">
                        {option.description}
                      </Typography>
                    </span>
                  </label>
                ))}
              </>
            )}
          />
        </fieldset>

        {source === 'empty' && <div className="grid grid-cols-2 gap-4">{identityFields}</div>}
        {source === 'fork' && (
          <div className="flex flex-col gap-4">
            <ForkSourceFields source={forkSource} idPrefix={idPrefix} />
            {(fork !== null || isLoadingFork) && (
              <div className="grid grid-cols-2 gap-4">{identityFields}</div>
            )}
            {errors.fork?.message !== undefined && (
              <Typography variant="body-sm" className="text-tsh-red" role="alert">
                {errors.fork.message}
              </Typography>
            )}
          </div>
        )}
        {source === 'upload' && (
          <div className="flex flex-col gap-4">
            <Controller
              control={control}
              name="upload"
              render={({ field, fieldState }) => (
                <FormField
                  controlId={uploadId}
                  label="Definition file"
                  error={fieldState.error?.message}
                >
                  <Input
                    id={uploadId}
                    type="file"
                    accept=".json,application/json"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    onChange={handleFile}
                    aria-invalid={fieldState.error === undefined ? undefined : true}
                    aria-describedby={fieldDescribedBy(uploadId, fieldState.error !== undefined)}
                    className="py-2"
                  />
                </FormField>
              )}
            />
            {upload?.status === 'ready' && (
              <div className="grid grid-cols-2 gap-4">{identityFields}</div>
            )}
          </div>
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-border-hair px-6 py-5">
        {existingDraft !== undefined && (
          <Button as={Link} to={existingDraftPath} onClick={onCancel} variant="primary">
            Open draft v{existingDraft.version}
          </Button>
        )}
        <Button
          type="submit"
          variant={existingDraft === undefined ? 'primary' : 'outline'}
          disabled={isSubmitting || isLoadingFork || existingDraft !== undefined}
        >
          {isSubmitting ? 'Creating…' : 'Create and open editor'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </footer>
    </form>
  );
}
