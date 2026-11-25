import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { organizationMutations } from '@/api/organization/organization-mutations';
import { ORGANIZATION_ROLES } from '@/api/organization/organization';
import { Button } from '@/components/ui/Button/Button';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { Select } from '@/components/ui/Select/Select';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';

const inviteSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  role: z.enum(ORGANIZATION_ROLES),
});

type InviteValues = z.infer<typeof inviteSchema>;

const ROLE_ITEMS = ORGANIZATION_ROLES.map((role) => ({ value: role, label: role }));

/** Invites an email address into the active organization with a role. */
export function InviteForm(): ReactElement {
  const invite = useMutation(organizationMutations.invite());
  const { control, handleSubmit, reset } = useForm<InviteValues>({
    defaultValues: { email: '', role: 'member' },
    resolver: zodResolver(inviteSchema),
  });

  const submit = handleSubmit((values) => {
    invite.mutate(values, {
      onSuccess: () => {
        showSuccessToast(`Invitation sent to ${values.email}`);
        reset();
      },
      onError: (error) => showErrorToast('Invitation not sent', error.message),
    });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-4">
      <div className="w-80">
        <TextFormField
          control={control}
          name="email"
          controlId="invite-email"
          label="Email"
          autoComplete="off"
          isRequired
        />
      </div>
      <div className="w-40">
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <Select
              aria-label="Role"
              items={ROLE_ITEMS}
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
      </div>
      <Button type="submit" variant="primary" disabled={invite.isPending}>
        {invite.isPending ? 'Inviting…' : 'Invite'}
      </Button>
    </form>
  );
}
