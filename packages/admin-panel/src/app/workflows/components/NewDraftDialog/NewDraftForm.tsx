import type { ChangeEvent, ReactElement } from 'react';
import { useId } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import type { WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';
import { Button } from '@/components/ui/Button/Button';
import { FormField, fieldDescribedBy } from '@/components/ui/form/FormField/FormField';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { Input } from '@/components/ui/Input/Input';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import {
  newDraftSchema,
  parseDraftUpload,
  type NewDraftValues,
} from '../../utils/new-draft-schema';

export interface NewDraftFormProps {
  isSubmitting: boolean;
  onSubmit: (document: WorkflowDocumentInput) => void;
  onCancel: () => void;
}

const SOURCE_OPTIONS = [
  {
    value: 'empty',
    label: 'Empty workflow',
    description: 'A document with an id, a version and no steps; write the rest in the editor.',
  },
  {
    value: 'upload',
    label: 'Upload a definition file',
    description: 'Any JSON workflow document; it is validated in the editor, not on upload.',
  },
] as const;

const DEFAULT_VALUES: NewDraftValues = {
  source: 'empty',
  workflowId: '',
  version: '1',
  name: '',
  upload: null,
};

/** The "Start from" choice plus the fields it needs; owns its form state, so closing the dialog discards it. */
export function NewDraftForm({
  isSubmitting,
  onSubmit,
  onCancel,
}: NewDraftFormProps): ReactElement {
  const idPrefix = useId();
  const { control, handleSubmit, watch, setValue, clearErrors } = useForm<
    NewDraftValues,
    unknown,
    WorkflowDocumentInput
  >({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(newDraftSchema),
  });
  const source = watch('source');
  const upload = watch('upload');
  const uploadId = `${idPrefix}-upload`;

  const submit = handleSubmit(onSubmit);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    setValue('upload', file === undefined ? null : parseDraftUpload(await file.text()), {
      shouldDirty: true,
    });
    clearErrors('upload');
  };

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
                      onChange={() => field.onChange(option.value)}
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

        {source === 'empty' ? (
          <div className="grid grid-cols-2 gap-4">
            <TextFormField
              control={control}
              name="workflowId"
              controlId={`${idPrefix}-workflow-id`}
              autoComplete="off"
              label="Workflow ID"
              isRequired
              font="mono"
            />
            <TextFormField
              control={control}
              name="version"
              controlId={`${idPrefix}-version`}
              autoComplete="off"
              label="Version"
              isRequired
              font="mono"
            />
            <div className="col-span-2">
              <TextFormField
                control={control}
                name="name"
                controlId={`${idPrefix}-name`}
                label="Name"
              />
            </div>
          </div>
        ) : (
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
              <div className="grid grid-cols-2 gap-4">
                <FormField controlId={`${idPrefix}-read-id`} label="Workflow ID">
                  <Input
                    id={`${idPrefix}-read-id`}
                    font="mono"
                    readOnly
                    value={upload.id}
                    className="bg-bg-subtle text-fg-3"
                  />
                </FormField>
                <FormField controlId={`${idPrefix}-read-version`} label="Version">
                  <Input
                    id={`${idPrefix}-read-version`}
                    font="mono"
                    readOnly
                    value={String(upload.version)}
                    className="bg-bg-subtle text-fg-3"
                  />
                </FormField>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-border-hair px-6 py-5">
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Creating…' : 'Create and open editor'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </footer>
    </form>
  );
}
