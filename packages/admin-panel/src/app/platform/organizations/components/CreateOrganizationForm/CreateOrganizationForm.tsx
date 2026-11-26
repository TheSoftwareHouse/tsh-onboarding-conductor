import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { slugify } from '@/api/platform/platform';
import { platformMutations } from '@/api/platform/platform-mutations';
import { Button } from '@/components/ui/Button/Button';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a name.')
    .refine((name) => slugify(name) !== '', 'Use at least one letter or digit.'),
});

type CreateValues = z.infer<typeof createSchema>;

/** Creates an organization; the superadmin becomes its owner and can invite into it at once. */
export function CreateOrganizationForm(): ReactElement {
  const create = useMutation(platformMutations.createOrganization());
  const { control, handleSubmit, reset } = useForm<CreateValues>({
    defaultValues: { name: '' },
    resolver: zodResolver(createSchema),
  });

  const submit = handleSubmit(({ name }) => {
    create.mutate(name, {
      onSuccess: () => {
        showSuccessToast(`Organization ${name} created`);
        reset();
      },
      onError: (error) => showErrorToast('Organization not created', error.message),
    });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-4">
      <div className="w-80">
        <TextFormField
          control={control}
          name="name"
          controlId="platform-organization-name"
          label="Name"
          autoComplete="off"
          isRequired
        />
      </div>
      <Button type="submit" variant="primary" disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
